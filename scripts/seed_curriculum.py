#!/usr/bin/env python3
"""
Seed authoritative Australian curriculum descriptors (ACARA v9 / EYLF) into
Source's curriculum API (#2520).

WHAT SHIPS WITHOUT THIS SCRIPT
------------------------------
The representative vertical slice — ACARA v9 English + Mathematics for
Foundation, Year 3 and Year 6, plus the five EYLF v2.0 Learning Outcomes — is
seeded automatically by the Source app on first boot via
`seedCurriculum()` (see `sites/source/src/lib/curriculum-seed.ts`, wired into
`initSchema()` in `src/lib/db.ts`). That data is version-controlled and ships
live with every deploy. You do NOT need to run this script for the slice.

WHAT THIS SCRIPT IS FOR
-----------------------
Bulk-loading GRADES BEYOND the seeded slice as the pattern expands (the
remaining F-10 years + senior secondary). It hits the admin-gated ingest
endpoint, exactly like `seed_sa_tas_legislation.py` does for legislation.

HONESTY CONSTRAINT (#2520)
--------------------------
Every `code` MUST be a real ACARA / EYLF identifier and every `descriptor`
MUST be verbatim public text from the official framework documents
(https://v9.australiancurriculum.edu.au, ACECQA EYLF V2.0). If you are unsure
of an exact code, OMIT the row — do not invent codes. The ingest endpoint
rejects rows missing a code or descriptor.

Usage:
    python scripts/seed_curriculum.py [--base-url URL] [--admin-key KEY]

Defaults:
    --base-url  https://source.tailor.au   (or $SOURCE_BASE_URL)
    --admin-key reads from $ADMIN_SECRET
"""

import argparse
import os
import sys

import requests


DEFAULT_BASE = "https://source.tailor.au"


# Frameworks the descriptors below reference. Idempotently upserted.
FRAMEWORKS = [
    {
        "id": "acara-v9",
        "name": "Australian Curriculum Version 9.0",
        "shortName": "ACARA v9",
        "authority": "Australian Curriculum, Assessment and Reporting Authority (ACARA)",
        "jurisdiction": "AU",
        "version": "9.0",
        "frameworkUrl": "https://v9.australiancurriculum.edu.au",
    },
]


# Example expansion payload — REAL ACARA v9 Year 5 English descriptors, verbatim
# from the official "English — Curriculum content F-6" document. This both
# demonstrates the bulk-load shape and genuinely extends coverage to Year 5
# English when the script is run. Add further grades/subjects here as the
# follow-up issue is delivered.
DESCRIPTORS = [
    {
        "frameworkId": "acara-v9",
        "code": "AC9E5LY06",
        "level": "5",
        "levelName": "Year 5",
        "subject": "English",
        "learningArea": "English",
        "strand": "Literacy — Creating texts",
        "title": "Plan and create informative and persuasive texts",
        "descriptor": (
            "plan, create, edit and publish written and multimodal texts whose "
            "purposes may be imaginative, informative and persuasive, developing "
            "ideas using visual features, text structure appropriate to the topic "
            "and purpose, text connectives, expanded noun groups, specialist and "
            "technical vocabulary, and punctuation including dialogue punctuation"
        ),
        "blurb": "Plan and write a multimodal text that informs or persuades.",
        "sourceRef": "ACARA Australian Curriculum v9.0 — English, Year 5 (Literacy)",
        "sourceUrl": "https://v9.australiancurriculum.edu.au/f-10-curriculum/learning-areas",
    },
    {
        "frameworkId": "acara-v9",
        "code": "AC9E5LE05",
        "level": "5",
        "levelName": "Year 5",
        "subject": "English",
        "learningArea": "English",
        "strand": "Literature — Creating literature",
        "title": "Create literary texts with figurative language",
        "descriptor": (
            "create and edit literary texts, experimenting with figurative "
            "language, storylines, characters and settings from texts students "
            "have experienced"
        ),
        "blurb": "Write a story using figurative language and borrowed ideas.",
        "sourceRef": "ACARA Australian Curriculum v9.0 — English, Year 5 (Literature)",
        "sourceUrl": "https://v9.australiancurriculum.edu.au/f-10-curriculum/learning-areas",
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed ACARA v9 / EYLF curriculum into Source")
    parser.add_argument("--base-url", default=os.environ.get("SOURCE_BASE_URL", DEFAULT_BASE))
    parser.add_argument("--admin-key", default=os.environ.get("ADMIN_SECRET", ""))
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    admin_key = args.admin_key
    if not admin_key:
        print("ERROR: No admin key provided. Set ADMIN_SECRET env var or use --admin-key")
        return 1

    print(f"Seeding {len(DESCRIPTORS)} curriculum descriptor(s) to {base}")

    response = requests.post(
        f"{base}/api/curriculum/ingest",
        json={"frameworks": FRAMEWORKS, "descriptors": DESCRIPTORS},
        headers={"Content-Type": "application/json", "X-Admin-Key": admin_key},
        timeout=60,
    )
    if response.status_code != 200:
        print(f"FAILED: HTTP {response.status_code}")
        print(response.text[:500])
        return 1

    data = response.json()
    print(
        f"SUCCESS: inserted={data.get('inserted')} "
        f"skipped={data.get('skipped')} rejected={len(data.get('rejected', []))}"
    )
    for r in data.get("rejected", []):
        print(f"  REJECTED index {r.get('index')}: {r.get('reason')}")

    print()
    print("API endpoints now available:")
    print(f"  GET {base}/api/curriculum?level=5&subject=English")
    print(f"  GET {base}/api/curriculum?level=3")
    print(f"  GET {base}/api/curriculum?level=EL")
    return 0


if __name__ == "__main__":
    sys.exit(main())
