#!/usr/bin/env python3
"""#1152 Round 1 — Apply the sovereign decision layer schema migration.

Reads sites/source/sql/sovereign-decision-layer-schema.sql and executes every
statement against $DATABASE_URL in a single transaction. Every CREATE uses
IF NOT EXISTS, so the script is idempotent — re-running creates zero rows.

Usage:
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/apply_sovereign_decision_schema.py

Exits non-zero if DATABASE_URL is unset or a statement fails.
"""
import os
import re
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 required. Install via: pip install psycopg2-binary")
    sys.exit(2)

SQL_PATH = Path(__file__).resolve().parent.parent / "sql" / "sovereign-decision-layer-schema.sql"


def split_statements(sql: str) -> list[str]:
    """Split on top-level semicolons; skip blank lines and -- comments.

    The migration has no functions / DO blocks, so naive semicolon splitting is safe.
    """
    # Strip line comments
    cleaned_lines = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        cleaned_lines.append(line)
    cleaned = "\n".join(cleaned_lines)
    return [s.strip() for s in cleaned.split(";") if s.strip()]


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    if not SQL_PATH.is_file():
        print(f"ERROR: SQL file not found at {SQL_PATH}")
        return 1

    sql_text = SQL_PATH.read_text(encoding="utf-8")
    statements = split_statements(sql_text)
    print(f"Loaded {len(statements)} statements from {SQL_PATH.name}")

    conn = psycopg2.connect(url)
    try:
        with conn:
            with conn.cursor() as cur:
                for i, stmt in enumerate(statements, 1):
                    head = re.sub(r"\s+", " ", stmt)[:100]
                    print(f"  [{i:>2}/{len(statements)}] {head}")
                    cur.execute(stmt)
        print("OK — sovereign decision layer schema applied.")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
