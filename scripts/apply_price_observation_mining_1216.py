#!/usr/bin/env python3
"""1216 chunk B — Apply price_observation_mining schema (defects table).

Idempotent. Safe to re-run.

Usage (local):
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/apply_price_observation_mining_1216.py

Usage (CI via gh workflow):
    gh workflow run migrate-source.yml -f migration=apply_price_observation_mining_1216
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


SCHEMA_FILE = (
    Path(__file__).resolve().parent.parent
    / "sql"
    / "price-observation-mining-1216-schema.sql"
)


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
        with conn.cursor() as cur:
            cur.execute(
                "SELECT to_regclass('market.price_observation_defects') IS NOT NULL"
            )
            (defects_ok,) = cur.fetchone()
        print(f"OK - applied. price_observation_defects table exists: {defects_ok}")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
