#!/usr/bin/env python3
"""#1160 Round 2.3 — Seed AU privacy / data-handling scenarios (4).

Cites Privacy Act 1988 (Cth) + APPs 1-13, Privacy Amendment (Notifiable
Data Breaches) Act 2017, Consumer Data Right (Competition and Consumer Act
1988 (Cth) Part IVD), and Australian Privacy Principles Guidelines.

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_scenarios_privacy.py
"""
from __future__ import annotations

from _scenario_seed_helpers import run_scenario_seed  # noqa: E402


LEG_PRIVACY_ACT = "cth/act-1988-119"  # Privacy Act 1988 (Cth)
LEG_NDB_AMENDMENT = "cth/act-2017-012-ndb"  # forward-ref
LEG_CCA = "cth/act-1974-051"  # Competition and Consumer Act 1974 (Cth) Part IVD (CDR)


SCENARIOS = [
    {
        "id": "scn.au-privacy-notifiable-data-breach",
        "title": "AU notifiable data breach — Privacy Act s 26WK",
        "description": (
            "An APP entity has suffered an eligible data breach — unauthorised access, "
            "disclosure, or loss of personal information likely to result in serious "
            "harm. The entity must notify the affected individuals and the OAIC as soon "
            "as practicable under the Notifiable Data Breaches scheme."
        ),
        "industry": "privacy",
        "jurisdiction": "AU",
        "source_ref": "Privacy Act 1988 (Cth) Part IIIC ss 26WA-26WT (Notifiable Data Breaches scheme, introduced by the Privacy Amendment (NDB) Act 2017)",
        "predicates": {
            "country_of_operation": "AU",
            "event": "data_breach",
            "data_class": "personal_information",
        },
        "tags": ["privacy", "ndb", "data-breach", "apps"],
        "topic_stubs": [
            {
                "title": "Notifiable Data Breaches scheme — eligible data breach",
                "canonical_claim": "An eligible data breach occurs when there is unauthorised access, disclosure or loss of personal information likely to result in serious harm to affected individuals.",
                "source_ref": "Privacy Act 1988 (Cth) s 26WE",
                "jurisdiction": "AU",
                "authority": "Office of the Australian Information Commissioner",
                "predicate": {"required": True},
                "note": "Definition of 'eligible data breach'",
            },
            {
                "title": "Notification obligation — OAIC + affected individuals",
                "canonical_claim": "An APP entity that suffers an eligible data breach must notify the OAIC and affected individuals as soon as practicable via a prescribed statement.",
                "source_ref": "Privacy Act 1988 (Cth) ss 26WK, 26WL",
                "jurisdiction": "AU",
                "authority": "Office of the Australian Information Commissioner",
                "predicate": {"required": True},
                "note": "Core notification obligation",
            },
        ],
        "legislation_links": [
            (LEG_PRIVACY_ACT, {"required": True}, "Part IIIC NDB scheme"),
            (LEG_NDB_AMENDMENT, {"required": True, "condition": "historical_context"},
             "Amendment that introduced the scheme"),
        ],
    },
    {
        "id": "scn.au-privacy-cross-border-transfer",
        "title": "AU entity discloses personal info to overseas recipient (APP 8)",
        "description": (
            "An APP entity proposes to disclose personal information about an individual to "
            "an overseas recipient. APP 8 requires the entity to take reasonable steps to "
            "ensure the recipient does not breach the APPs in relation to the information, "
            "or rely on a listed exception (s 16C cross-border accountability)."
        ),
        "industry": "privacy",
        "jurisdiction": "AU",
        "source_ref": "Privacy Act 1988 (Cth) APP 8 (Cross-border disclosure); s 16C (liability for acts of overseas recipients)",
        "predicates": {
            "country_of_operation": "AU",
            "data_flow": "outbound",
            "recipient_country": "!AU",
            "data_class": "personal_information",
        },
        "tags": ["privacy", "apps", "app-8", "cross-border", "data-transfer"],
        "topic_stubs": [
            {
                "title": "APP 8 — cross-border disclosure obligations",
                "canonical_claim": "Before disclosing personal information to an overseas recipient, an APP entity must take reasonable steps to ensure the recipient does not breach the APPs, or fall within a listed exception.",
                "source_ref": "Privacy Act 1988 (Cth) APP 8",
                "jurisdiction": "AU",
                "authority": "Office of the Australian Information Commissioner",
                "predicate": {"required": True},
                "note": "Reasonable-steps obligation",
            },
            {
                "title": "s 16C — accountability for overseas recipient conduct",
                "canonical_claim": "An APP entity that discloses personal information to an overseas recipient is taken to have done the act or engaged in the practice that would breach the APPs if done by the Australian entity.",
                "source_ref": "Privacy Act 1988 (Cth) s 16C",
                "jurisdiction": "AU",
                "authority": "Office of the Australian Information Commissioner",
                "predicate": {"required": True},
                "note": "Liability pass-through",
            },
        ],
        "legislation_links": [
            (LEG_PRIVACY_ACT, {"required": True}, "APP 8 + s 16C"),
        ],
    },
    {
        "id": "scn.au-cdr-data-holder",
        "title": "AU accredited Consumer Data Right (CDR) data holder",
        "description": (
            "An accredited CDR data holder in banking, energy, or telecommunications must "
            "comply with the CDR regime under the Competition and Consumer Act 1974 (Cth) "
            "Part IVD and the CDR Rules — including consumer consent, data sharing, security "
            "standards, and the CDR privacy safeguards that parallel but do not replace the "
            "Privacy Act APPs."
        ),
        "industry": "privacy",
        "jurisdiction": "AU",
        "source_ref": "Competition and Consumer Act 1974 (Cth) Part IVD; Competition and Consumer (Consumer Data Right) Rules 2020",
        "predicates": {
            "country_of_operation": "AU",
            "regulatory_regime": "cdr",
            "role": "data_holder",
        },
        "tags": ["privacy", "cdr", "data-holder", "banking", "energy"],
        "topic_stubs": [
            {
                "title": "CDR regime — Part IVD framework",
                "canonical_claim": "The Consumer Data Right framework under Competition and Consumer Act Part IVD governs designated sectors with obligations on data holders, accredited data recipients, and designated gateways.",
                "source_ref": "Competition and Consumer Act 1974 (Cth) Part IVD",
                "jurisdiction": "AU",
                "authority": "ACCC + OAIC (co-regulators)",
                "predicate": {"required": True},
                "note": "Underpinning regime",
            },
            {
                "title": "CDR privacy safeguards",
                "canonical_claim": "The CDR privacy safeguards (13 safeguards) apply to CDR data and sit alongside the APPs — they are not a replacement but add sector-specific requirements around consent, use, and deletion.",
                "source_ref": "Competition and Consumer Act 1974 (Cth) Part IVD Div 5",
                "jurisdiction": "AU",
                "authority": "Office of the Australian Information Commissioner",
                "predicate": {"required": True},
                "note": "Privacy safeguards overlay",
            },
        ],
        "legislation_links": [
            (LEG_CCA, {"required": True}, "Part IVD — CDR framework"),
            (LEG_PRIVACY_ACT, {"required": True, "condition": "parallel_regime"},
             "APPs continue to apply alongside CDR safeguards"),
        ],
    },
    {
        "id": "scn.au-sensitive-info-handling",
        "title": "AU entity handles sensitive information (health / biometric / racial / political)",
        "description": (
            "An APP entity collects, uses, or discloses 'sensitive information' as defined in "
            "s 6 of the Privacy Act — health information, biometric templates, racial or "
            "ethnic origin, political or religious beliefs, sexual orientation, trade-union "
            "membership, or criminal record. Sensitive information has stricter consent and "
            "purpose limitations under APPs 3, 6, and 7 than ordinary personal information."
        ),
        "industry": "privacy",
        "jurisdiction": "AU",
        "source_ref": "Privacy Act 1988 (Cth) s 6 (definition of 'sensitive information'); APPs 3, 6, 7 (collection, use, direct marketing)",
        "predicates": {
            "country_of_operation": "AU",
            "data_class": "sensitive_information",
        },
        "tags": ["privacy", "sensitive-info", "apps", "consent"],
        "topic_stubs": [
            {
                "title": "Sensitive information — definition",
                "canonical_claim": "Sensitive information is a defined sub-category of personal information (health, biometric, racial, political, religious, sexual orientation, union, criminal) attracting stricter collection and use rules under the APPs.",
                "source_ref": "Privacy Act 1988 (Cth) s 6",
                "jurisdiction": "AU",
                "authority": "Office of the Australian Information Commissioner",
                "predicate": {"required": True},
                "note": "Core definition",
            },
            {
                "title": "APP 3 — consent for sensitive-information collection",
                "canonical_claim": "An APP entity must not collect sensitive information about an individual unless the individual consents (or a narrow listed exception applies).",
                "source_ref": "Privacy Act 1988 (Cth) APP 3.3",
                "jurisdiction": "AU",
                "authority": "Office of the Australian Information Commissioner",
                "predicate": {"required": True},
                "note": "Consent gate for collection",
            },
        ],
        "legislation_links": [
            (LEG_PRIVACY_ACT, {"required": True}, "APPs 3, 6, 7"),
        ],
    },
]


if __name__ == "__main__":
    import sys
    sys.exit(run_scenario_seed(
        SCENARIOS,
        stub_jurisdiction="AU",
        stub_authority="Office of the Australian Information Commissioner",
    ))
