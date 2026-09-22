"""#1170 Round 3 — Orphaned `applies_when` edge audit.

Reports rows in `scenario_applies_when` whose `topic_id` points at a topic that
doesn't exist in `topics`. If the count is > 0 the orphan edges must be
reconciled (reseed stubs or hard-delete edges). If 0, the Round 7 `edges=0
resolved` signal was purely the handler bug fixed in R1+R2.

Usage (from an IP allowlisted on source-pg-prod):

    $env:DATABASE_URL = "postgresql://...@source-pg-prod.postgres.database.azure.com:5432/source?sslmode=require"
    python sites/source/scripts/audit_orphaned_applies_when.py
"""
import os
import sys

import psycopg2


def main() -> int:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        return 2

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT saw.id, saw.scenario_id, saw.topic_id
        FROM scenario_applies_when saw
        LEFT JOIN topics t ON t.id = saw.topic_id
        WHERE saw.topic_id IS NOT NULL AND t.id IS NULL
        ORDER BY saw.scenario_id, saw.topic_id
        """
    )
    rows = cur.fetchall()
    print(f"Orphaned edges: {len(rows)}")
    for r in rows:
        print(f"  edge={r[0]}  scenario={r[1]}  missing_topic={r[2]}")

    cur.execute("SELECT COUNT(*) FROM scenario_applies_when WHERE topic_id IS NOT NULL")
    total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM topics")
    topic_count = cur.fetchone()[0]
    print(f"Total applies_when edges with topic_id: {total}")
    print(f"Total topics: {topic_count}")

    conn.close()
    return 0 if not rows else 1


if __name__ == "__main__":
    sys.exit(main())
