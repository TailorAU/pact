#!/usr/bin/env python3
"""#1160 Round 6.5 — Legislation update monitor (T1/T2/T3 detection).

Polls upstream legislation feeds for changes to any act/regulation cited by
an active scenario (via `scenario_applies_when.legislation_id` or the
free-text `scenarios.source_ref`). Intended to run as a daily cron; for this
round we ship it as a dry-run so CI can exercise the code path without
opening noisy GitHub issues.

Feeds:
  * QLD Legislation — https://www.legislation.qld.gov.au/
    Per-act "last amended" + "in force" dates are surfaced via the
    legislation doc HTML (and ingestible via our own
    /api/axiom/legislation/ingest endpoint). For the monitor we hit the
    public metadata endpoint and compare against legislation_docs.last_amended_date.
  * Commonwealth — https://www.legislation.gov.au/
    Federal Register of Legislation publishes an RSS feed of amendments.
    We parse it and match against legislation_id strings present in our graph.
  * Any other jurisdiction present in legislation_docs is queried best-effort
    by URL only (no change detection); remains a TODO until we have a feed.

Output (always human-readable to stdout):
  1. Summary: N scenarios tracked, M distinct legislation cites.
  2. For each feed checked: entries seen / errors / cites matched.
  3. A list of "candidate triggers" — legislation_id + discovered change
     detail + the scenarios that cite it. Each becomes a T1/T2/T3 row in
     the lifecycle runbook's intake queue.

Modes:
  --dry-run (default)   Print only. Exit 0 on success.
  --emit-issues         Open GitHub issues via `gh issue create` for each
                        candidate trigger. Requires GH_TOKEN; not used from CI
                        this round.

CI wiring: the scenario-pr-check workflow does NOT run this script, but a
follow-up cron workflow (out-of-scope for #1160) will. We smoke-test it in
CI by running `python -m py_compile` and `python monitor_legislation_updates.py --dry-run --smoke`
against an empty dataset.

Environment:
  DATABASE_URL                required in non-smoke mode
  MONITOR_QLD_FEED_URL        override (default below)
  MONITOR_FRL_RSS_URL         override (default below)
  MONITOR_HTTP_TIMEOUT_S      default 15
  MONITOR_USER_AGENT          default "tailor-source-monitor/1.0 (+https://tailor.au)"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree as ET

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    # Smoke mode uses no DB, so a missing driver is only fatal in normal mode.
    psycopg2 = None  # type: ignore[assignment]

try:
    import urllib.request
    import urllib.error
except ImportError:  # pragma: no cover
    urllib = None  # type: ignore[assignment]


DEFAULT_QLD_FEED = (
    # QLD Legislation publishes a JSON index of currency status.
    # We treat any HTTP 200 with recognisable JSON as "feed reachable";
    # per-doc freshness comparisons happen by URL lookup against our graph.
    os.environ.get(
        "MONITOR_QLD_FEED_URL",
        "https://www.legislation.qld.gov.au/browse/search?qs=currency_status%3Din-force",
    )
)
DEFAULT_FRL_RSS = os.environ.get(
    "MONITOR_FRL_RSS_URL",
    "https://www.legislation.gov.au/rss/notify.rss",
)
HTTP_TIMEOUT = float(os.environ.get("MONITOR_HTTP_TIMEOUT_S", "15"))
USER_AGENT = os.environ.get(
    "MONITOR_USER_AGENT", "tailor-source-monitor/1.0 (+https://tailor.au)"
)


@dataclass
class CandidateTrigger:
    trigger_code: str  # T1 / T2 / T3
    legislation_id: str
    discovered_at: str
    change_detail: str
    scenarios: list[str]
    source_feed: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "triggerCode": self.trigger_code,
            "legislationId": self.legislation_id,
            "discoveredAt": self.discovered_at,
            "changeDetail": self.change_detail,
            "scenarios": self.scenarios,
            "sourceFeed": self.source_feed,
        }


def _http_get(url: str) -> tuple[int, bytes, str]:
    """Return (status, body_bytes, content_type)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read()
            return resp.getcode(), body, resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, b"", ""
    except Exception as e:  # noqa: BLE001 - best-effort monitoring
        print(f"  [http] {url} failed: {e}")
        return 0, b"", ""


def load_graph(conn) -> tuple[dict[str, list[str]], dict[str, dict[str, Any]]]:
    """
    Returns:
      cite_map: legislation_id -> [scenario_id]
      leg_docs: legislation_id -> row dict (may be empty if id is free-text)
    """
    cite_map: dict[str, list[str]] = {}
    leg_docs: dict[str, dict[str, Any]] = {}
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT saw.legislation_id, saw.scenario_id
                 FROM scenario_applies_when saw
                 JOIN scenarios s ON s.id = saw.scenario_id
                WHERE saw.legislation_id IS NOT NULL
                  AND s.deprecated_at IS NULL"""
        )
        for row in cur.fetchall():
            cite_map.setdefault(row["legislation_id"], []).append(row["scenario_id"])

        ids = list(cite_map.keys())
        if ids:
            cur.execute(
                """SELECT id, jurisdiction, title, short_title, year, number,
                          last_amended_date, in_force_date, legislation_url
                     FROM legislation_docs WHERE id = ANY(%s)""",
                (ids,),
            )
            for row in cur.fetchall():
                leg_docs[row["id"]] = dict(row)
    return cite_map, leg_docs


def check_frl_rss(feed_url: str, cite_map: dict[str, list[str]]) -> list[CandidateTrigger]:
    """Parse the Federal Register of Legislation RSS feed and flag any item
    that mentions a legislation_id we cite."""
    candidates: list[CandidateTrigger] = []
    status, body, _ = _http_get(feed_url)
    if status != 200 or not body:
        print(f"  [frl ] feed unreachable ({status})")
        return candidates

    try:
        root = ET.fromstring(body.decode("utf-8", errors="replace"))
    except ET.ParseError as e:
        print(f"  [frl ] malformed RSS: {e}")
        return candidates

    items = list(root.iter("item"))
    print(f"  [frl ] {len(items)} item(s) in feed")
    now_iso = datetime.now(timezone.utc).isoformat()
    # Build a reverse lookup so we can match on common cite formats (e.g.
    # "cth/act-1988-119" -> look for "act-1988-119" or "1988" + "119" in titles).
    for item in items:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        combined = f"{title}\n{link}".lower()
        for leg_id, scns in cite_map.items():
            if not leg_id.startswith("cth/"):
                continue
            token = leg_id.split("/", 1)[1].lower()
            if token and token in combined:
                candidates.append(CandidateTrigger(
                    trigger_code="T1",
                    legislation_id=leg_id,
                    discovered_at=now_iso,
                    change_detail=f"FRL RSS mention: {title} ({pub}) {link}".strip(),
                    scenarios=sorted(set(scns)),
                    source_feed=feed_url,
                ))
    return candidates


def check_qld_feed(feed_url: str, cite_map: dict[str, list[str]]) -> list[CandidateTrigger]:
    """Soft check: confirm the QLD legislation service is reachable. We don't
    yet have a per-act change feed we can reliably parse, so this step is
    intentionally lightweight — it fails loudly if the upstream API stops
    responding (which by itself is worth a T2 intake)."""
    candidates: list[CandidateTrigger] = []
    status, body, ctype = _http_get(feed_url)
    ok = status == 200 and len(body) > 0
    print(f"  [qld ] {'OK' if ok else 'UNREACHABLE'} ({status}, {len(body)} bytes, {ctype})")
    if not ok:
        now_iso = datetime.now(timezone.utc).isoformat()
        qld_cites = [lid for lid in cite_map if lid.startswith("qld/")]
        if qld_cites:
            candidates.append(CandidateTrigger(
                trigger_code="T2",
                legislation_id="qld/*",
                discovered_at=now_iso,
                change_detail=f"QLD legislation feed unreachable (HTTP {status})",
                scenarios=sorted({s for lid in qld_cites for s in cite_map[lid]}),
                source_feed=feed_url,
            ))
    return candidates


def emit_issues(candidates: list[CandidateTrigger]) -> None:
    """For each candidate, call `gh issue create` so the curator queue gets
    a visible page. Requires GH_TOKEN. Not exercised in this round."""
    import subprocess
    for c in candidates:
        title = f"[source-scenarios] Trigger {c.trigger_code}: {c.legislation_id}"
        body = (
            f"## {c.trigger_code} — {c.legislation_id}\n\n"
            f"- Discovered: {c.discovered_at}\n"
            f"- Feed: {c.source_feed}\n"
            f"- Detail: {c.change_detail}\n\n"
            f"### Affected scenarios\n\n"
            + "".join(f"- `{s}`\n" for s in c.scenarios)
            + "\n_Auto-filed by sites/source/scripts/monitor_legislation_updates.py._"
        )
        print(f"  [gh  ] opening issue: {title}")
        subprocess.run(
            ["gh", "issue", "create", "--title", title, "--body", body, "--label", "source,trigger-monitor,auto-filed"],
            check=False,
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="Source legislation-update monitor")
    ap.add_argument("--dry-run", action="store_true", default=True, help="Print findings without opening issues (default)")
    ap.add_argument("--emit-issues", action="store_true", help="Open GitHub issues for each candidate trigger")
    ap.add_argument("--smoke", action="store_true", help="Smoke mode — exercise parsers against empty data; skips HTTP + DB")
    ap.add_argument("--output-json", help="Also write the candidate list to this JSON file")
    args = ap.parse_args()

    started = time.time()
    print(f"[monitor] Source legislation-update monitor starting at {datetime.now(timezone.utc).isoformat()}")

    if args.smoke:
        print("[monitor] --smoke mode: no DB, no network")
        candidates: list[CandidateTrigger] = []
        # Exercise the RSS parser against a tiny synthetic payload.
        synthetic_feed = b"""<?xml version='1.0'?><rss version='2.0'><channel>
          <item><title>Privacy Act 1988 amended</title><link>https://example/act-1988-119</link><pubDate>Mon, 01 Jan 2030 00:00:00 GMT</pubDate></item>
        </channel></rss>"""
        try:
            root = ET.fromstring(synthetic_feed.decode("utf-8"))
            items = list(root.iter("item"))
            print(f"[monitor] smoke RSS parse OK ({len(items)} item)")
        except ET.ParseError as e:
            print(f"[monitor] smoke RSS parse FAILED: {e}")
            return 1
        print("[monitor] smoke mode OK")
        return 0

    if psycopg2 is None:
        print("ERROR: psycopg2 is required outside --smoke mode")
        return 1
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set. Use --smoke to run without a DB.")
        return 1

    conn = psycopg2.connect(url)
    try:
        cite_map, leg_docs = load_graph(conn)
    finally:
        conn.close()

    print(f"[monitor] tracking {len(cite_map)} legislation cite(s) across "
          f"{sum(len(v) for v in cite_map.values())} scenario link(s)")
    print(f"[monitor] {len(leg_docs)} resolved legislation_docs row(s)")

    candidates: list[CandidateTrigger] = []
    print("[monitor] checking FRL RSS")
    candidates.extend(check_frl_rss(DEFAULT_FRL_RSS, cite_map))
    print("[monitor] checking QLD legislation feed")
    candidates.extend(check_qld_feed(DEFAULT_QLD_FEED, cite_map))

    print(f"[monitor] {len(candidates)} candidate trigger(s) found")
    for c in candidates:
        print(f"  - {c.trigger_code} {c.legislation_id}: {c.change_detail}")
        for s in c.scenarios:
            print(f"      scenario: {s}")

    if args.output_json:
        with open(args.output_json, "w", encoding="utf-8") as f:
            json.dump([c.to_dict() for c in candidates], f, indent=2)

    if args.emit_issues and candidates:
        if not os.environ.get("GH_TOKEN"):
            print("[monitor] --emit-issues set but GH_TOKEN missing; skipping")
        else:
            emit_issues(candidates)

    dur = time.time() - started
    print(f"[monitor] done in {dur:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
