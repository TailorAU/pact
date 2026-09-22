#!/usr/bin/env python3
"""#1160 Round 1 — Backfill source_ref + jurisdiction for the 9 legacy scenarios.

The #1152 seed scripts predated the scenarios.source_ref / scenarios.jurisdiction
columns. This one-shot backfill maps each legacy scenario id → its lead statute
citation + jurisdiction so the golden test harness (Round 4) passes its
non-empty-source_ref assertion against all 9 existing scenarios.

Idempotent:
  - Uses UPDATE with a guarded WHERE clause (source_ref IS NULL) to preserve any
    existing value from an earlier run. A re-run is a no-op.
  - Any scenario not in the mapping (e.g. new clusters from Round 2) is left alone.

Usage:
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/backfill_scenario_metadata.py
"""
from __future__ import annotations

import os
import sys

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 required. Install: pip install psycopg2-binary")
    sys.exit(2)


# scenario_id -> (jurisdiction, source_ref)
# Jurisdiction uses the ADR-003 §C convention: AU | US | AU-US for bilateral.
# source_ref cites the LEAD statute / listing rule / framework — additional
# instruments are captured via scenario_applies_when edges, not this column.
LEGACY_METADATA: dict[str, tuple[str, str]] = {
    # Defence cluster (#1152 seed_scenarios_defence.py)
    "scn.au-defence-export-to-us": (
        "AU",
        "Defence Trade Controls Act 2012 (Cth) s 10",
    ),
    "scn.au-defence-export-generic": (
        "AU",
        "Defence Trade Controls Act 2012 (Cth) s 10",
    ),
    "scn.au-inbound-defence-investment": (
        "AU",
        "Foreign Acquisitions and Takeovers Act 1975 (Cth) Part 3 (national security review)",
    ),
    # Critical-minerals cluster (#1152 seed_scenarios_critical_minerals.py)
    "scn.au-critical-mineral-export-license": (
        "AU",
        "Customs Act 1901 (Cth) s 112 (prohibited-exports); Customs (Prohibited Exports) Regulations 1958",
    ),
    "scn.us-antimony-federal-lands-permit": (
        "US",
        "43 CFR Part 3809 (BLM surface-management regulations); National Environmental Policy Act 42 USC 4321",
    ),
    "scn.us-defence-procurement-aukus-priority": (
        "US",
        "DFARS 252.225-7052 (Restriction on the Acquisition of Certain Magnets and Tungsten)",
    ),
    "scn.au-us-critical-mineral-offtake": (
        "AU-US",
        "AUKUS Critical Minerals Cooperation (2023) joint statement; Customs Act 1901 (Cth) s 112",
    ),
    # ASX cluster (#1152 seed_scenarios_asx.py)
    "scn.au-asx-listed-material-info": (
        "AU",
        "ASX Listing Rule 3.1 (Continuous Disclosure) + Guidance Note 8",
    ),
    "scn.au-asx-listed-foreign-ownership": (
        "AU",
        "ASX Listing Rule 3.1 + Foreign Acquisitions and Takeovers Act 1975 (Cth)",
    ),
}


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    updated = 0
    already_set = 0
    not_found = 0

    conn = psycopg2.connect(url)
    try:
        with conn:
            with conn.cursor() as cur:
                for scenario_id, (jurisdiction, source_ref) in LEGACY_METADATA.items():
                    cur.execute(
                        "SELECT source_ref, jurisdiction FROM scenarios WHERE id = %s",
                        (scenario_id,),
                    )
                    row = cur.fetchone()
                    if row is None:
                        print(f"  SKIP (not found): {scenario_id}")
                        not_found += 1
                        continue
                    existing_ref, existing_jur = row
                    if existing_ref and existing_jur:
                        already_set += 1
                        continue
                    cur.execute(
                        """
                        UPDATE scenarios
                        SET source_ref   = COALESCE(source_ref,   %s),
                            jurisdiction = COALESCE(jurisdiction, %s),
                            updated_at   = now()
                        WHERE id = %s
                        """,
                        (source_ref, jurisdiction, scenario_id),
                    )
                    updated += 1
                    print(f"  UPDATED: {scenario_id} -> {jurisdiction} | {source_ref[:60]}")

        print(
            f"OK — {updated} updated / {already_set} already set / "
            f"{not_found} not found / {len(LEGACY_METADATA)} candidates"
        )
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
