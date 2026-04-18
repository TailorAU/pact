#!/usr/bin/env python3
"""#1160 Round 2.2 — Seed QGov / Commonwealth procurement scenarios (4).

Cites QITC Framework (QGov), PSBA Information Security Classification
Framework (ISMF), Commonwealth Procurement Rules (CPRs, Dept of Finance),
and the Queensland Government AI Governance Policy.

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_scenarios_procurement.py
"""
from __future__ import annotations

from _scenario_seed_helpers import run_scenario_seed  # noqa: E402


SCENARIOS = [
    {
        "id": "scn.au-qld-ict-qitc-procurement",
        "title": "QLD gov ICT procurement under QITC framework",
        "description": (
            "A Queensland government agency is contracting for ICT goods or services. QITC "
            "(Queensland Information Technology Contracting) Framework applies — the standard "
            "General Contract Conditions, Module Orders, and Schedules govern the engagement, "
            "with value- and risk-based tiering into Bespoke, Comprehensive, and SME modules."
        ),
        "industry": "procurement",
        "jurisdiction": "AU",
        "source_ref": "QITC Framework v2.3 (QGov Department of Housing, Local Government, Planning and Public Works)",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "procurement_framework": "QITC",
            "contract_type": "ict",
        },
        "tags": ["procurement", "qld", "ict", "qitc"],
        "topic_stubs": [
            {
                "title": "QITC Framework — General Contract Conditions",
                "canonical_claim": "QLD government ICT contracts are formed under the QITC Framework's General Contract Conditions plus Module Orders and Schedules appropriate to the engagement.",
                "source_ref": "QITC Framework v2.3 General Contract Conditions",
                "authority": "Queensland Government",
                "predicate": {"required": True},
                "note": "Contract-formation template",
            },
            {
                "title": "QITC tiering — Bespoke / Comprehensive / SME",
                "canonical_claim": "QITC tiering (Bespoke, Comprehensive, SME) determines which module set applies based on contract value and risk profile.",
                "source_ref": "QITC Framework v2.3 Selection Guide",
                "authority": "Queensland Government",
                "predicate": {"required": True},
                "note": "Drives module selection",
            },
        ],
        "legislation_links": [],
    },
    {
        "id": "scn.au-qld-psba-ismf-data-classification",
        "title": "QLD gov data classification under PSBA ISMF",
        "description": (
            "A Queensland government agency (or supplier handling public-sector data) must "
            "classify data per the Information Security Classification Framework (ISMF) "
            "maintained by the Public Safety Business Agency / QGCDG. Classification drives "
            "handling, storage, and encryption controls for OFFICIAL, SENSITIVE, and PROTECTED "
            "categories."
        ),
        "industry": "procurement",
        "jurisdiction": "AU",
        "source_ref": "Queensland Information Security Classification Framework (ISMF, QGCDG)",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "data_handling": "public_sector",
        },
        "tags": ["procurement", "qld", "data-classification", "ismf", "psba"],
        "topic_stubs": [
            {
                "title": "QGov Information Security Classification Framework",
                "canonical_claim": "QLD public-sector data must be classified (OFFICIAL / SENSITIVE / PROTECTED) under the ISMF; classification drives storage, transmission, and access controls.",
                "source_ref": "Queensland Information Security Classification Framework (current edition)",
                "authority": "Queensland Government Customer and Digital Group",
                "predicate": {"required": True},
                "note": "Drives all handling controls",
            },
        ],
        "legislation_links": [],
    },
    {
        "id": "scn.au-cth-procurement-cpr",
        "title": "Commonwealth procurement — Commonwealth Procurement Rules (CPRs)",
        "description": (
            "Relevant entities under the Public Governance, Performance and Accountability "
            "Act 2013 (PGPA Act) must conduct procurement per the Commonwealth Procurement "
            "Rules. Value thresholds drive process: open tender above $80k for non-corporate "
            "entities (goods / services non-construction), with Div 1 principles (value for "
            "money, non-discrimination, transparency) applying to all procurements."
        ),
        "industry": "procurement",
        "jurisdiction": "AU",
        "source_ref": "Commonwealth Procurement Rules (Department of Finance, current edition); PGPA Act 2013 (Cth) s 105B",
        "predicates": {
            "country_of_operation": "AU",
            "jurisdiction": "commonwealth",
            "procurement_value_aud_gte": 80000,
        },
        "tags": ["procurement", "commonwealth", "cpr", "pgpa"],
        "topic_stubs": [
            {
                "title": "Commonwealth Procurement Rules — Division 1 principles",
                "canonical_claim": "All Commonwealth procurements must achieve value for money, efficient / ethical conduct, non-discrimination, and accountability per CPR Division 1.",
                "source_ref": "Commonwealth Procurement Rules Div 1",
                "jurisdiction": "AU",
                "authority": "Department of Finance",
                "predicate": {"required": True},
                "note": "Applies to all procurements regardless of value",
            },
            {
                "title": "CPR threshold — $80k open tender for non-construction",
                "canonical_claim": "Non-corporate Commonwealth entities must use open tender for non-construction goods / services at or above $80k (ex GST) unless an exemption applies.",
                "source_ref": "Commonwealth Procurement Rules Div 2 (Open Approaches to the Market)",
                "jurisdiction": "AU",
                "authority": "Department of Finance",
                "predicate": {"required": True, "condition": "value_ge_80k"},
                "note": "Process trigger",
            },
        ],
        "legislation_links": [
            ("cth/act-2013-123-pgpa", {"required": True}, "PGPA Act — underpinning statute"),
        ],
    },
    {
        "id": "scn.au-qgov-ai-governance",
        "title": "QLD gov use of AI — QGov AI Governance Policy + responsible AI obligations",
        "description": (
            "A Queensland government agency (or contracted supplier) deploying an AI system in "
            "a public-sector context must comply with the Queensland Government AI Governance "
            "Policy and Responsible Use of AI Framework — including risk assessment, human "
            "oversight, explainability, and alignment with the ISMF classification."
        ),
        "industry": "procurement",
        "jurisdiction": "AU",
        "source_ref": "Queensland Government AI Governance Policy (current edition); Responsible Use of AI Framework (QGCDG)",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "technology": "ai_system",
            "deployment_context": "public_sector",
        },
        "tags": ["procurement", "qld", "ai-governance", "responsible-ai"],
        "topic_stubs": [
            {
                "title": "QGov AI Governance Policy",
                "canonical_claim": "QLD agencies deploying AI systems must follow the QGov AI Governance Policy — risk assessment, human oversight, explainability, and ongoing monitoring.",
                "source_ref": "Queensland Government AI Governance Policy (current edition)",
                "authority": "Queensland Government Customer and Digital Group",
                "predicate": {"required": True},
                "note": "Whole-of-government baseline",
            },
            {
                "title": "Responsible Use of AI Framework",
                "canonical_claim": "The Responsible Use of AI Framework operationalises the QGov AI Governance Policy with concrete assessment steps, governance artefacts, and review gates.",
                "source_ref": "Responsible Use of AI Framework (QGCDG)",
                "authority": "Queensland Government Customer and Digital Group",
                "predicate": {"required": True},
                "note": "Operational companion to the policy",
            },
        ],
        "legislation_links": [],
    },
]


if __name__ == "__main__":
    import sys
    sys.exit(run_scenario_seed(
        SCENARIOS,
        stub_jurisdiction="QLD",
        stub_authority="Queensland Government",
    ))
