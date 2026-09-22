#!/usr/bin/env python3
"""#1160 Round 3 — Apply defects + match_request_log tables.

Creates `applicability_spotcheck_defects` and `match_request_log`. Idempotent:
every statement uses IF NOT EXISTS, so the script is safe to re-run. The
same statements are appended to `sovereign-decision-layer-schema.sql` — this
focused runner just lets operators apply the Round 3 delta without re-running
the full schema file.

Usage:
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/apply_1160_round3_tables.py
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
    """CREATE TABLE IF NOT EXISTS applicability_spotcheck_defects (
      id                TEXT PRIMARY KEY,
      scenario_id       TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      submitted_by      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      assignment_id     TEXT REFERENCES agent_work_assignments(id) ON DELETE SET NULL,
      finding_kind      TEXT NOT NULL,
      edge_id           TEXT,
      target_kind       TEXT,
      target_id         TEXT,
      reason            TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open',
      resolved_by       TEXT,
      resolved_at       TIMESTAMPTZ,
      potential_credits INTEGER NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS defects_scenario_idx ON applicability_spotcheck_defects (scenario_id)",
    "CREATE INDEX IF NOT EXISTS defects_status_idx ON applicability_spotcheck_defects (status)",
    """CREATE TABLE IF NOT EXISTS match_request_log (
      id         TEXT PRIMARY KEY,
      predicates JSONB NOT NULL,
      agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS match_log_created_idx ON match_request_log (created_at DESC)",
]


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    print(f"Applying {len(STATEMENTS)} #1160 Round 3 statements")
    conn = psycopg2.connect(url)
    try:
        with conn:
            with conn.cursor() as cur:
                for i, stmt in enumerate(STATEMENTS, 1):
                    head = re.sub(r"\s+", " ", stmt)[:100]
                    print(f"  [{i}/{len(STATEMENTS)}] {head}")
                    cur.execute(stmt)
        print("OK — #1160 Round 3 tables applied.")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
