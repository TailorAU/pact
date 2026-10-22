#!/usr/bin/env python3
"""#1152 Round 1b — Backfill topic_legislation_citations.

Explicit, hand-curated topic→legislation mapping. **Not** a fuzzy matcher —
`topics.source_ref` is multi-citation prose and regex matching produces
silent misses. Every mapping below was reviewed against the #1137 seed data.

Rules:
* Idempotent (UNIQUE(topic_id, legislation_id) in schema; INSERT ... ON CONFLICT DO NOTHING).
* A topic whose citation has no matching legislation_docs row is skipped
  (graceful degradation — the node still renders on /map without a cites edge).
* Script matches topics by their exact seed-script title; missing topics are
  reported but not fatal.
* A legislation_id that does not resolve in legislation_docs is still inserted
  (the FK is deliberately not enforced so forward-references survive).

Usage:
    $env:DATABASE_URL = "postgres://..."   # PowerShell
    python sites/source/scripts/backfill_topic_legislation_citations.py
"""
import hashlib
import os
import sys

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 required. Install via: pip install psycopg2-binary")
    sys.exit(2)


# (topic_title_prefix_or_exact, legislation_docs.id or None, citation_text)
# None means "no matching legislation_doc in Source today" — skipped.
# The prefix search matches if `topics.title` starts with the provided string;
# use enough characters to be unique across the seed corpus.
CITATIONS: list[tuple[str, str | None, str]] = [
    # ── from seed_defence_au.py ────────────────────────────────────
    ("Defence Trade Controls Act 2012 (Cth) regulates export",
     "cth/act-2012-153", "Defence Trade Controls Act 2012 (Cth), Act No. 153 of 2012"),
    ("Customs Act 1901 (Cth) prohibited-exports regime",
     "cth/act-1901-006", "Customs Act 1901 (Cth) s 112"),
    ("ASX Listing Rule 3.1 requires immediate disclosure",
     None, "ASX Listing Rules Chapter 3, Rule 3.1 (continuous disclosure)"),
    ("JORC Code 2012 governs public reporting",
     None, "JORC Code 2012 (Australasian Code for Reporting of Mineral Resources)"),
    ("Safeguards Act 1987 (Cth) implements",
     "cth/act-1987-008", "Nuclear Non-Proliferation (Safeguards) Act 1987 (Cth), Act No. 8 of 1987"),
    ("Weapons of Mass Destruction (Prevention of Proliferation) Act 1995",
     "cth/act-1995-072", "Weapons of Mass Destruction (Prevention of Proliferation) Act 1995 (Cth)"),
    ("Autonomous Sanctions Act 2011 (Cth) authorises",
     None, "Autonomous Sanctions Act 2011 (Cth) — not yet ingested as legislation_doc"),
    ("National Security Legislation Amendment (Espionage and Foreign Interference) Act 2018",
     None, "NSLA EFI Act 2018 (Cth); Criminal Code 1995 (Cth) Division 92"),
    ("FIRB critical-technologies list triggers",
     None, "Foreign Acquisitions and Takeovers Act 1975 (Cth) s 55B"),
    ("AUKUS Pillar 2 establishes trilateral",
     None, "AUKUS Pillar 2 Joint Leaders Statement (2021); DTC Amendment Act 2024 (Cth); 22 CFR 126.7"),
    ("Defence and Strategic Goods List",
     None, "DSGL — administrative schedule, not a standalone legislation_doc"),
    ("Defence Industry Security Program (DISP)",
     None, "DISP Member Handbook — guidance, not legislation"),

    # ── from seed_defence_us.py (all foreign; no AU legislation_doc rows) ─
    # US frameworks remain as institutional-tier topics with prose canonical
    # claims until #1138 (eCFR parser) lands.

    # ── possible QLD ties for critical-minerals topics (QLD land access) ─
    # These topics are covered in seed_critical_minerals.py; map to the QLD
    # legislation docs that actually live in Source.
    ("Mineral Resources Act 1989 (Qld)",
     "qld/act-1989-minerals", "Mineral Resources Act 1989 (Qld)"),  # not ingested; None also acceptable
]


def topic_id_by_title_prefix(cur, prefix: str) -> str | None:
    cur.execute("SELECT id FROM topics WHERE title LIKE %s ORDER BY created_at ASC LIMIT 1",
                (prefix + "%",))
    row = cur.fetchone()
    return row[0] if row else None


def legislation_exists(cur, leg_id: str) -> bool:
    cur.execute("SELECT 1 FROM legislation_docs WHERE id = %s", (leg_id,))
    return cur.fetchone() is not None


def upsert_citation(cur, topic_id: str, leg_id: str, citation: str) -> bool:
    """Returns True if a new row was inserted, False if it already existed."""
    # Deterministic id so re-runs produce the exact same primary keys.
    raw = f"tlc:{topic_id}:{leg_id}".encode("utf-8")
    cid = hashlib.sha256(raw).hexdigest()[:24]
    cur.execute(
        """
        INSERT INTO topic_legislation_citations (id, topic_id, legislation_id, citation_text)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (topic_id, legislation_id) DO NOTHING
        """,
        (cid, topic_id, leg_id, citation),
    )
    return cur.rowcount == 1


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        return 1

    conn = psycopg2.connect(url)
    inserted = 0
    skipped_no_topic = 0
    skipped_no_leg = 0
    already = 0

    try:
        with conn:
            with conn.cursor() as cur:
                for prefix, leg_id, citation in CITATIONS:
                    if leg_id is None:
                        skipped_no_leg += 1
                        continue
                    topic_id = topic_id_by_title_prefix(cur, prefix)
                    if not topic_id:
                        print(f"  SKIP (no topic): '{prefix[:70]}...'")
                        skipped_no_topic += 1
                        continue
                    if not legislation_exists(cur, leg_id):
                        print(f"  SKIP (no legislation_doc {leg_id}): '{prefix[:70]}...'")
                        skipped_no_leg += 1
                        continue
                    if upsert_citation(cur, topic_id, leg_id, citation):
                        print(f"  CREATED {topic_id[:8]}...->{leg_id}")
                        inserted += 1
                    else:
                        already += 1
    finally:
        conn.close()

    print()
    print(f"Inserted:          {inserted}")
    print(f"Already existed:   {already}")
    print(f"Skipped (no topic):{skipped_no_topic}")
    print(f"Skipped (no leg):  {skipped_no_leg}")
    print(f"Total candidates:  {len(CITATIONS)}")
    if inserted + already < 10:
        print("NOTE: <10 citation edges total. /map will still render legislation nodes; "
              "scenario applies_when edges (Round 2) provide the connective tissue.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
