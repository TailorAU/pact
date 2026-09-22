#!/usr/bin/env python3
"""#1152 Round 2 — Seed critical-minerals scenarios.

Covers AU critical-mineral export licensing, US federal-lands permitting, DoD
AUKUS-priority procurement, and AU↔US offtake.

Idempotent. Requires $DATABASE_URL.
"""
from _scenario_seed_helpers import (  # noqa: E402
    connect, upsert_scenario, add_applies_when,
    topic_id_by_title_prefix, summarise,
)


SCENARIOS = [
    {
        "id": "scn.au-critical-mineral-export-license",
        "title": "AU miner exporting critical minerals to a foreign processor",
        "description": (
            "Australian critical-minerals exporter (rare earths, antimony, lithium, cobalt, "
            "graphite) shipping concentrate or refined product outside Australia. Safeguards "
            "Act applies to monazite and rare-earth concentrates containing source-material "
            "isotopes. ASX LR 3.1 + JORC 2012 govern continuous disclosure if the exporter is "
            "ASX-listed. Autonomous Sanctions restrict destination/end-user."
        ),
        "industry": "critical_minerals",
        "predicates": {
            "country_of_operation": "AU",
            "product_class": "critical_mineral",
            "counterparty_country": "!AU",
        },
        "tags": ["critical-minerals", "export"],
        "topic_links": [
            ("Safeguards Act 1987 (Cth) implements",
             {"required": False, "condition": "contains_source_material_isotopes"},
             "Monazite / rare-earth concentrates"),
            ("ASX Listing Rule 3.1 requires immediate disclosure",
             {"required": False, "condition": "entity_is_asx_listed"},
             "Continuous disclosure for listed exporters"),
            ("JORC Code 2012 governs public reporting",
             {"required": False, "condition": "entity_is_asx_listed"},
             "Resource/reserve reporting for listed exporters"),
            ("Autonomous Sanctions Act 2011 (Cth) authorises",
             {"required": False, "condition": "destination_is_sanctioned"},
             "Activates on sanctioned destination"),
            ("Customs Act 1901 (Cth) prohibited-exports regime",
             {"required": False, "condition": "mineral_has_dual_use_classification"},
             "If mineral crosses dual-use threshold"),
        ],
        "legislation_links": [
            ("cth/act-1987-008", {"required": False, "condition": "contains_source_material_isotopes"},
             "Safeguards Act 1987"),
        ],
    },
    {
        "id": "scn.us-antimony-federal-lands-permit",
        "title": "US miner permitting critical-mineral extraction on BLM land",
        "description": (
            "A US operator permitting critical-mineral extraction on US federal (BLM-managed) "
            "land. Triggers NEPA environmental review, BLM 43 CFR 3809 surface-management "
            "rules, and — if DoD Title III or IRA funding is involved — federal procurement "
            "and Buy American linkages."
        ),
        "industry": "critical_minerals",
        "predicates": {
            "country_of_operation": "US",
            "product_class": "critical_mineral",
            "land_classification": "federal",
        },
        "tags": ["critical-minerals", "us-federal", "permitting"],
        "topic_links": [
            ("NEPA",
             {"required": True}, "Environmental review"),
            ("BLM",
             {"required": True}, "Surface-management rules"),
            ("DPA Title III",
             {"required": False, "condition": "dod_funding_involved"},
             "Defense Production Act if DoD-funded"),
            ("Buy American",
             {"required": False, "condition": "federal_procurement"},
             "If output sold to federal programme"),
        ],
        "legislation_links": [],
    },
    {
        "id": "scn.us-defence-procurement-aukus-priority",
        "title": "DoD prime contracting a defence good with AUKUS-priority minerals",
        "description": (
            "A US Department of Defense prime contractor procuring a defence good whose bill-"
            "of-materials includes AUKUS-priority critical minerals. DFARS 252.225-7052 "
            "restricts sourcing; ITAR applies to the end-item; AUKUS Pillar 2 creates a "
            "reciprocal exemption pathway for AU/UK-origin content."
        ),
        "industry": "defence",
        "predicates": {
            "country_of_operation": "US",
            "program": "DoD",
            "includes_aukus_minerals": True,
        },
        "tags": ["defence", "us-federal", "aukus"],
        "topic_links": [
            ("DFARS",
             {"required": True}, "Specialty metals / prohibited sources clause"),
            ("ITAR",
             {"required": True}, "Export control on the end-item"),
            ("AUKUS Pillar 2 establishes trilateral",
             {"required": False, "condition": "aukus_origin_content"},
             "Reciprocal exemption pathway"),
            ("AUKUS Critical Minerals",
             {"required": False, "condition": "aukus_origin_content"},
             "Cooperation framework"),
        ],
        "legislation_links": [],
    },
    {
        "id": "scn.au-us-critical-mineral-offtake",
        "title": "AU critical-minerals producer signs offtake with US buyer",
        "description": (
            "Long-term offtake between an AU producer and a US buyer — typically for rare "
            "earths, lithium, cobalt or antimony. AU side: FIRB critical-technology review if "
            "the buyer takes equity. US side: IRA Section 45X production tax credit / Section "
            "30D critical-mineral sourcing rules. Both sides: AUKUS Critical Minerals "
            "Cooperation Framework + Quad CM Partnership."
        ),
        "industry": "critical_minerals",
        "predicates": {
            "country_of_operation": "AU",
            "counterparty_country": "US",
            "product_class": "critical_mineral",
        },
        "tags": ["critical-minerals", "au-us"],
        "topic_links": [
            ("FIRB critical-technologies list triggers",
             {"required": False, "condition": "buyer_takes_equity"},
             "FATA s 55B if equity acquisition"),
            ("IRA critical-minerals",
             {"required": True}, "US demand-side pull"),
            ("AUKUS Critical Minerals",
             {"required": False}, "Trilateral cooperation framework"),
            ("Quad",
             {"required": False}, "Quad CM Partnership"),
            ("AU Critical Minerals Strategy",
             {"required": False}, "AU supply-side pull"),
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
