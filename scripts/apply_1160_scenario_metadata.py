#!/usr/bin/env python3
"""#1160 Round 1 — Apply the scenario metadata schema delta.

Adds `source_ref`, `jurisdiction`, and `review_count` columns to `scenarios`,
plus a jurisdiction index. Idempotent: every statement uses IF NOT EXISTS
or ADD COLUMN IF NOT EXISTS, so the script is safe to re-run.

This is a focused runner for the #1160 scenario-metadata delta. The full
sovereign-decision-layer schema (which ALSO now includes these statements
at the end of the file) can be applied via apply_sovereign_decision_schema.py.

Usage:
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/apply_1160_scenario_metadata.py

Exits non-zero if DATABASE_URL is unset or a statement fails.
"""
import os
import re
import sys

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 required. Install via: pip install psycopg2-binary")
    sys.exit(2)


STATEMENTS: list[str] = [
    "ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS source_ref TEXT",
    "ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS jurisdiction TEXT",
    "ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS scenarios_jurisdiction_idx ON scenarios (jurisdiction)",
]


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    print(f"Applying {len(STATEMENTS)} #1160 scenario-metadata statements")

    conn = psycopg2.connect(url)
    try:
        with conn:
            with conn.cursor() as cur:
                for i, stmt in enumerate(STATEMENTS, 1):
                    head = re.sub(r"\s+", " ", stmt)[:100]
                    print(f"  [{i}/{len(STATEMENTS)}] {head}")
                    cur.execute(stmt)
        print("OK — #1160 scenario metadata columns applied.")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
