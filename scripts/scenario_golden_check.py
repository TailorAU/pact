#!/usr/bin/env python3
"""#1160 Round 4 — Scenario golden check.

Non-destructive end-to-end check for the Source scenario applicability graph.
For each scenario returned by GET /api/scenarios:

  1. Fetch GET /api/scenarios/{id}/applicable.
  2. Feed the scenario's own declared predicates back into
     POST /api/scenarios/match.
  3. Assert the scenario itself is in the top-3 matches at confidence >= 0.7.
  4. Warn (not fail) if appliesWhen.length < 2.
  5. For every appliesWhen edge, resolve its topic_id or legislation_id:
       topic       -> GET /api/pact/topics/{id}
       legislation -> GET /api/legislation/{id}
     Count resolved vs missing and emit a summary.

Exit code:
  0  strict assertions all pass
  1  any strict assertion failed (prints to stderr, still writes report)
  2  fatal error hitting the API root

A JSON report is written to
  sites/source/reports/scenario-golden-{YYYY-MM-DD}.json
for historical diffing.

Env:
  SOURCE_BASE_URL     (default: https://source.tailor.au/api)
  SOURCE_AGENT_KEY    (optional — included if set, for authenticated debits)
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = os.environ.get("SOURCE_BASE_URL", "https://source.tailor.au/api").rstrip("/")
AGENT_KEY = os.environ.get("SOURCE_AGENT_KEY", "")
TIMEOUT = 30
MIN_TOP3_CONFIDENCE = 0.7

# ANSI colours — fall back to plain text when not a TTY.
IS_TTY = sys.stdout.isatty()
def _c(code: str, s: str) -> str:
    return f"\033[{code}m{s}\033[0m" if IS_TTY else s
green = lambda s: _c("32", s)
red = lambda s: _c("31", s)
yellow = lambda s: _c("33", s)
grey = lambda s: _c("90", s)


def _req(path: str, method: str = "GET", body: dict | None = None) -> Any:
    url = f"{BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if AGENT_KEY:
        req.add_header("x-source-agent-key", AGENT_KEY)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def run() -> int:
    started = time.time()
    now = datetime.now(timezone.utc)
    report: dict[str, Any] = {
        "generatedAt": now.isoformat(),
        "baseUrl": BASE,
        "scenarios": [],
        "summary": {},
    }
    try:
        payload = _req("/scenarios")
    except urllib.error.URLError as e:
        print(red(f"FATAL — cannot reach {BASE}/scenarios: {e}"), file=sys.stderr)
        return 2

    # The endpoint returns { scenarios: [...] }; accept a bare list too for back-compat.
    if isinstance(payload, dict) and isinstance(payload.get("scenarios"), list):
        scenarios = payload["scenarios"]
    elif isinstance(payload, list):
        scenarios = payload
    else:
        print(red("FATAL — /scenarios payload shape unrecognised (expected object with .scenarios or bare list)"), file=sys.stderr)
        return 2

    if len(scenarios) == 0:
        print(red("FATAL — /scenarios returned empty list"), file=sys.stderr)
        return 2

    total = len(scenarios)
    strict_fails = 0
    warns = 0
    edges_total = 0
    edges_resolved = 0
    edges_missing = 0
    edges_stub = 0

    topic_cache: dict[str, bool] = {}
    leg_cache: dict[str, bool] = {}

    print(grey(f"→ {BASE} — scanning {total} scenario(s)"))

    for scn in scenarios:
        sid = scn.get("id", "<unknown>")
        predicates = scn.get("predicates") or {}
        scn_report: dict[str, Any] = {"id": sid, "checks": {}, "edges": []}

        try:
            applicable = _req(f"/scenarios/{sid}/applicable")
        except urllib.error.HTTPError as e:
            strict_fails += 1
            scn_report["checks"]["applicable"] = f"FAIL http {e.code}"
            report["scenarios"].append(scn_report)
            print(red(f"  FAIL  {sid}: /applicable http {e.code}"))
            continue

        applies_when = applicable.get("appliesWhen") or []
        scn_report["appliesWhenCount"] = len(applies_when)
        if len(applies_when) < 2:
            warns += 1
            scn_report["checks"]["appliesWhenCount"] = "WARN (<2 edges)"
            print(yellow(f"  WARN  {sid}: only {len(applies_when)} appliesWhen edge(s)"))
        else:
            scn_report["checks"]["appliesWhenCount"] = "ok"

        try:
            match = _req("/scenarios/match", method="POST", body={"predicates": predicates})
        except urllib.error.HTTPError as e:
            strict_fails += 1
            scn_report["checks"]["selfMatch"] = f"FAIL http {e.code}"
            report["scenarios"].append(scn_report)
            print(red(f"  FAIL  {sid}: /match http {e.code}"))
            continue

        matches = match.get("matches") or []
        top3 = matches[:3]
        own = next((m for m in top3 if m.get("scenarioId") == sid), None)
        own_conf = float(own.get("confidence", 0)) if own else 0.0
        scn_report["topMatch"] = {
            "inTop3": bool(own),
            "confidence": own_conf,
            "top3Ids": [m.get("scenarioId") for m in top3],
        }
        if not own or own_conf < MIN_TOP3_CONFIDENCE:
            strict_fails += 1
            scn_report["checks"]["selfMatch"] = (
                f"FAIL confidence={own_conf:.2f} < {MIN_TOP3_CONFIDENCE}"
            )
            print(
                red(
                    f"  FAIL  {sid}: self not in top-3 at conf>={MIN_TOP3_CONFIDENCE} "
                    f"(observed conf={own_conf:.2f}, top3={scn_report['topMatch']['top3Ids']})"
                )
            )
        else:
            scn_report["checks"]["selfMatch"] = f"ok (conf={own_conf:.2f})"

        for edge in applies_when:
            edges_total += 1
            topic_id = edge.get("topicId")
            leg_id = edge.get("legislationId")
            resolved: str = "missing"
            target: str = ""
            if topic_id:
                target = f"topic:{topic_id}"
                if topic_id in topic_cache:
                    ok = topic_cache[topic_id]
                else:
                    try:
                        _req(f"/pact/topics/{topic_id}")
                        ok = True
                    except urllib.error.HTTPError as e:
                        ok = False if e.code == 404 else True
                    topic_cache[topic_id] = ok
                resolved = "resolved" if ok else "missing"
            elif leg_id:
                target = f"legislation:{leg_id}"
                if leg_id in leg_cache:
                    ok = leg_cache[leg_id]
                else:
                    try:
                        _req(f"/legislation/{leg_id}")
                        ok = True
                    except urllib.error.HTTPError as e:
                        ok = False if e.code == 404 else True
                    leg_cache[leg_id] = ok
                resolved = "resolved" if ok else "stub"
                if not ok:
                    edges_stub += 1
            scn_report["edges"].append({"target": target, "resolved": resolved})
            if resolved == "resolved":
                edges_resolved += 1
            elif resolved == "stub":
                pass
            else:
                edges_missing += 1

        report["scenarios"].append(scn_report)
        if scn_report["checks"].get("selfMatch", "").startswith("ok"):
            print(green(f"  PASS  {sid} (edges={len(applies_when)}, conf={own_conf:.2f})"))

    duration = time.time() - started
    report["summary"] = {
        "scenarios": total,
        "strictFails": strict_fails,
        "warns": warns,
        "edges": {
            "total": edges_total,
            "resolved": edges_resolved,
            "missing": edges_missing,
            "legislationStubs": edges_stub,
        },
        "durationSeconds": round(duration, 2),
    }

    out_dir = Path(__file__).resolve().parents[1] / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"scenario-golden-{now.date().isoformat()}.json"
    out_file.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")

    print()
    print(grey("──────── Golden check summary ────────"))
    print(f"  scenarios:      {total}")
    print(f"  strict fails:   {red(str(strict_fails)) if strict_fails else green('0')}")
    print(f"  warnings:       {yellow(str(warns)) if warns else grey('0')}")
    print(
        f"  edges:          {edges_total} "
        f"(resolved={green(str(edges_resolved))}, stubs={yellow(str(edges_stub))}, "
        f"missing={red(str(edges_missing)) if edges_missing else grey('0')})"
    )
    print(f"  duration:       {duration:.1f}s")
    print(f"  report:         {out_file}")

    return 0 if strict_fails == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
