#!/usr/bin/env python3
"""#1160 Round 6.1 — Apply scenario_revisions audit table.

Creates `scenario_revisions` and its indices. Idempotent (IF NOT EXISTS),
so safe to re-run. The same statements are appended to
`sovereign-decision-layer-schema.sql`; this focused runner lets operators
apply the Round 6 delta without re-running the full schema file.

Usage:
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/apply_1160_round6_tables.py
"""
from __future__ import annotations

import os
import re
import sys

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 required. Install: pip install psycopg2-binary")
    sys.exit(2)


STATEMENTS: list[str] = [
    """CREATE TABLE IF NOT EXISTS scenario_revisions (
      id              TEXT PRIMARY KEY,
      scenario_id     TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      revision_kind   TEXT NOT NULL,
      trigger_code    TEXT NOT NULL,
      trigger_detail  TEXT,
      before_state    JSONB,
      after_state     JSONB NOT NULL,
      edges_delta     JSONB,
      changed_by      TEXT NOT NULL,
      commit_sha      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS scenario_revisions_scenario_idx ON scenario_revisions (scenario_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS scenario_revisions_trigger_idx ON scenario_revisions (trigger_code)",
    # #1160 Round 6.2 — deprecation + supersession
    "ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ",
    "ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS superseded_by TEXT REFERENCES scenarios(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS scenarios_deprecated_idx ON scenarios (deprecated_at)",
]


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    print(f"Applying {len(STATEMENTS)} #1160 Round 6.1 statements")
    conn = psycopg2.connect(url)
    try:
        with conn:
            with conn.cursor() as cur:
                for i, stmt in enumerate(STATEMENTS, 1):
                    head = re.sub(r"\s+", " ", stmt)[:100]
                    print(f"  [{i}/{len(STATEMENTS)}] {head}")
                    cur.execute(stmt)
        print("OK - #1160 Round 6.1 tables applied.")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
