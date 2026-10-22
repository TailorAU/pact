#!/usr/bin/env python3
"""#1160 Round 2.6 — Seed US-origin tech entering AU scenarios (3).

Cites US Arms Export Control Act 22 USC 2778 / ITAR 22 CFR 120-130, EAR
15 CFR 730-774, DTCA Amendment Act 2024 (Cth) + the AUKUS reciprocal
defence-trade pathway (22 CFR 126.7), and AUSTRAC / DFAT reciprocal defence
trade treaty documentation.

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_scenarios_us_inbound.py
"""
from __future__ import annotations

from _scenario_seed_helpers import run_scenario_seed  # noqa: E402


LEG_DTCA = "cth/act-2012-153"       # Defence Trade Controls Act 2012 (Cth)
LEG_DTCA_AMEND_2024 = "cth/act-2024-dtca-amend"  # DTCA Amendment Act 2024 (forward-ref)
LEG_ITAR = "us/cfr-22-120-130"      # ITAR 22 CFR 120-130
LEG_EAR = "us/cfr-15-730-774"       # EAR 15 CFR 730-774
LEG_AECA = "us/usc-22-2778"         # Arms Export Control Act 22 USC 2778


SCENARIOS = [
    {
        "id": "scn.us-to-au-itar-controlled-import",
        "title": "US-origin ITAR-controlled defence article inbound to AU",
        "description": (
            "A US-origin defence article or technical data controlled on the US Munitions "
            "List (USML) is being imported into Australia (or provided to an Australian "
            "person). The US exporter needs an ITAR licence or a listed exemption (e.g. "
            "AUKUS reciprocal under 22 CFR 126.7); the Australian recipient must manage "
            "re-transfer / re-export restrictions imposed by the ITAR licence conditions."
        ),
        "industry": "us_inbound",
        "jurisdiction": "AU-US",
        "source_ref": "US Arms Export Control Act 22 USC 2778; International Traffic in Arms Regulations 22 CFR 120-130; DFAT / Defence Export Controls guidance on ITAR re-transfer",
        "predicates": {
            "country_of_operation": "AU",
            "counterparty_country": "US",
            "direction": "inbound",
            "product_class": "itar_controlled",
        },
        "tags": ["us-inbound", "itar", "defence", "export-control", "re-transfer"],
        "topic_stubs": [
            {
                "title": "ITAR licensing + re-transfer restrictions",
                "canonical_claim": "US-origin USML items / technical data require an ITAR licence or listed exemption; recipients are bound by re-transfer and re-export restrictions imposed via licence conditions or 22 CFR 123.9.",
                "source_ref": "ITAR 22 CFR 123, 124; 22 CFR 123.9 (re-transfer restrictions)",
                "jurisdiction": "US",
                "authority": "US Department of State — Directorate of Defense Trade Controls",
                "predicate": {"required": True},
                "note": "Primary ITAR control",
            },
            {
                "title": "AU recipient obligations — DTCA pass-through controls",
                "canonical_claim": "An Australian recipient of ITAR-controlled material must not supply, transfer, or publish the item without the US-exporter's permission (or fall within an applicable AUKUS exemption) — the DTCA creates offences that mirror the ITAR re-transfer restrictions.",
                "source_ref": "Defence Trade Controls Act 2012 (Cth) Part 2 (controlled supply of technology)",
                "jurisdiction": "AU",
                "authority": "Defence Export Controls (Department of Defence)",
                "predicate": {"required": True},
                "note": "AU-side re-transfer discipline",
            },
        ],
        "legislation_links": [
            (LEG_ITAR, {"required": True}, "ITAR primary regulation"),
            (LEG_AECA, {"required": True, "condition": "underpinning_statute"},
             "AECA 22 USC 2778 underpins ITAR"),
            (LEG_DTCA, {"required": True}, "AU-side re-transfer offences"),
        ],
    },
    {
        "id": "scn.us-to-au-aukus-reciprocal-path",
        "title": "US→AU defence transfer via 22 CFR 126.7 / DTCA Amendment Act 2024 reciprocal exemption",
        "description": (
            "A US exporter is transferring a defence article or technical data to an "
            "Australian authorised user under the AUKUS reciprocal defence-trade pathway — "
            "22 CFR 126.7 (US side) combined with the DTCA Amendment Act 2024 (AU side). "
            "The pathway creates a licence-free channel for qualifying transfers between "
            "AUKUS partners but imposes strict end-user, end-use, and record-keeping "
            "conditions."
        ),
        "industry": "us_inbound",
        "jurisdiction": "AU-US",
        "source_ref": "ITAR 22 CFR 126.7 (AUKUS exemption); Defence Trade Controls Amendment Act 2024 (Cth); AUKUS Pillar 2 reciprocal licensing arrangement",
        "predicates": {
            "country_of_operation": "AU",
            "counterparty_country": "US",
            "direction": "inbound",
            "aukus_reciprocal": True,
        },
        "tags": ["us-inbound", "itar", "aukus", "reciprocal", "126-7", "dtca-2024"],
        "topic_stubs": [
            {
                "title": "22 CFR 126.7 AUKUS reciprocal exemption",
                "canonical_claim": "Qualifying defence-trade transfers between AUKUS partners may proceed licence-free under 22 CFR 126.7 provided the exporter, end user, and end use fall within the approved community and excluded-technology list.",
                "source_ref": "ITAR 22 CFR 126.7",
                "jurisdiction": "US",
                "authority": "US Department of State — Directorate of Defense Trade Controls",
                "predicate": {"required": True},
                "note": "US-side exemption",
            },
            {
                "title": "DTCA Amendment Act 2024 — reciprocal AU framework",
                "canonical_claim": "The DTCA Amendment Act 2024 establishes the AU-side reciprocal framework for AUKUS defence trade — authorised-user status, foreign-supply permits, and strict-liability offences for non-compliance.",
                "source_ref": "Defence Trade Controls Amendment Act 2024 (Cth)",
                "jurisdiction": "AU",
                "authority": "Defence Export Controls (Department of Defence)",
                "predicate": {"required": True},
                "note": "AU-side mirror regime",
            },
        ],
        "legislation_links": [
            (LEG_ITAR, {"required": True}, "126.7 pathway"),
            (LEG_DTCA, {"required": True}, "Underpinning DTCA"),
            (LEG_DTCA_AMEND_2024, {"required": True}, "AUKUS reciprocal amendment"),
        ],
    },
    {
        "id": "scn.us-to-au-ear-dual-use-reexport",
        "title": "US EAR dual-use item re-exported from AU to third country",
        "description": (
            "A US-origin dual-use item controlled under the Export Administration "
            "Regulations (EAR, 15 CFR 730-774) has been imported into Australia. The "
            "Australian holder proposes to re-export it to a third country. The de minimis "
            "rule, incorporated rules, and licence requirements under 15 CFR 734 / 736 / "
            "744 still apply — BIS jurisdiction follows the item."
        ),
        "industry": "us_inbound",
        "jurisdiction": "AU-US",
        "source_ref": "Export Administration Regulations 15 CFR 730-774; 15 CFR 734 (de minimis); 15 CFR 736 (General Prohibitions); 15 CFR 744 (End-User / End-Use Controls)",
        "predicates": {
            "country_of_operation": "AU",
            "origin_country": "US",
            "direction": "reexport",
            "product_class": "ear_dual_use",
        },
        "tags": ["us-inbound", "ear", "dual-use", "reexport", "bis"],
        "topic_stubs": [
            {
                "title": "EAR re-export jurisdiction — de minimis + incorporated rules",
                "canonical_claim": "US-origin items remain subject to EAR re-export controls after leaving the US — including when integrated into foreign products at or above the applicable de minimis threshold or under the incorporated-rules analysis.",
                "source_ref": "EAR 15 CFR 734.3, 734.4",
                "jurisdiction": "US",
                "authority": "US Department of Commerce — Bureau of Industry and Security",
                "predicate": {"required": True},
                "note": "Jurisdiction-follows-the-item rule",
            },
            {
                "title": "General Prohibitions + End-User / End-Use restrictions",
                "canonical_claim": "A re-export of an EAR-controlled item requires licence review against General Prohibitions (15 CFR 736) and End-User / End-Use Controls (15 CFR 744) — including denied-party and entity-list screens.",
                "source_ref": "EAR 15 CFR 736, 744",
                "jurisdiction": "US",
                "authority": "US Department of Commerce — Bureau of Industry and Security",
                "predicate": {"required": True},
                "note": "Re-export decision tree",
            },
        ],
        "legislation_links": [
            (LEG_EAR, {"required": True}, "EAR primary regulation"),
            (LEG_DTCA, {"required": True, "condition": "dual_regime"},
             "AU-side controls may also apply if listed on the DSGL"),
        ],
    },
]


if __name__ == "__main__":
    import sys
    sys.exit(run_scenario_seed(
        SCENARIOS,
        stub_jurisdiction="US",
        stub_authority="US Department of State / Department of Commerce",
    ))
