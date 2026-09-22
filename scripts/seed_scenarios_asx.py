#!/usr/bin/env python3
"""#1152 Round 2 — Seed ASX / foreign-control scenarios.

Idempotent. Requires $DATABASE_URL.
"""
from _scenario_seed_helpers import (  # noqa: E402
    connect, upsert_scenario, add_applies_when,
    topic_id_by_title_prefix, summarise,
)


SCENARIOS = [
    {
        "id": "scn.au-asx-listed-material-info",
        "title": "ASX-listed entity receives price-sensitive information",
        "description": (
            "An ASX-listed entity receives information that a reasonable person would expect "
            "to materially affect the price or value of its securities. ASX Listing Rule 3.1 "
            "requires immediate disclosure (subject to 3.1A exceptions), backed by "
            "Corporations Act s 674 (statutory continuous disclosure) and s 180-181 director "
            "duties. For mining/exploration companies, JORC 2012 sign-off rules apply via LR 5.6."
        ),
        "industry": "asx_listed",
        "predicates": {
            "country_of_operation": "AU",
            "listing": "ASX",
            "event": "material_information_received",
        },
        "tags": ["asx", "continuous-disclosure"],
        "topic_links": [
            ("ASX Listing Rule 3.1 requires immediate disclosure",
             {"required": True}, "LR 3.1 + 3.1A"),
            ("JORC Code 2012 governs public reporting",
             {"required": False, "condition": "entity_is_mining_or_exploration"},
             "LR 5.6 Competent Person sign-off"),
        ],
        "legislation_links": [],
    },
    {
        "id": "scn.au-asx-listed-foreign-ownership",
        "title": "ASX-listed mining entity with foreign-ownership / critical-tech exposure",
        "description": (
            "An ASX-listed entity with critical-minerals or critical-technology exposure "
            "experiences a foreign-person acquisition event (placement, SPP, takeover). "
            "Compounds FIRB critical-technologies notification, ASX LR 3.1 continuous "
            "disclosure, and — if classified Defence work is part of the business — DISP flow-"
            "down and NSLA EFI insider-risk obligations."
        ),
        "industry": "asx_listed",
        "predicates": {
            "country_of_operation": "AU",
            "listing": "ASX",
            "transaction_type": "foreign_acquisition",
            "has_critical_tech_or_minerals": True,
        },
        "tags": ["asx", "foreign-investment", "critical-minerals"],
        "topic_links": [
            ("FIRB critical-technologies list triggers",
             {"required": True}, "FATA s 55B notification"),
            ("ASX Listing Rule 3.1 requires immediate disclosure",
             {"required": True}, "Disclosure of the acquisition event"),
            ("National Security Legislation Amendment (Espionage and Foreign Interference) Act 2018",
             {"required": False, "condition": "defence_or_classified_exposure"},
             "Insider-threat / foreign-influence"),
            ("Defence Industry Security Program (DISP)",
             {"required": False, "condition": "defence_or_classified_exposure"},
             "Clearance review on the merged entity"),
        ],
        "legislation_links": [],
    },
]


def run() -> int:
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                created = 0
                created_edges = 0
                total_edges = 0
                for scn in SCENARIOS:
                    cur.execute("SELECT 1 FROM scenarios WHERE id = %s", (scn["id"],))
                    existed = cur.fetchone() is not None
                    upsert_scenario(cur, scn["id"], scn["title"], scn["description"],
                                    scn["industry"], scn["predicates"], scn["tags"])
                    if not existed:
                        created += 1
                        print(f"  CREATED scenario {scn['id']}")
                    else:
                        print(f"  UPDATED scenario {scn['id']}")
                    for title_prefix, predicate, note in scn["topic_links"]:
                        topic_id = topic_id_by_title_prefix(cur, title_prefix)
                        total_edges += 1
                        if not topic_id:
                            print(f"    SKIP (no topic): '{title_prefix[:60]}'")
                            continue
                        if add_applies_when(cur, scn["id"], topic_id=topic_id,
                                            predicate=predicate, note=note):
                            created_edges += 1
                    for leg_id, predicate, note in scn["legislation_links"]:
                        total_edges += 1
                        if add_applies_when(cur, scn["id"], legislation_id=leg_id,
                                            predicate=predicate, note=note):
                            created_edges += 1
                print()
                summarise("Scenarios", created, len(SCENARIOS))
                summarise("Applies-when edges", created_edges, total_edges)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(run())
