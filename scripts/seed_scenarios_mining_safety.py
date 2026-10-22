#!/usr/bin/env python3
"""#1160 Round 2.1 — Seed QLD mining-safety + environment scenarios (5).

Cites Coal Mining Safety and Health Act 1999 (Qld), CMSH Regulation 2017,
Mining and Quarrying Safety and Health Act 1999 (Qld), Environmental
Protection Act 1994 (Qld), and Mineral Resources Act 1989 (Qld).

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_scenarios_mining_safety.py

Topic linkage strategy: we prefer existing topics (by title prefix) from the
2026-04-08 QLD mining seeds. For fine-grained regulatory concepts not yet in
the topic graph (statutory role appointments, HPI taxonomy, EA class thresholds),
we create stubs via upsert_topic_stub() — a richer PACT topic proposal is
expected to follow. Stubs are clearly marked (status='stub', tier='institutional').
"""
from __future__ import annotations

from _scenario_seed_helpers import (  # noqa: E402
    connect, upsert_scenario, add_applies_when,
    topic_id_by_title_prefix, upsert_topic_stub, summarise,
)


# Legislation IDs known to be ingested (or forward-compat if not yet — see
# _scenario_seed_helpers.py: legislation_id has no FK, following #1152 pattern).
LEG_CMSHA = "qld/act-1999-039"            # Coal Mining Safety and Health Act 1999 (Qld)
LEG_CMSHR = "qld/reg-2017-coal-mining-sh" # Coal Mining Safety and Health Regulation 2017 (forward-ref)
LEG_MQSHA = "qld/act-1999-040"            # Mining and Quarrying Safety and Health Act 1999 (Qld)
LEG_EPACT = "qld/act-1994-062"            # Environmental Protection Act 1994 (Qld)
LEG_MINRES = "qld/act-1989-minerals"      # Mineral Resources Act 1989 (Qld) (forward-ref)


SCENARIOS = [
    {
        "id": "scn.au-qld-coal-mine-safety-role-appointment",
        "title": "QLD coal mine — statutory role appointments (SSE, USM, VO, OCE)",
        "description": (
            "A Queensland coal mine operator must appoint the statutory roles required under "
            "the Coal Mining Safety and Health Act 1999 — Site Senior Executive (SSE), "
            "Underground Mine Manager (USM), Ventilation Officer (VO), and Open-Cut Examiner "
            "(OCE) where relevant — with Board-of-Examiners-issued certificates of competency. "
            "CMSH Regulation 2017 specifies the competency framework; the MQSHA 1999 provides "
            "the parallel scheme for non-coal mines."
        ),
        "industry": "mining_safety",
        "jurisdiction": "AU",
        "source_ref": "Coal Mining Safety and Health Act 1999 (Qld) Part 6 (Safety Roles); CMSH Regulation 2017 ch 2",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "operation_type": "coal_mine",
        },
        "tags": ["mining-safety", "qld", "coal", "statutory-roles"],
        "topic_stubs": [
            {
                "title": "CMSHA 1999 Site Senior Executive appointment",
                "canonical_claim": "Each QLD coal mine must have an appointed Site Senior Executive (SSE) holding a current SSE notice issued by the Board of Examiners.",
                "source_ref": "CMSHA 1999 ss 41-42; CMSH Regulation 2017 r 5",
                "predicate": {"required": True},
                "note": "Core statutory role — no mine without an SSE",
            },
            {
                "title": "CMSH Regulation 2017 competency framework",
                "canonical_claim": "Competency certificates and site-specific notices are issued by the Board of Examiners for statutory safety roles under the CMSHA 1999.",
                "source_ref": "CMSH Regulation 2017 ch 2",
                "predicate": {"required": True},
                "note": "Competency framework",
            },
        ],
        "legislation_links": [
            (LEG_CMSHA, {"required": True}, "Primary safety act"),
            (LEG_CMSHR, {"required": True}, "Competency regulation"),
        ],
    },
    {
        "id": "scn.au-qld-coal-mine-incident-notification",
        "title": "QLD coal mine high-potential incident notification (HPI / serious accident)",
        "description": (
            "When a high-potential incident (HPI) or serious accident occurs at a Queensland "
            "coal mine, the SSE must immediately notify the inspector and provide a written "
            "report. CMSHA 1999 s 198 defines HPI; s 201 sets the notification obligation. "
            "Fatalities additionally engage the QLD industrial manslaughter offence in the WHS Act."
        ),
        "industry": "mining_safety",
        "jurisdiction": "AU",
        "source_ref": "Coal Mining Safety and Health Act 1999 (Qld) ss 198, 201",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "operation_type": "coal_mine",
            "event": "hpi_or_serious",
        },
        "tags": ["mining-safety", "qld", "coal", "incident-notification", "hpi"],
        "topic_stubs": [
            {
                "title": "CMSHA 1999 high-potential incident notification",
                "canonical_claim": "HPIs and serious accidents at QLD coal mines must be reported immediately to the inspector by the SSE, followed by a written report per CMSHA s 201.",
                "source_ref": "CMSHA 1999 ss 198, 201",
                "predicate": {"required": True},
                "note": "Immediate + written report",
            },
        ],
        "legislation_links": [
            (LEG_CMSHA, {"required": True}, "Notification obligation"),
            (LEG_CMSHR, {"required": True, "condition": "procedural_detail"},
             "Regulation specifies form / timing"),
        ],
    },
    {
        "id": "scn.au-qld-mq-quarry-operations",
        "title": "QLD mineral or quarry operations — MQSHA 1999 compliance",
        "description": (
            "Non-coal mining (metalliferous / mineral mines, quarries) in Queensland falls under "
            "the Mining and Quarrying Safety and Health Act 1999. Parallel to the CMSHA 1999, "
            "MQSHA imposes statutory role, risk-management plan, and incident-notification "
            "duties on operators, site senior executives, and workers."
        ),
        "industry": "mining_safety",
        "jurisdiction": "AU",
        "source_ref": "Mining and Quarrying Safety and Health Act 1999 (Qld)",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "operation_type": "quarry_or_mineral_mine",
        },
        "tags": ["mining-safety", "qld", "quarry", "mineral"],
        "topic_stubs": [
            {
                "title": "MQSHA 1999 safety obligations for non-coal mines",
                "canonical_claim": "QLD non-coal mines and quarries must comply with MQSHA 1999 — risk-management plan, competent persons, safety-and-health obligation.",
                "source_ref": "Mining and Quarrying Safety and Health Act 1999 (Qld) Parts 3-6",
                "predicate": {"required": True},
                "note": "Parallel scheme to CMSHA for non-coal operations",
            },
        ],
        "legislation_links": [
            (LEG_MQSHA, {"required": True}, "Primary act for non-coal QLD operations"),
        ],
    },
    {
        "id": "scn.au-qld-environmental-authority",
        "title": "QLD mining operation requires Environmental Authority (EA)",
        "description": (
            "Resource-extraction activities in Queensland are an environmentally relevant "
            "activity (ERA) and require an Environmental Authority under the EP Act 1994. "
            "Conditions on the EA address air, water, waste, rehabilitation, and financial "
            "provisioning. Non-compliance engages the general environmental duty (s 319) and "
            "serious-harm offences (s 493A)."
        ),
        "industry": "mining_safety",
        "jurisdiction": "AU",
        "source_ref": "Environmental Protection Act 1994 (Qld) Chapter 5 (Environmental Authorities); s 319 (general environmental duty)",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "activity": "resource_extraction",
            "env_class": "ERA",
        },
        "tags": ["mining-safety", "qld", "environment", "environmental-authority", "era"],
        "topic_stubs": [
            {
                "title": "QLD Environmental Authority for resource activities",
                "canonical_claim": "Mining and quarrying in Queensland are ERAs requiring an Environmental Authority under the EP Act 1994, with conditions addressing air, water, waste, rehabilitation.",
                "source_ref": "EP Act 1994 (Qld) Chapter 5",
                "predicate": {"required": True},
                "note": "Gate to lawful operation",
            },
            {
                "title": "QLD general environmental duty",
                "canonical_claim": "A person must not carry out an activity that causes, or is likely to cause, environmental harm unless they take all reasonable and practicable measures to prevent or minimise the harm.",
                "source_ref": "EP Act 1994 (Qld) s 319",
                "predicate": {"required": True},
                "note": "Underpins all operational decisions",
            },
        ],
        "legislation_links": [
            (LEG_EPACT, {"required": True}, "EA regime"),
        ],
    },
    {
        "id": "scn.au-qld-mineral-resources-act-tenure",
        "title": "QLD mineral resources tenure (EPM / ML / MDL) grant and renewal",
        "description": (
            "Mineral exploration and mining in Queensland require tenure under the Mineral "
            "Resources Act 1989 — an Exploration Permit (EPM), Mineral Development Licence "
            "(MDL), or Mining Lease (ML). Grant and renewal trigger landholder notice, "
            "native title processes, and financial assurance obligations. Tenure conditions "
            "stack on top of the EP Act 1994 Environmental Authority."
        ),
        "industry": "mining_safety",
        "jurisdiction": "AU",
        "source_ref": "Mineral Resources Act 1989 (Qld) Parts 5-7 (EPM / MDL / ML grant and renewal)",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "tenure_action": "grant_or_renewal",
        },
        "tags": ["mining-safety", "qld", "tenure", "mineral-resources", "mining-lease"],
        "topic_stubs": [
            {
                "title": "QLD mineral resources tenure types",
                "canonical_claim": "Mineral tenure in Queensland is structured as EPM (exploration), MDL (development), and ML (mining) under the Mineral Resources Act 1989.",
                "source_ref": "Mineral Resources Act 1989 (Qld) Parts 5-7",
                "predicate": {"required": True},
                "note": "Foundational tenure framework",
            },
        ],
        "legislation_links": [
            (LEG_MINRES, {"required": True}, "Tenure grant and renewal"),
            (LEG_EPACT, {"required": True, "condition": "activity_is_ERA"},
             "EA required alongside tenure"),
        ],
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
                    upsert_scenario(
                        cur, scn["id"], scn["title"], scn["description"],
                        scn["industry"], scn["predicates"], scn["tags"],
                        source_ref=scn.get("source_ref"),
                        jurisdiction=scn.get("jurisdiction"),
                    )
                    if not existed_before:
                        created_scenarios += 1
                        print(f"  CREATED scenario {scn['id']}")
                    else:
                        print(f"  UPDATED scenario {scn['id']}")
                    # Topic links (stubs — promote via PACT later).
                    for stub in scn.get("topic_stubs", []):
                        topic_id = upsert_topic_stub(
                            cur,
                            title=stub["title"],
                            tier="institutional",
                            jurisdiction="QLD",
                            authority="Queensland Government",
                            canonical_claim=stub.get("canonical_claim"),
                            source_ref=stub.get("source_ref"),
                        )
                        total_edges += 1
                        if add_applies_when(cur, scn["id"], topic_id=topic_id,
                                            predicate=stub.get("predicate") or {"required": True},
                                            note=stub.get("note", "")):
                            created_edges += 1
                    for leg_id, predicate, note in scn.get("legislation_links", []):
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
