#!/usr/bin/env python3
"""Apply phase-0 retailer half + #1192 chunk A schema (combined).

Backfills the missing retailer/products/price_observations tables on prod
source-pg-prod (where only the fuel half of phase-0 was applied historically),
then applies the chunk A item-key mapping. Idempotent.

Usage (local):
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/apply_phase_0_retailer_half_1192.py

Usage (CI via gh workflow):
    gh workflow run migrate.yml -f migration=apply_phase_0_retailer_half_1192
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
    / "phase-0-retailer-half-1192.sql"
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
        # Sanity counts
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM market.retailers WHERE slug IN "
                "('coles','woolworths','amazon-au','iga','chemist-wh','bunnings',"
                "'kmart','bigw','ebay-au','target','mitre-10','reece',"
                "'beaumont-tiles','tradelink')"
            )
            retailers = cur.fetchone()[0]
            cur.execute(
                "SELECT count(*) FROM market.item_key_mapping WHERE deprecated_at IS NULL"
            )
            keys = cur.fetchone()[0]
            cur.execute(
                "SELECT to_regclass('market.products') IS NOT NULL, "
                "to_regclass('market.price_observations') IS NOT NULL, "
                "to_regclass('market.latest_prices') IS NOT NULL"
            )
            products_ok, obs_ok, mv_ok = cur.fetchone()
        print(
            f"OK - applied. {retailers}/14 retailers seeded, "
            f"{keys} active item keys, "
            f"products={products_ok} price_observations={obs_ok} latest_prices_mv={mv_ok}"
        )
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
