#!/usr/bin/env python3
"""#1152 Round 2 — Seed defence scenarios (AU export, generic DSGL, inbound FDI).

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_scenarios_defence.py
"""
from _scenario_seed_helpers import (  # noqa: E402
    connect, upsert_scenario, add_applies_when,
    topic_id_by_title_prefix, summarise,
)


SCENARIOS = [
    {
        "id": "scn.au-defence-export-to-us",
        "title": "AU defence exporter selling to a US counterparty",
        "description": (
            "An Australian-registered entity is supplying DSGL-listed defence or dual-use "
            "technology to a US counterparty. Triggers DTCA 2012 (permit), Customs Act 1901 "
            "s 112 (prohibited-exports), WMD Act 1995 (catch-all), and — depending on the "
            "AUKUS-exemption status of the specific item — either a full DTCA permit or the "
            "22 CFR 126.7 / DTCA Amendment Act 2024 reciprocal path."
        ),
        "industry": "defence",
        "predicates": {
            "country_of_operation": "AU",
            "counterparty_country": "US",
            "product_class": "defence_dual_use",
        },
        "tags": ["defence", "export-control", "aukus"],
        "topic_links": [
            ("Defence Trade Controls Act 2012 (Cth) regulates export",
             {"required": True}, "Primary permit regime"),
            ("Defence and Strategic Goods List (DSGL) enumerates",
             {"required": True}, "Controlled-goods schedule"),
            ("Customs Act 1901 (Cth) prohibited-exports regime",
             {"required": True}, "Criminal enforcement"),
            ("Weapons of Mass Destruction (Prevention of Proliferation) Act 1995",
             {"required": True, "condition": "end_use_uncertain"},
             "Catch-all if WMD end-use suspected"),
            ("AUKUS Pillar 2 establishes trilateral",
             {"required": False, "condition": "aukus_exemption_eligible"},
             "Exemption pathway if item qualifies"),
            ("Defence Industry Security Program (DISP)",
             {"required": False, "condition": "classified_data_exchange"},
             "Required if classified Defence data is exchanged"),
        ],
        "legislation_links": [
            ("cth/act-2012-153", {"required": True}, "DTCA 2012"),
            ("cth/act-1995-072", {"required": True}, "WMD Act 1995"),
            ("cth/act-1987-008", {"required": False, "condition": "nuclear_material_involved"},
             "Safeguards Act 1987 if nuclear material"),
        ],
    },
    {
        "id": "scn.au-defence-export-generic",
        "title": "AU entity exporting DSGL-listed technology (any destination)",
        "description": (
            "General AU defence/dual-use export. Applies the DTCA + Customs Act + DSGL + WMD "
            "Act stack with no AUKUS exemption path. Autonomous Sanctions regime activates "
            "only when the destination country or end-user is designated."
        ),
        "industry": "defence",
        "predicates": {
            "country_of_operation": "AU",
            "product_class": "dsgl_listed",
        },
        "tags": ["defence", "export-control"],
        "topic_links": [
            ("Defence Trade Controls Act 2012 (Cth) regulates export",
             {"required": True}, "Primary permit regime"),
            ("Defence and Strategic Goods List (DSGL) enumerates",
             {"required": True}, "Controlled-goods schedule"),
            ("Customs Act 1901 (Cth) prohibited-exports regime",
             {"required": True}, "Criminal enforcement"),
            ("Weapons of Mass Destruction (Prevention of Proliferation) Act 1995",
             {"required": True}, "Catch-all"),
            ("Autonomous Sanctions Act 2011 (Cth) authorises",
             {"required": False, "condition": "destination_is_sanctioned"},
             "Activates on sanctioned destination / end-user"),
        ],
        "legislation_links": [
            ("cth/act-2012-153", {"required": True}, "DTCA 2012"),
            ("cth/act-1995-072", {"required": True}, "WMD Act 1995"),
        ],
    },
    {
        "id": "scn.au-inbound-defence-investment",
        "title": "Foreign investor acquiring stake in an AU defence-industry company",
        "description": (
            "Any foreign-person acquisition in an Australian business classified as a national-"
            "security business or on the critical-technologies list triggers mandatory FIRB "
            "notification under FATA 1975 s 55B, irrespective of transaction value. NSLA EFI "
            "obligations apply where the foreign principal engages in covert or deceptive "
            "conduct. DISP flow-down clauses may apply to the merged entity."
        ),
        "industry": "defence",
        "predicates": {
            "country_of_operation": "AU",
            "transaction_type": "foreign_investment",
            "target_industry": "defence",
        },
        "tags": ["defence", "foreign-investment"],
        "topic_links": [
            ("FIRB critical-technologies list triggers",
             {"required": True}, "FATA 1975 s 55B mandatory notification"),
            ("National Security Legislation Amendment (Espionage and Foreign Interference) Act 2018",
             {"required": False, "condition": "covert_or_deceptive_conduct"},
             "Criminal offences for covert influence"),
            ("Defence Industry Security Program (DISP)",
             {"required": False, "condition": "target_handles_classified"},
             "DISP review of merged-entity clearance"),
        ],
        "legislation_links": [],
    },
]


def run() -> int:
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                created_scenarios = 0
                created_edges = 0
                total_edges = 0
                for scn in SCENARIOS:
                    cur.execute("SELECT 1 FROM scenarios WHERE id = %s", (scn["id"],))
                    existed_before = cur.fetchone() is not None
                    upsert_scenario(cur, scn["id"], scn["title"], scn["description"],
                                    scn["industry"], scn["predicates"], scn["tags"])
                    if not existed_before:
                        created_scenarios += 1
                        print(f"  CREATED scenario {scn['id']}")
                    else:
                        print(f"  UPDATED scenario {scn['id']}")
                    for title_prefix, predicate, note in scn["topic_links"]:
                        topic_id = topic_id_by_title_prefix(cur, title_prefix)
                        total_edges += 1
                        if not topic_id:
                            print(f"    SKIP (no topic): '{title_prefix[:60]}...'")
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
                summarise("Scenarios", created_scenarios, len(SCENARIOS))
                summarise("Applies-when edges", created_edges, total_edges)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(run())
