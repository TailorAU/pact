#!/usr/bin/env python3
"""1192 chunk A — Apply quote-rates schema (item_key_mapping + links + retailers + 14 v1 keys).

Idempotent. Safe to re-run. Reads `sql/quote-rates-1192-schema.sql` from the
repo and executes it as a single transaction against $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/apply_quote_rates_schema.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 required. Install: pip install psycopg2-binary")
    sys.exit(2)


SCHEMA_FILE = Path(__file__).resolve().parent.parent / "sql" / "quote-rates-1192-schema.sql"


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    if not SCHEMA_FILE.exists():
        print(f"ERROR: schema file not found at {SCHEMA_FILE}")
        return 1

    sql = SCHEMA_FILE.read_text(encoding="utf-8")
    print(f"Applying {SCHEMA_FILE.name} ({len(sql)} bytes)")

    conn = psycopg2.connect(url)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(sql)
        # Sanity print: count what landed
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM market.item_key_mapping WHERE deprecated_at IS NULL")
            keys = cur.fetchone()[0]
            cur.execute(
                "SELECT count(*) FROM market.retailers WHERE slug IN "
                "('bunnings', 'mitre-10', 'reece', 'beaumont-tiles', 'tradelink')"
            )
            retailers = cur.fetchone()[0]
        print(f"OK - applied. {keys} active item keys, {retailers} hardware retailers seeded.")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
