#!/usr/bin/env python3
"""#1160 Round 2.5 — Seed AML/CTF + sanctions scenarios (3).

Cites Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth),
AUSTRAC Rules, Autonomous Sanctions Act 2011 (Cth), Autonomous Sanctions
Regulations 2011, and the Tranche-2 Amendment Act (as enacted).

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_scenarios_aml_ctf.py
"""
from __future__ import annotations

from _scenario_seed_helpers import run_scenario_seed  # noqa: E402


LEG_AML_CTF_ACT = "cth/act-2006-169"      # AML/CTF Act 2006 (Cth)
LEG_AUTONOMOUS_SANCTIONS = "cth/act-2011-038"  # Autonomous Sanctions Act 2011
LEG_TRANCHE2 = "cth/act-2024-tranche2"    # forward-ref: Tranche-2 Amendment Act (as enacted)


SCENARIOS = [
    {
        "id": "scn.au-austrac-reporting-entity",
        "title": "AU AML/CTF — designated services, customer due diligence, SMR / IFTI reporting",
        "description": (
            "An entity provides a designated service under the AML/CTF Act (e.g. account "
            "opening, remittance, gambling, digital-currency exchange) and is therefore a "
            "reporting entity. It must enrol with AUSTRAC, implement an AML/CTF programme, "
            "conduct applicable customer due diligence (Part 2), and lodge SMRs (suspicious "
            "matter reports) and IFTIs (international funds transfer instructions)."
        ),
        "industry": "aml_ctf",
        "jurisdiction": "AU",
        "source_ref": "Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) Parts 2-3; AML/CTF Rules (AUSTRAC)",
        "predicates": {
            "country_of_operation": "AU",
            "regulatory_regime": "amlctf",
            "role": "reporting_entity",
        },
        "tags": ["aml-ctf", "austrac", "reporting-entity", "smr", "ifti"],
        "topic_stubs": [
            {
                "title": "AML/CTF Act — designated services + reporting entity",
                "canonical_claim": "An entity providing any of the 'designated services' listed in AML/CTF Act s 6 is a reporting entity with obligations under Parts 2-3 of the Act and the AML/CTF Rules.",
                "source_ref": "AML/CTF Act 2006 (Cth) ss 5, 6",
                "jurisdiction": "AU",
                "authority": "AUSTRAC",
                "predicate": {"required": True},
                "note": "Covered-entity definition",
            },
            {
                "title": "Customer due diligence obligations — Part 2 Div 4",
                "canonical_claim": "Reporting entities must conduct applicable customer identification and ongoing due diligence; enhanced due diligence applies for higher-risk customers / PEPs.",
                "source_ref": "AML/CTF Act 2006 (Cth) Part 2 Div 4; AML/CTF Rules ch 4",
                "jurisdiction": "AU",
                "authority": "AUSTRAC",
                "predicate": {"required": True},
                "note": "KYC / ongoing CDD",
            },
            {
                "title": "SMR / IFTI reporting obligations",
                "canonical_claim": "Reporting entities must submit suspicious-matter reports (SMRs) within the prescribed time after forming the requisite suspicion, and IFTIs for cross-border funds transfers.",
                "source_ref": "AML/CTF Act 2006 (Cth) ss 41 (SMR), 45 (IFTI)",
                "jurisdiction": "AU",
                "authority": "AUSTRAC",
                "predicate": {"required": True},
                "note": "Transactional reporting",
            },
        ],
        "legislation_links": [
            (LEG_AML_CTF_ACT, {"required": True}, "Underpinning statute"),
        ],
    },
    {
        "id": "scn.au-sanctions-designated-destination",
        "title": "AU exports / transactions touching an autonomous-sanctions-listed jurisdiction",
        "description": (
            "An Australian person or entity proposes to export goods, transfer funds, or "
            "provide services to a counterparty in a jurisdiction subject to Australian "
            "autonomous sanctions (e.g. Russia, Iran, DPRK, Myanmar — DFAT list current). "
            "The transaction may require a DFAT permit or may be absolutely prohibited under "
            "the Autonomous Sanctions Act 2011 and Regulations 2011."
        ),
        "industry": "aml_ctf",
        "jurisdiction": "AU",
        "source_ref": "Autonomous Sanctions Act 2011 (Cth); Autonomous Sanctions Regulations 2011",
        "predicates": {
            "country_of_operation": "AU",
            "counterparty_country": "sanctions_listed",
            "transaction_type": "goods_or_funds_transfer",
        },
        "tags": ["aml-ctf", "sanctions", "autonomous-sanctions", "dfat", "export-control"],
        "topic_stubs": [
            {
                "title": "Autonomous Sanctions — permit regime",
                "canonical_claim": "Australian persons must not engage in conduct prohibited by an autonomous-sanctions designation or declaration unless authorised by a DFAT-issued permit.",
                "source_ref": "Autonomous Sanctions Act 2011 (Cth) ss 10, 16; Autonomous Sanctions Regulations 2011",
                "jurisdiction": "AU",
                "authority": "Department of Foreign Affairs and Trade",
                "predicate": {"required": True},
                "note": "Primary prohibition + permit regime",
            },
            {
                "title": "Sanctioned-person screening obligation",
                "canonical_claim": "Persons dealing with counterparties in designated jurisdictions must screen against the DFAT consolidated list and UN Security Council lists before transacting.",
                "source_ref": "Autonomous Sanctions Regulations 2011 reg 14; DFAT Sanctions Guidelines",
                "jurisdiction": "AU",
                "authority": "Department of Foreign Affairs and Trade",
                "predicate": {"required": True},
                "note": "Screening precondition",
            },
        ],
        "legislation_links": [
            (LEG_AUTONOMOUS_SANCTIONS, {"required": True}, "Primary sanctions statute"),
            (LEG_AML_CTF_ACT, {"required": True, "condition": "also_reporting_entity"},
             "Overlapping AML/CTF CDD obligations"),
        ],
    },
    {
        "id": "scn.au-tranche2-professional-services",
        "title": "Tranche-2 reforms — lawyers, accountants, conveyancers, real-estate agents captured",
        "description": (
            "Tranche-2 amendments to the AML/CTF Act expand the 'designated services' list "
            "to capture specified professional services — trust and company services by "
            "lawyers / accountants, real-estate transactions, conveyancing, and dealer "
            "services in precious metals / stones. Captured professions must enrol with "
            "AUSTRAC and implement AML/CTF programmes on the commencement-date roll-out."
        ),
        "industry": "aml_ctf",
        "jurisdiction": "AU",
        "source_ref": "Anti-Money Laundering and Counter-Terrorism Financing Amendment Act 2024 (Cth) (Tranche-2); AML/CTF Act 2006 (Cth) s 6 (amended)",
        "predicates": {
            "country_of_operation": "AU",
            "regulatory_regime": "amlctf",
            "profession": "tranche2",
        },
        "tags": ["aml-ctf", "tranche-2", "professional-services", "real-estate", "legal"],
        "topic_stubs": [
            {
                "title": "Tranche-2 captured professions",
                "canonical_claim": "Tranche-2 amendments expand AML/CTF coverage to lawyers, accountants, conveyancers, real-estate agents, and dealers in precious metals / stones providing designated services.",
                "source_ref": "AML/CTF Amendment Act 2024 (Cth); AML/CTF Act 2006 (Cth) s 6 (amended list)",
                "jurisdiction": "AU",
                "authority": "AUSTRAC",
                "predicate": {"required": True},
                "note": "Expanded scope",
            },
            {
                "title": "Tranche-2 roll-out obligations — enrolment + programme",
                "canonical_claim": "Captured Tranche-2 reporting entities must enrol with AUSTRAC by the commencement-date cohort, adopt an AML/CTF programme, and conduct CDD before providing designated services.",
                "source_ref": "AML/CTF Act 2006 (Cth) Parts 2-3 (as amended); AUSTRAC Tranche-2 implementation guidance",
                "jurisdiction": "AU",
                "authority": "AUSTRAC",
                "predicate": {"required": True},
                "note": "Implementation obligations",
            },
        ],
        "legislation_links": [
            (LEG_AML_CTF_ACT, {"required": True}, "Amended AML/CTF Act"),
            (LEG_TRANCHE2, {"required": True, "condition": "historical_context"},
             "Amending statute"),
        ],
    },
]


if __name__ == "__main__":
    import sys
    sys.exit(run_scenario_seed(
        SCENARIOS,
        stub_jurisdiction="AU",
        stub_authority="AUSTRAC",
    ))
