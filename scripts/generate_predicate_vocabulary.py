#!/usr/bin/env python3
"""#1160 Round 6.3 — Predicate vocabulary generator.

Reads every scenario + scenario_applies_when row and rebuilds
`sites/source/docs/scenario-predicate-vocabulary.md` — the single source of
truth for predicate keys, observed values, and the scenarios that use them.

Idempotent: the doc is fully regenerated every run (the only non-deterministic
bit is the timestamp header, which is replaced on each run so a stale file
always diffs cleanly).

The CI gate (`.github/workflows/scenario-pr-check.yml`) runs this script and
fails the build if it produces diffs against the committed file — forcing
contributors to regenerate the doc in the same PR that touches seed scripts.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/generate_predicate_vocabulary.py

Writes to: sites/source/docs/scenario-predicate-vocabulary.md
Exit codes:
    0 — doc regenerated successfully
    1 — DATABASE_URL not set, or DB read failed
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 required. Install: pip install psycopg2-binary")
    sys.exit(2)


OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "docs" / "scenario-predicate-vocabulary.md"
)


# Deprecated synonym mapping — when a predicate key is retired in favour of a
# canonical spelling, record the mapping here. The generator surfaces the
# mapping in a dedicated section so contributors know which spelling to use.
# Example entry (none yet — seed once we retire the first synonym):
#   "data_direction": {
#       "replacement": "data_flow",
#       "since": "2026-04-18",
#       "rationale": "Unify data-movement predicates under data_flow.",
#   },
DEPRECATED_KEYS: dict[str, dict[str, str]] = {}


def _fetch(cur) -> tuple[list[dict], list[dict]]:
    cur.execute(
        """SELECT id, title, predicates, deprecated_at
             FROM scenarios
            ORDER BY id"""
    )
    scenarios = [dict(r) for r in cur.fetchall()]
    cur.execute(
        """SELECT saw.id, saw.scenario_id, saw.topic_id, saw.legislation_id,
                  saw.predicate, s.title AS scenario_title
             FROM scenario_applies_when saw
             JOIN scenarios s ON s.id = saw.scenario_id
            ORDER BY saw.scenario_id, saw.id"""
    )
    edges = [dict(r) for r in cur.fetchall()]
    return scenarios, edges


def _collect(scenarios: list[dict], edges: list[dict]) -> dict[str, dict[str, Any]]:
    """Build {key -> {values: {value: count}, scenarios: set[scn_id], where: set}}."""
    vocab: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "values": defaultdict(int),
            "scenarios": set(),
            "where": set(),  # "scenario.predicates" / "scenario_applies_when.predicate"
        }
    )

    def _record(key: str, value: Any, scn_id: str, source: str) -> None:
        entry = vocab[key]
        entry["values"][_repr(value)] += 1
        entry["scenarios"].add(scn_id)
        entry["where"].add(source)

    for scn in scenarios:
        preds = scn.get("predicates") or {}
        if isinstance(preds, str):
            try:
                preds = json.loads(preds)
            except Exception:
                preds = {}
        if not isinstance(preds, dict):
            continue
        for k, v in preds.items():
            _record(k, v, scn["id"], "scenario.predicates")

    for edge in edges:
        pred = edge.get("predicate") or {}
        if isinstance(pred, str):
            try:
                pred = json.loads(pred)
            except Exception:
                pred = {}
        if not isinstance(pred, dict):
            continue
        for k, v in pred.items():
            _record(k, v, edge["scenario_id"], "scenario_applies_when.predicate")

    return vocab


def _repr(value: Any) -> str:
    """Render a predicate value as a short stable string."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value
    # Lists, dicts, None → JSON
    try:
        return json.dumps(value, sort_keys=True, default=str)
    except Exception:
        return str(value)


def _value_pattern(values: dict[str, int]) -> str:
    """Guess a pattern/enum string for the value column."""
    if not values:
        return "_(no values seen)_"
    keys = list(values.keys())
    booly = {"true", "false"}
    if set(keys) <= booly:
        return "boolean"
    if all(re.fullmatch(r"-?\d+(\.\d+)?", k) for k in keys):
        return "number"
    # enum-like when the cardinality is small
    if len(keys) <= 8:
        return " | ".join(f"`{k}`" for k in sorted(keys))
    return f"free text ({len(keys)} distinct values)"


def _render(vocab: dict[str, dict[str, Any]], scenarios: list[dict]) -> str:
    scn_titles = {s["id"]: s["title"] for s in scenarios}
    live_ids = {s["id"] for s in scenarios if not s.get("deprecated_at")}

    lines: list[str] = []
    lines.append("# Scenario predicate vocabulary")
    lines.append("")
    lines.append("<!-- AUTO-GENERATED by sites/source/scripts/generate_predicate_vocabulary.py -->")
    lines.append("<!-- Do not hand-edit. Re-run the generator after seeding / deprecating scenarios. -->")
    lines.append("")
    lines.append(
        "This document lists every predicate key in use across `scenarios.predicates` "
        "and `scenario_applies_when.predicate`, together with observed values and the "
        "scenarios that depend on them. Scenario matching is case- and spelling-sensitive, "
        "so synonyms silently fragment the graph. See handoff #1160 §11.6 for discipline."
    )
    lines.append("")
    lines.append(
        "**New keys:** if you need a new predicate key, either reuse the canonical "
        "spelling already listed below, or add an entry to `DEPRECATED_KEYS` in the "
        "generator with the old → new mapping in the same PR."
    )
    lines.append("")
    lines.append(f"Total keys in use: **{len(vocab)}**")
    lines.append(f"Total scenarios: **{len(scenarios)}** ({len(live_ids)} live, {len(scenarios) - len(live_ids)} deprecated)")
    lines.append("")

    lines.append("## Predicate keys")
    lines.append("")
    lines.append("| Key | Values / pattern | # scenarios | Seen on |")
    lines.append("|-----|------------------|-------------|---------|")
    for key in sorted(vocab.keys()):
        entry = vocab[key]
        values = dict(entry["values"])
        pattern = _value_pattern(values)
        where_bits = []
        if "scenario.predicates" in entry["where"]:
            where_bits.append("scenario")
        if "scenario_applies_when.predicate" in entry["where"]:
            where_bits.append("edge")
        where = " + ".join(where_bits) or "—"
        lines.append(
            f"| `{key}` | {pattern} | {len(entry['scenarios'])} | {where} |"
        )
    lines.append("")

    lines.append("## Per-key detail")
    lines.append("")
    for key in sorted(vocab.keys()):
        entry = vocab[key]
        values = dict(entry["values"])
        lines.append(f"### `{key}`")
        lines.append("")
        if values:
            lines.append("Observed values (value · occurrences):")
            lines.append("")
            for val, n in sorted(values.items(), key=lambda kv: (-kv[1], kv[0])):
                lines.append(f"- `{val}` · {n}")
            lines.append("")
        scn_ids = sorted(entry["scenarios"])
        lines.append(f"Used by {len(scn_ids)} scenario(s):")
        lines.append("")
        for sid in scn_ids:
            title = scn_titles.get(sid, "?")
            tag = " _(deprecated)_" if sid not in live_ids else ""
            lines.append(f"- `{sid}` — {title}{tag}")
        lines.append("")

    if DEPRECATED_KEYS:
        lines.append("## Deprecated keys (retired synonyms)")
        lines.append("")
        lines.append("| Old key | Canonical replacement | Since | Rationale |")
        lines.append("|---------|----------------------|-------|-----------|")
        for old, meta in sorted(DEPRECATED_KEYS.items()):
            lines.append(
                f"| `{old}` | `{meta.get('replacement', '')}` | "
                f"{meta.get('since', '')} | {meta.get('rationale', '')} |"
            )
        lines.append("")
    else:
        lines.append("## Deprecated keys (retired synonyms)")
        lines.append("")
        lines.append("_None yet. When a predicate key is retired in favour of a canonical spelling, "
                     "add it to `DEPRECATED_KEYS` in `generate_predicate_vocabulary.py` so the CI "
                     "gate can surface the mapping._")
        lines.append("")

    return "\n".join(lines) + "\n"


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            scenarios, edges = _fetch(cur)
    except Exception as e:  # noqa: BLE001
        print(f"FAILED to fetch scenarios / edges: {e}")
        return 1
    finally:
        conn.close()

    vocab = _collect(scenarios, edges)
    body = _render(vocab, scenarios)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    prior = OUTPUT_PATH.read_text(encoding="utf-8") if OUTPUT_PATH.exists() else ""
    OUTPUT_PATH.write_text(body, encoding="utf-8", newline="\n")

    if prior == body:
        print(f"OK — {OUTPUT_PATH.relative_to(Path.cwd())} unchanged "
              f"({len(vocab)} keys, {len(scenarios)} scenarios).")
    else:
        print(f"REGENERATED — {OUTPUT_PATH.relative_to(Path.cwd())} "
              f"({len(vocab)} keys, {len(scenarios)} scenarios).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
