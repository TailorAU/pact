#!/usr/bin/env python3
"""#1160 Round 6.1 — Backfill a `create` revision for every existing scenario.

Per handoff §11.9 acceptance: `scenario_revisions` live on prod, backfilled
with one row per existing scenario (revision_kind='create',
trigger_code='T10', changed_by='seed-initial').

Idempotent: uses the deterministic `record_revision` id so re-runs collide
on PK and insert nothing. Safe to run before or after the cluster seeds.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/backfill_scenario_revisions.py
"""
from __future__ import annotations

import sys

from _scenario_seed_helpers import connect, record_revision, _fetch_scenario_row


def main() -> int:
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM scenarios ORDER BY id")
                rows = cur.fetchall()
                total = 0
                for (scenario_id,) in rows:
                    after = _fetch_scenario_row(cur, scenario_id)
                    if after is None:
                        continue
                    record_revision(
                        cur, scenario_id,
                        revision_kind="create",
                        before_state=None,
                        after_state=after,
                        trigger_code="T10",
                        trigger_detail="initial backfill #1160",
                        changed_by="seed-initial",
                    )
                    total += 1
                print(f"OK - backfilled {total} scenarios (duplicate rows de-duped by PK).")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
