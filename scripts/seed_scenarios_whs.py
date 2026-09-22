#!/usr/bin/env python3
"""#1160 Round 2.4 — Seed WHS + industrial manslaughter scenarios (3).

Cites the model Work Health and Safety Act 2011, WHS Regulation 2011, the
Code of Practice: Managing Psychosocial Hazards at Work, the QLD WHS
(Industrial Manslaughter) Amendment Act 2017, and CMSHA 1999 (Qld) s 34
(coal-mine carve-out from WHS Act).

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_scenarios_whs.py
"""
from __future__ import annotations

from _scenario_seed_helpers import run_scenario_seed  # noqa: E402


LEG_WHS_MODEL = "cth/model-whs-act-2011"  # Model WHS Act 2011 (adopted by most states)
LEG_WHS_REG = "cth/model-whs-reg-2011"    # Model WHS Regulation 2011
LEG_QLD_IM_AMENDMENT = "qld/act-2017-im"  # QLD WHS (Industrial Manslaughter) Amendment Act 2017
LEG_QLD_WHS = "qld/act-2011-018"          # QLD Work Health and Safety Act 2011
LEG_CMSHA = "qld/act-1999-039"            # CMSHA — for the coal-mine carve-out cross-ref


SCENARIOS = [
    {
        "id": "scn.au-whs-psychosocial-hazards",
        "title": "Model WHS — psychosocial hazard identification & control duty",
        "description": (
            "A Person Conducting a Business or Undertaking (PCBU) must identify and control "
            "psychosocial hazards at work — high job demands, low job control, poor support, "
            "workplace violence, bullying, harassment — under the primary duty of care in the "
            "model WHS Act 2011 s 19 and the specific psychosocial hazards regulation. The "
            "Code of Practice: Managing Psychosocial Hazards at Work is admissible as "
            "evidence of what is reasonably practicable."
        ),
        "industry": "whs",
        "jurisdiction": "AU",
        "source_ref": "Model Work Health and Safety Act 2011 s 19; WHS Regulation 2011 regs 55A-55D (psychosocial hazards); Code of Practice: Managing Psychosocial Hazards at Work (Safe Work Australia, 2022)",
        "predicates": {
            "country_of_operation": "AU",
            "regulatory_regime": "whs",
            "duty_holder": "pcbu",
        },
        "tags": ["whs", "psychosocial", "pcbu", "primary-duty"],
        "topic_stubs": [
            {
                "title": "Model WHS Act — PCBU primary duty of care",
                "canonical_claim": "A PCBU must ensure, so far as reasonably practicable, the health and safety of workers — including psychological health — while they are at work in the business or undertaking.",
                "source_ref": "Model Work Health and Safety Act 2011 s 19",
                "jurisdiction": "AU",
                "authority": "Safe Work Australia",
                "predicate": {"required": True},
                "note": "Foundational PCBU duty",
            },
            {
                "title": "WHS Regulation psychosocial hazards duty",
                "canonical_claim": "PCBUs must identify psychosocial hazards and manage risk using the hierarchy of control — eliminate so far as reasonably practicable, otherwise minimise.",
                "source_ref": "Model WHS Regulation 2011 regs 55A-55D",
                "jurisdiction": "AU",
                "authority": "Safe Work Australia",
                "predicate": {"required": True},
                "note": "Specific psychosocial regulation",
            },
        ],
        "legislation_links": [
            (LEG_WHS_MODEL, {"required": True}, "s 19 primary duty"),
            (LEG_WHS_REG, {"required": True}, "regs 55A-55D psychosocial"),
        ],
    },
    {
        "id": "scn.au-qld-industrial-manslaughter",
        "title": "QLD industrial manslaughter — senior officer / PCBU liability",
        "description": (
            "A worker has died in the course of carrying out work for a PCBU in Queensland. "
            "The WHS (Industrial Manslaughter) Amendment Act 2017 creates an indictable "
            "offence for a PCBU or senior officer whose negligent conduct causes the death. "
            "Maximum penalty is 20 years' imprisonment for individuals or $15m for bodies "
            "corporate. CMSHA 1999 s 34 carves out coal mines into the parallel CMSHA regime."
        ),
        "industry": "whs",
        "jurisdiction": "AU",
        "source_ref": "QLD Work Health and Safety (Industrial Manslaughter) Amendment Act 2017; QLD Work Health and Safety Act 2011 ss 34C, 34D",
        "predicates": {
            "country_of_operation": "AU",
            "state": "QLD",
            "event": "workplace_fatality",
        },
        "tags": ["whs", "qld", "industrial-manslaughter", "fatality"],
        "topic_stubs": [
            {
                "title": "QLD industrial-manslaughter offence — PCBU",
                "canonical_claim": "A PCBU commits industrial manslaughter where a worker dies in the course of carrying out work, the PCBU's negligent conduct causes the death, and the PCBU had a duty under Part 2 Div 2.",
                "source_ref": "QLD WHS Act 2011 s 34C",
                "jurisdiction": "QLD",
                "authority": "Office of Industrial Relations (Queensland)",
                "predicate": {"required": True},
                "note": "PCBU offence",
            },
            {
                "title": "QLD industrial-manslaughter offence — senior officer",
                "canonical_claim": "A senior officer of a PCBU commits industrial manslaughter where the officer's negligent conduct causes a worker's death.",
                "source_ref": "QLD WHS Act 2011 s 34D",
                "jurisdiction": "QLD",
                "authority": "Office of Industrial Relations (Queensland)",
                "predicate": {"required": True},
                "note": "Senior-officer offence",
            },
            {
                "title": "CMSHA coal-mine carve-out from WHS Act",
                "canonical_claim": "The WHS Act 2011 does not apply to work carried out in a QLD coal mine to the extent that the CMSHA 1999 applies — coal mines are regulated under the CMSHA regime.",
                "source_ref": "CMSHA 1999 (Qld) s 34",
                "jurisdiction": "QLD",
                "authority": "Queensland Government",
                "predicate": {"condition": "operation_type_coal_mine"},
                "note": "Applies only to coal-mine operations",
            },
        ],
        "legislation_links": [
            (LEG_QLD_WHS, {"required": True}, "ss 34C, 34D"),
            (LEG_QLD_IM_AMENDMENT, {"required": True, "condition": "historical_context"},
             "Introducing amendment"),
            (LEG_CMSHA, {"required": True, "condition": "operation_type_coal_mine"},
             "Coal-mine carve-out"),
        ],
    },
    {
        "id": "scn.au-whs-contractor-pcbu-duties",
        "title": "Multiple PCBUs — concurrent WHS duties at shared workplace",
        "description": (
            "Where multiple PCBUs share a workplace (principal contractor, subcontractors, "
            "labour hire, visiting specialists), each has a concurrent primary duty of care "
            "to workers. The model WHS Act s 16 requires duty holders to consult, co-operate, "
            "and co-ordinate activities so far as reasonably practicable — a duty regulators "
            "prosecute aggressively after incidents on multi-employer sites."
        ),
        "industry": "whs",
        "jurisdiction": "AU",
        "source_ref": "Model Work Health and Safety Act 2011 ss 14 (duties not transferrable), 16 (more than one duty holder), 46 (duty to consult, co-operate, co-ordinate)",
        "predicates": {
            "country_of_operation": "AU",
            "regulatory_regime": "whs",
            "worksite": "shared_control",
            "workforce": "contractor_mixed",
        },
        "tags": ["whs", "contractor", "pcbu", "shared-workplace", "consultation"],
        "topic_stubs": [
            {
                "title": "Concurrent WHS duties — s 16 multiple duty holders",
                "canonical_claim": "More than one person can concurrently have the same duty under the model WHS Act; each must discharge it to the extent they have capacity to influence and control the matter.",
                "source_ref": "Model Work Health and Safety Act 2011 s 16",
                "jurisdiction": "AU",
                "authority": "Safe Work Australia",
                "predicate": {"required": True},
                "note": "Multiple-duty-holder principle",
            },
            {
                "title": "Duty to consult, co-operate, co-ordinate — s 46",
                "canonical_claim": "Duty holders at a shared workplace must, so far as reasonably practicable, consult, co-operate and co-ordinate activities with all other persons who have a duty in relation to the same matter.",
                "source_ref": "Model Work Health and Safety Act 2011 s 46",
                "jurisdiction": "AU",
                "authority": "Safe Work Australia",
                "predicate": {"required": True},
                "note": "Co-ordination obligation",
            },
        ],
        "legislation_links": [
            (LEG_WHS_MODEL, {"required": True}, "ss 14, 16, 46"),
        ],
    },
]


if __name__ == "__main__":
    import sys
    sys.exit(run_scenario_seed(
        SCENARIOS,
        stub_jurisdiction="AU",
        stub_authority="Safe Work Australia",
    ))
