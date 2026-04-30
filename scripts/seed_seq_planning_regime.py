#!/usr/bin/env python3
"""
Seed the South-East Queensland (SEQ) planning regime into Source.

Refs #873 (child of epic #852, Fabric Development Engine for QIC v1).

The QIC v1 acceptance gate (#852 condition 3) requires flood / planning / TOD
evidence to be cited and caveated with statutory references. Source today
carries no SEQ regulatory regime — there is nothing for the Fabric `evidence`
node to cite. This seed script lands the foundation knowledge graph.

What this script does
---------------------

1. **Legislation (7 statutes via the QLD Legislation API)**

   Live-fetches each act from `api.legislation.qld.gov.au` using the same
   auth pattern as `sites/source/src/lib/parsers/qld-parser.ts`
   (env vars `QLD_LEGISLATION_USERNAME` / `QLD_LEGISLATION_PASSWORD`),
   parses the HTML reprint into sections, and POSTs to the existing
   `/api/axiom/legislation/ingest` admin endpoint:

   - Planning Act 2016
   - Planning Regulation 2017
   - Transport Infrastructure Act 1994
   - Economic Development Act 2012
   - State Development and Public Works Organisation Act 1971
   - Building Act 1975
   - Land Valuation Act 2010

2. **Institutional topics (12 documents as PACT topics)**

   Direct DB writes via `$DATABASE_URL` (same pattern as the
   `_scenario_seed_helpers` module under #1152 / #1160). Each topic lands
   `tier=institutional`, `status=locked` (these are official government
   instruments, not consensus debates), with statutory citation in
   `source_ref` and the full retrieval/version trail embedded in the body
   so the corrections-comment contract on #852 is honoured even before
   the formal fact-model deltas (N4 / #876) ship.

   - State-level: ShapingSEQ 2023, State Planning Policy, State
     Development Assessment Provisions (SDAP), Logan Planning Scheme.
   - Corridor: Faster Rail master plan + Loganlea / Beenleigh /
     Trinder Park / Woodridge / Bethania / Kuraby / Kingston station
     documents (7 stations).

3. **Scenarios (the `property-development-feasibility` cluster)**

   Direct DB writes via `_scenario_seed_helpers`. Industry =
   `property_development_feasibility`. Starter scenarios use the existing
   `applies_when` predicate machinery (#1160) to bind to the legislation
   docs and topics this script just ingested.

Reuse anchors (per the orchestrator's reuse-anchors comment on #873)
---------------------------------------------------------------------

This script is the Source-side consumer of the QLD Legislation API key.
The Tailor backend's `QldLegislationClient` is the OTHER consumer of the
same Key Vault secret (`qld-legislation-api-key`); both read the same
provisioned value via env vars / Key Vault. We do NOT introduce a parallel
HTTP client — we use the same auth surface the existing `qld-parser.ts`
uses, expressed in Python.

Out of scope (per the issue body)
---------------------------------

- Fact-model deltas (`domain`, `derivedFrom[]`, `limitations[]`,
  `spatialBasis`) and the `domains` registry — N4 / #876.
- Logan ArcGIS spatial layers — N2 / #874.
- Translink GTFS + cadastre proxy — N3 / #875.
- Generic `source_get_evidence_pack` MCP tool — N4 / #876.

Usage
-----

    # Phase 1 only (legislation via API):
    python scripts/seed_seq_planning_regime.py --phase legislation

    # Phases 2+3 (topics + scenarios — needs DATABASE_URL):
    DATABASE_URL=postgres://... python scripts/seed_seq_planning_regime.py \\
        --phase topics-and-scenarios

    # Run all phases (default):
    python scripts/seed_seq_planning_regime.py

Idempotent. Re-running produces zero new rows on a green run.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote as urlquote

try:
    import requests
except ImportError:  # pragma: no cover — runtime guard
    print("ERROR: requests required. Install: pip install requests")
    sys.exit(2)

# ─── Configuration ──────────────────────────────────────────────────────────
DEFAULT_BASE = "https://source.tailor.au"
QLD_API = "https://api.legislation.qld.gov.au"

# UTC ISO-8601 timestamp captured once per run; used as `retrievedAt` on every
# ingested artifact so the whole batch shares a single retrieval anchor.
RETRIEVED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ─── Phase 1: the 7 SEQ statutes via QLD Legislation API ────────────────────
#
# Each entry maps the legislation.qld.gov.au act identifier to the canonical
# Source `legislation_docs.id`. The Source id format follows the existing
# `qld/act-YYYY-NNN` convention (zero-padded act number) used elsewhere in
# `sites/source/scripts/seed_qld_legislation.py`.

SEQ_STATUTES = [
    {
        "qld_id": "Act-2016-025",
        "source_id": "qld/act-2016-025",
        "title": "Planning Act 2016 (Qld)",
        "short_title": "Planning Act 2016",
        "year": 2016,
        "number": "Act No. 25 of 2016",
        "administered_by": "Department of State Development, Infrastructure and Planning",
    },
    {
        "qld_id": "SL-2017-078",
        "source_id": "qld/reg-2017-078",
        "title": "Planning Regulation 2017 (Qld)",
        "short_title": "Planning Regulation 2017",
        "year": 2017,
        "number": "SL No. 78 of 2017",
        "administered_by": "Department of State Development, Infrastructure and Planning",
        "doc_type": "regulation",
        "related_to": "qld/act-2016-025",
    },
    {
        "qld_id": "Act-1994-067",
        "source_id": "qld/act-1994-067",
        "title": "Transport Infrastructure Act 1994 (Qld)",
        "short_title": "Transport Infrastructure Act 1994",
        "year": 1994,
        "number": "Act No. 67 of 1994",
        "administered_by": "Department of Transport and Main Roads",
    },
    {
        "qld_id": "Act-2012-043",
        "source_id": "qld/act-2012-043",
        "title": "Economic Development Act 2012 (Qld)",
        "short_title": "Economic Development Act 2012",
        "year": 2012,
        "number": "Act No. 43 of 2012",
        "administered_by": "Economic Development Queensland",
    },
    {
        "qld_id": "Act-1971-055",
        "source_id": "qld/act-1971-055",
        "title": "State Development and Public Works Organisation Act 1971 (Qld)",
        "short_title": "SDPWO Act 1971",
        "year": 1971,
        "number": "Act No. 55 of 1971",
        "administered_by": "Office of the Coordinator-General",
    },
    {
        "qld_id": "Act-1975-011",
        "source_id": "qld/act-1975-011",
        "title": "Building Act 1975 (Qld)",
        "short_title": "Building Act 1975",
        "year": 1975,
        "number": "Act No. 11 of 1975",
        "administered_by": "Department of Housing, Local Government, Planning and Public Works",
    },
    {
        "qld_id": "Act-2010-039",
        "source_id": "qld/act-2010-039",
        "title": "Land Valuation Act 2010 (Qld)",
        "short_title": "Land Valuation Act 2010",
        "year": 2010,
        "number": "Act No. 39 of 2010",
        "administered_by": "Department of Resources",
    },
]


# ─── Phase 2: institutional topics (state-level + corridor docs) ────────────
#
# These are NOT legislation_docs (no statutory section structure to parse) —
# they're official government planning instruments / strategic documents that
# the Fabric `evidence` node needs to cite. They land as `topics` rows so they
# unify with the rest of the institutional graph (ShapingSEQ co-applies with
# the Planning Act, etc.) and surface in the `source_search_legislation`
# results union.
#
# `effective_date`, `source_ref` (statutory cite + URL), and a structured
# trailer in `content` carrying `documentVersionId` + `retrievedAt` honour
# the #852 corrections-comment contract pending the formal fact-model
# deltas in N4.

JURISDICTION = "AU-QLD"

STATE_LEVEL_TOPICS = [
    {
        "id": "topic.shapingseq-2023",
        "title": "ShapingSEQ 2023 — South East Queensland Regional Plan",
        "canonical_claim": (
            "ShapingSEQ 2023 is the statutory regional plan for South East "
            "Queensland under the Planning Act 2016. It sets the population, "
            "dwelling, and employment targets to 2046, designates the Urban "
            "Footprint, the Regional Landscape and Rural Production Area, and "
            "the Rural Living Area, and establishes the regional growth-pattern "
            "for 12 LGAs including Logan City."
        ),
        "content": (
            "ShapingSEQ 2023 supersedes the SEQRP 2017 as the Queensland "
            "Government's regional plan for South East Queensland. Made under "
            "section 11 of the Planning Act 2016 (Qld), it is a statutory "
            "instrument that local planning schemes (including the Logan "
            "Planning Scheme) must reflect via the State Planning Policy and "
            "the Minister's planning powers under the Planning Act. Key "
            "components include the regional growth pattern (Urban Footprint, "
            "Regional Landscape and Rural Production Area, Rural Living Area), "
            "12-LGA dwelling targets to 2046, the SEQ Liveability Score "
            "framework, and the Trade and Enterprise corridors that overlap "
            "with the Faster Rail program."
        ),
        "effective_date": "2023-08-04",
        "source_ref": (
            "ShapingSEQ 2023 (made 4 August 2023 under Planning Act 2016 (Qld) s 11). "
            "https://planning.statedevelopment.qld.gov.au/planning-framework/regional-planning/shapingseq-2023"
        ),
        "doc_version_id": "ShapingSEQ-2023-2023-08-04",
    },
    {
        "id": "topic.qld-state-planning-policy",
        "title": "Queensland State Planning Policy (SPP)",
        "canonical_claim": (
            "The State Planning Policy (SPP), made under sections 8 and 22 of "
            "the Planning Act 2016 (Qld), expresses the State's planning "
            "interests as policies that local planning schemes must reflect "
            "and that assessment managers must apply when there is no "
            "compliant local planning scheme provision."
        ),
        "content": (
            "The SPP covers state interests in liveable communities and "
            "housing, economic growth, environment and heritage, hazards and "
            "safety (including flood, bushfire, coastal erosion, landslide), "
            "infrastructure, and natural resources. Where a Logan Planning "
            "Scheme overlay or code does not appropriately integrate an SPP "
            "state interest, the SPP applies directly to development "
            "assessment under section 26(1) of the Planning Regulation 2017."
        ),
        "effective_date": "2017-07-03",
        "source_ref": (
            "State Planning Policy (made under Planning Act 2016 (Qld) ss 8, 22). "
            "https://planning.statedevelopment.qld.gov.au/planning-framework/plan-making/state-planning-policy"
        ),
        "doc_version_id": "QLD-SPP-July-2017",
    },
    {
        "id": "topic.qld-state-development-assessment-provisions",
        "title": "State Development Assessment Provisions (SDAP)",
        "canonical_claim": (
            "The State Development Assessment Provisions (SDAP) is the "
            "statutory instrument under section 26(2) of the Planning "
            "Regulation 2017 that the State (or the State as referral agency) "
            "applies when assessing development against state interests."
        ),
        "content": (
            "SDAP is structured as state codes (SC1.1 Liveable Housing, "
            "SC1.2 Tidal Works, SC1.3 Mining and Petroleum, SC1.4 Coastal "
            "Protection, SC1.5 Reconfiguring a Lot, SC1.6 Subordinate Local "
            "Government, SC1.7 Hazardous Chemical Facilities, SC1.8 Wind Farm "
            "Development, etc.) and module codes. Logan TLPI overlays and "
            "flood-risk overlays sit alongside SDAP — SDAP applies to State "
            "interest matters and is referenced from the Planning "
            "Regulation 2017 schedules."
        ),
        "effective_date": "2017-07-03",
        "source_ref": (
            "State Development Assessment Provisions (made under Planning Regulation 2017 (Qld) s 26(2)). "
            "https://planning.statedevelopment.qld.gov.au/planning-framework/development-assessment/sdap"
        ),
        "doc_version_id": "QLD-SDAP-v3.0",
    },
    {
        "id": "topic.logan-planning-scheme",
        "title": "Logan Planning Scheme (Logan City Council)",
        "canonical_claim": (
            "The Logan Planning Scheme is the statutory local planning "
            "instrument for Logan City made under chapter 2 of the Planning "
            "Act 2016 (Qld). It contains the strategic framework, zones, "
            "overlays (including Flood Hazard, Bushfire Hazard, Heritage and "
            "Neighbourhood Character), and the codes that apply to development "
            "applications in Logan City."
        ),
        "content": (
            "The scheme designates zones (e.g. low-density residential, "
            "medium-density residential, high-density residential, centre, "
            "mixed use, industry) and applies overlays that constrain "
            "development including the Flood Hazard Overlay, Bushfire Hazard "
            "Overlay, Biodiversity Overlay, and the Transit-Oriented "
            "Development overlays around major rail stations. TLPI "
            "(Temporary Local Planning Instrument) provisions can be made by "
            "Council under the Planning Act 2016 (Qld) to amend the scheme "
            "rapidly in response to changed circumstances."
        ),
        "effective_date": "2015-04-13",
        "source_ref": (
            "Logan Planning Scheme (made under Planning Act 2016 (Qld) ch 2). "
            "https://www.logan.qld.gov.au/planning/logan-planning-scheme"
        ),
        "doc_version_id": "Logan-PS-current",
    },
]

CORRIDOR_TOPICS = [
    {
        "id": "topic.qld-faster-rail-program",
        "title": "QLD Faster Rail Program (Beenleigh to Gold Coast / Brisbane)",
        "canonical_claim": (
            "The Queensland Faster Rail Program is the State infrastructure "
            "program upgrading the SEQ rail corridor between Brisbane, Logan "
            "(Beenleigh), and the Gold Coast. The program is delivered by "
            "the Department of Transport and Main Roads under the Transport "
            "Infrastructure Act 1994 (Qld) and is co-ordinated with the "
            "Faster Rail Australia Federal Government partnership."
        ),
        "content": (
            "Faster Rail upgrades target ~45-minute Brisbane-Gold Coast "
            "journey times via track duplication, signalling upgrades, "
            "station rebuilds, and grade separations. Stations on the "
            "in-scope corridor relevant to Logan City development feasibility "
            "include Loganlea, Beenleigh, Trinder Park, Woodridge, Bethania, "
            "Kuraby, and Kingston. Each station upgrade carries a separate "
            "concept design / business case, and the program is gazetted under "
            "the Transport Infrastructure Act 1994 (Qld) as a transport "
            "infrastructure project."
        ),
        "effective_date": "2023-01-01",
        "source_ref": (
            "Faster Rail Program (Department of Transport and Main Roads, QLD). "
            "https://www.tmr.qld.gov.au/projects/faster-rail"
        ),
        "doc_version_id": "Faster-Rail-2023-program",
    },
    # 7 station-specific topics — Loganlea, Beenleigh, Trinder Park, Woodridge,
    # Bethania, Kuraby, Kingston.
    *[
        {
            "id": f"topic.qld-faster-rail-station-{slug}",
            "title": f"{station} Station — Faster Rail upgrade and TOD scope",
            "canonical_claim": (
                f"{station} Station is in scope for the QLD Faster Rail "
                f"Program. The Department of Transport and Main Roads has "
                f"published the station upgrade and Transit-Oriented "
                f"Development (TOD) catchment that informs Logan City "
                f"Council's planning scheme overlays for parcels within "
                f"~400m (Core TOD) and ~800m (Frame TOD) of the station."
            ),
            "content": (
                f"The {station} Station upgrade is delivered under the "
                f"Transport Infrastructure Act 1994 (Qld) by the Department "
                f"of Transport and Main Roads. The TOD catchment "
                f"membership for surrounding parcels is a deterministic "
                f"derived fact (geographic distance from station "
                f"coordinates) and is referenced by the Logan Planning "
                f"Scheme TOD overlays. Construction phasing and patronage "
                f"forecasts inform the strike-price and DCF assumptions for "
                f"feasibility models on parcels in the catchment."
            ),
            "effective_date": "2023-01-01",
            "source_ref": (
                f"{station} Station — Faster Rail Program "
                f"(Department of Transport and Main Roads, QLD). "
                f"https://www.tmr.qld.gov.au/projects/faster-rail/{slug}"
            ),
            "doc_version_id": f"Faster-Rail-{station.replace(' ', '-')}-2023",
        }
        for station, slug in [
            ("Loganlea", "loganlea"),
            ("Beenleigh", "beenleigh"),
            ("Trinder Park", "trinder-park"),
            ("Woodridge", "woodridge"),
            ("Bethania", "bethania"),
            ("Kuraby", "kuraby"),
            ("Kingston", "kingston"),
        ]
    ],
]

ALL_TOPICS = STATE_LEVEL_TOPICS + CORRIDOR_TOPICS


# ─── Phase 3: property-development-feasibility scenario cluster ─────────────
#
# Industry = "property_development_feasibility". Starter scenarios bind the
# Source-side knowledge graph (legislation + topics) to the predicate space
# that the Fabric `evidence` node will query in N4 (#876). Predicates use the
# vocabulary documented in `sites/source/docs/predicate-vocabulary.md` where
# possible; new predicates are deliberately verbose so a future predicate
# audit can canonicalise them.
#
# Edge shape: `applies_when` carries a `predicate` JSONB blob plus an optional
# free-text `note`. `topic_id` and `legislation_id` are mutually exclusive.

INDUSTRY = "property_development_feasibility"

SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "scn.qld-seq-property-development-feasibility",
        "title": "SEQ property developer assessing parcel for residential development",
        "description": (
            "An Australian property developer assessing a parcel in South East "
            "Queensland for residential / mixed-use development. The parcel is "
            "subject to the Planning Act 2016 (Qld) regulatory regime, the "
            "ShapingSEQ regional plan, the State Planning Policy, the State "
            "Development Assessment Provisions, and the relevant local "
            "planning scheme. Building work triggers the Building Act 1975. "
            "Strike-price and acquisition models reference the Land Valuation "
            "Act 2010 statutory valuations."
        ),
        "predicates": {
            "country_of_operation": "AU",
            "jurisdiction": "AU-QLD",
            "region": "SEQ",
            "activity_class": "property_development",
        },
        "tags": ["property-development", "feasibility", "seq", "qld"],
        "topic_links": [
            ("topic.shapingseq-2023", {"required": True},
             "Regional plan applies to all SEQ parcels"),
            ("topic.qld-state-planning-policy", {"required": True},
             "SPP state interests apply to assessment"),
            ("topic.qld-state-development-assessment-provisions", {"required": True},
             "SDAP state codes when State is referral agency"),
        ],
        "legislation_links": [
            ("qld/act-2016-025", {"required": True},
             "Planning Act 2016 — primary regulatory regime"),
            ("qld/reg-2017-078", {"required": True},
             "Planning Regulation 2017 — assessment categories + referrals"),
            ("qld/act-1975-011", {"required": False, "condition": "involves_building_work"},
             "Building Act 1975 — applies if building work is proposed"),
            ("qld/act-2010-039", {"required": False, "condition": "uses_statutory_valuation"},
             "Land Valuation Act 2010 — statutory valuation reference"),
        ],
    },
    {
        "id": "scn.qld-logan-tod-development-feasibility",
        "title": "Logan City property developer assessing TOD-catchment parcel",
        "description": (
            "An Australian property developer assessing a parcel in Logan "
            "City within the Transit-Oriented Development catchment of a "
            "Faster Rail station. The Logan Planning Scheme TOD overlay "
            "applies, the Transport Infrastructure Act 1994 governs the "
            "rail corridor, and the Faster Rail program informs station "
            "construction phasing. Catchment membership is a deterministic "
            "derived fact based on distance from station coordinates."
        ),
        "predicates": {
            "country_of_operation": "AU",
            "jurisdiction": "AU-QLD",
            "lga": "Logan City",
            "activity_class": "property_development",
            "in_tod_catchment": True,
        },
        "tags": ["property-development", "feasibility", "logan", "tod", "faster-rail"],
        "topic_links": [
            ("topic.logan-planning-scheme", {"required": True},
             "Local planning scheme applies"),
            ("topic.shapingseq-2023", {"required": True},
             "Regional plan applies"),
            ("topic.qld-state-planning-policy", {"required": True},
             "SPP state interests"),
            ("topic.qld-faster-rail-program", {"required": True},
             "Faster Rail informs TOD catchment"),
            ("topic.qld-faster-rail-station-loganlea",
             {"required": False, "condition": "near_station_loganlea"},
             "Loganlea station catchment"),
            ("topic.qld-faster-rail-station-beenleigh",
             {"required": False, "condition": "near_station_beenleigh"},
             "Beenleigh station catchment"),
            ("topic.qld-faster-rail-station-trinder-park",
             {"required": False, "condition": "near_station_trinder_park"},
             "Trinder Park station catchment"),
            ("topic.qld-faster-rail-station-woodridge",
             {"required": False, "condition": "near_station_woodridge"},
             "Woodridge station catchment"),
            ("topic.qld-faster-rail-station-bethania",
             {"required": False, "condition": "near_station_bethania"},
             "Bethania station catchment"),
            ("topic.qld-faster-rail-station-kuraby",
             {"required": False, "condition": "near_station_kuraby"},
             "Kuraby station catchment"),
            ("topic.qld-faster-rail-station-kingston",
             {"required": False, "condition": "near_station_kingston"},
             "Kingston station catchment"),
        ],
        "legislation_links": [
            ("qld/act-2016-025", {"required": True},
             "Planning Act 2016"),
            ("qld/reg-2017-078", {"required": True},
             "Planning Regulation 2017"),
            ("qld/act-1994-067",
             {"required": False, "condition": "rail_corridor_referral"},
             "Transport Infrastructure Act 1994"),
            ("qld/act-1975-011",
             {"required": False, "condition": "involves_building_work"},
             "Building Act 1975"),
        ],
    },
    {
        "id": "scn.qld-priority-development-area-feasibility",
        "title": "Property developer in a Priority Development Area (PDA)",
        "description": (
            "An Australian property developer assessing a parcel inside a "
            "Priority Development Area (PDA) declared under the Economic "
            "Development Act 2012 (Qld). PDAs are administered by Economic "
            "Development Queensland and have their own development scheme "
            "that displaces parts of the Planning Act 2016 framework."
        ),
        "predicates": {
            "country_of_operation": "AU",
            "jurisdiction": "AU-QLD",
            "activity_class": "property_development",
            "in_priority_development_area": True,
        },
        "tags": ["property-development", "feasibility", "pda", "edq"],
        "topic_links": [
            ("topic.shapingseq-2023", {"required": True},
             "Regional plan still applies inside PDA"),
        ],
        "legislation_links": [
            ("qld/act-2012-043", {"required": True},
             "Economic Development Act 2012 — PDA development scheme"),
            ("qld/act-2016-025",
             {"required": False, "condition": "edq_pda_scheme_silent"},
             "Planning Act 2016 — applies to matters not covered by PDA scheme"),
            ("qld/act-1975-011",
             {"required": False, "condition": "involves_building_work"},
             "Building Act 1975"),
        ],
    },
    {
        "id": "scn.qld-coordinated-project-feasibility",
        "title": "Property / infrastructure developer with a Coordinated Project declaration",
        "description": (
            "An Australian developer / proponent whose project has been "
            "declared a Coordinated Project under the State Development and "
            "Public Works Organisation Act 1971 (Qld). Triggers the "
            "Coordinator-General's whole-of-government assessment process "
            "and may displace local planning scheme assessment manager "
            "responsibilities."
        ),
        "predicates": {
            "country_of_operation": "AU",
            "jurisdiction": "AU-QLD",
            "activity_class": "property_development",
            "is_coordinated_project": True,
        },
        "tags": ["property-development", "feasibility", "coordinator-general", "sdpwo"],
        "topic_links": [
            ("topic.shapingseq-2023", {"required": True},
             "Regional plan applies"),
            ("topic.qld-state-planning-policy", {"required": True},
             "SPP state interests"),
        ],
        "legislation_links": [
            ("qld/act-1971-055", {"required": True},
             "SDPWO Act — Coordinated Project process"),
            ("qld/act-2016-025", {"required": True},
             "Planning Act — residual assessment"),
            ("qld/act-1975-011",
             {"required": False, "condition": "involves_building_work"},
             "Building Act 1975"),
        ],
    },
]


# ─── HTTP utilities ──────────────────────────────────────────────────────────


class QldApiClient:
    """Thin client for the QLD Legislation API.

    Mirrors the auth + fetch pattern from
    `sites/source/src/lib/parsers/qld-parser.ts`. Token is cached for the
    duration of the script run; the API rotates it daily.
    """

    def __init__(self) -> None:
        username = os.environ.get("QLD_LEGISLATION_USERNAME")
        password = os.environ.get("QLD_LEGISLATION_PASSWORD")
        if not username or not password:
            raise RuntimeError(
                "QLD_LEGISLATION_USERNAME and QLD_LEGISLATION_PASSWORD must be set "
                "(see #873 reuse-anchors comment — same key as Tailor backend uses)."
            )
        self._session = requests.Session()
        resp = self._session.post(
            f"{QLD_API}/v1/auth/token",
            json={"username": username, "password": password},
            timeout=15,
        )
        resp.raise_for_status()
        self._token = resp.json()["access_token"]

    def _headers(self, accept: str = "application/json") -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}", "Accept": accept}

    def latest_version(self, qld_id: str) -> dict[str, Any] | None:
        """Find the most recent in-force version of an act / regulation.

        The QLD Legislation API segregates documents by `print_type`. Acts
        usually live under `act-reprint`, but newer reprints sometimes only
        appear under `as-made` or `act-as-made`, and subordinate legislation
        (SL-xxxx) tends to live under `regulation-reprint` or no print_type
        filter at all. Try the most-likely candidates in order, then fall
        back to a no-print-type search before giving up.
        """
        # Order candidates from most to least specific. The QLD API rejects
        # unknown values (some endpoints 400, others just return zero rows),
        # so any candidate that errors is silently skipped.
        candidates: list[str | None] = (
            [
                "act-reprint",
                "act-as-made",
                "act-as-passed",
                "as-made",
                "as-passed",
                "consolidated",
                "published",
                None,
            ]
            if qld_id.startswith("Act-")
            else [
                "regulation-reprint",
                "regulation-as-made",
                "as-made",
                "consolidated",
                None,
            ]
        )
        last_status = None
        for print_type in candidates:
            params = {"page": 1, "limit": 50, "id": qld_id}
            if print_type:
                params["print_type"] = print_type
            resp = self._session.get(
                f"{QLD_API}/v1/documents",
                params=params,
                headers=self._headers(),
                timeout=30,
            )
            last_status = resp.status_code
            if not resp.ok:
                continue
            data = resp.json()
            docs = data.get("documents") or []
            if not docs:
                continue
            best = max(docs, key=lambda d: d.get("first_valid_date") or "0000-00-00")
            best["_print_type_used"] = print_type or "(none)"
            return best
        # Final fallback: bare search with no filters at all.
        resp = self._session.get(
            f"{QLD_API}/v1/documents",
            params={"page": 1, "limit": 50, "id": qld_id},
            headers=self._headers(),
            timeout=30,
        )
        if not resp.ok:
            print(f"    no candidates found for {qld_id} (last status {last_status})")
            return None
        data = resp.json()
        docs = data.get("documents") or []
        if not docs:
            print(f"    no documents returned for {qld_id} (last status {last_status})")
            return None
        best = max(docs, key=lambda d: d.get("first_valid_date") or "0000-00-00")
        best["_print_type_used"] = "(bare-search)"
        return best

    def fetch_html(
        self,
        qld_id: str,
        point_in_time: str | None = None,
        print_type: str | None = None,
    ) -> str:
        """Fetch the HTML rendition. `print_type` should be the value that
        actually returned a hit in `latest_version()` — the rendition endpoint
        only accepts the same set the search endpoint indexes."""
        path = f"/v1/renditions/html/{urlquote(qld_id)}"
        params: dict[str, str] = {}
        if print_type and print_type not in ("(none)", "(bare-search)"):
            params["print_type"] = print_type
        elif qld_id.startswith("Act-"):
            params["print_type"] = "act-reprint"
        if point_in_time:
            params["point_in_time"] = point_in_time
        resp = self._session.get(
            f"{QLD_API}{path}",
            params=params,
            headers=self._headers(accept="text/html"),
            timeout=60,
        )
        resp.raise_for_status()
        return _normalize_encoding(resp.text)


def _normalize_encoding(text: str) -> str:
    # Mirror qld-parser.ts normalizeEncoding — strip mojibake artefacts the
    # QLD API has consistently emitted.
    replacements = {
        "â": "’",  # '
        "â": "“",  # "
        "â": "”",  # "
        "â": "–",  # –
        "â": "—",  # —
        "Â§": "§",          # §
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    text = re.sub(r"[-]", "", text)
    return text


def parse_qld_html(html: str) -> list[dict[str, Any]]:
    """Approximate the qld-parser.ts section parser in Python.

    The QLD reprint HTML carries section headings as `<h*>` / `<p>` elements
    with class names `section-heading`, `provision-title`, or `ActHead5`.
    Returns a list of section dicts ready for the `/api/axiom/legislation/ingest`
    contract.
    """
    sections: list[dict[str, Any]] = []
    current_part = ""
    order = 0

    text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.IGNORECASE | re.DOTALL)

    # Capture Part / Division / Chapter / Schedule headings to anchor sections.
    part_pattern = re.compile(
        r"<h[1-4][^>]*>(?:<[^>]+>)*\s*(Part|Division|Chapter|Schedule)\s+([\dIVXLCDM]+[A-Z]?)\s*[-–—]?\s*([^<]+)",
        re.IGNORECASE,
    )

    def extract_part(idx: int) -> str:
        nonlocal current_part
        # Walk the text up to the section index and pick the latest part heading.
        for m in part_pattern.finditer(text, 0, idx):
            current_part = f"{m.group(1)} {m.group(2)} — {m.group(3).strip()}"
        return current_part

    section_pattern = re.compile(
        r"<(?:h\d|p)[^>]*class=\"[^\"]*(?:section-heading|provision-title|ActHead5)[^\"]*\"[^>]*>"
        r"(?:<[^>]+>)*\s*(\d+[A-Z]*(?:\([^)]*\))?)\s+([^<]+)",
        re.IGNORECASE,
    )

    for sec_match in section_pattern.finditer(text):
        section_no = sec_match.group(1).strip()
        title = re.sub(r"&\w+;", " ", sec_match.group(2)).strip()
        after_idx = sec_match.end()
        next_h_idx = text.find("<h", after_idx + 10)
        end_idx = min(next_h_idx, after_idx + 8000) if next_h_idx > 0 else after_idx + 8000
        content_slice = text[after_idx:end_idx]

        content = re.sub(r"<[^>]+>", " ", content_slice)
        content = (
            content.replace("&nbsp;", " ")
            .replace("&#xa0;", " ")
            .replace("&#160;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
        )
        content = re.sub(r"&#\d+;", " ", content)
        content = re.sub(r"\s+", " ", content).strip()[:4000]

        if len(content) < 10:
            continue

        part = extract_part(sec_match.start())
        sections.append(
            {
                "sectionId": f"s {section_no}",
                "title": title,
                "content": content,
                "depth": 2 if part else 1,
                "parentSection": part or None,
                "order": order,
                "status": "in_force",
            }
        )
        order += 1

    if not sections:
        # Fallback chunker — preserves something searchable when the section
        # parser can't lock onto the QLD CSS classes.
        stripped = re.sub(r"<[^>]+>", "\n", text)
        stripped = re.sub(r"\s+", " ", stripped).strip()
        lines = [line for line in stripped.split("\n") if len(line.strip()) > 30]
        for i in range(0, min(len(lines), 80), 3):
            chunk = " ".join(lines[i : i + 3]).strip()[:4000]
            if len(chunk) > 30:
                sections.append(
                    {
                        "sectionId": f"chunk-{len(sections) + 1}",
                        "title": f"Section {len(sections) + 1}",
                        "content": chunk,
                        "depth": 1,
                        "order": len(sections),
                        "status": "in_force",
                    }
                )

    return sections


# ─── Phase 1 driver: 7 statutes via QLD Legislation API ─────────────────────


def seed_legislation(base_url: str, admin_key: str) -> dict[str, Any]:
    print(f"[phase 1] Fetching {len(SEQ_STATUTES)} SEQ statutes from {QLD_API}")
    client = QldApiClient()
    print(f"[phase 1] Authenticated; iterating statutes")

    docs_to_ingest: list[dict[str, Any]] = []
    fetch_errors: list[str] = []

    for entry in SEQ_STATUTES:
        qld_id = entry["qld_id"]
        print(f"  -> {qld_id} ({entry['title']})")
        try:
            doc = client.latest_version(qld_id)
            if not doc:
                msg = f"{qld_id}: no versions found"
                print(f"    SKIP {msg}")
                fetch_errors.append(msg)
                continue
            if str(doc.get("repealed", "")).upper() == "Y":
                msg = f"{qld_id}: repealed"
                print(f"    SKIP {msg}")
                fetch_errors.append(msg)
                continue

            point_in_time = doc.get("first_valid_date") or None
            print_type_used = doc.get("_print_type_used")
            html = client.fetch_html(
                qld_id, point_in_time=point_in_time, print_type=print_type_used
            )
            sections = parse_qld_html(html)
            if not sections:
                msg = f"{qld_id}: no sections parsed (html {len(html)} chars, print_type={print_type_used})"
                print(f"    SKIP {msg}")
                fetch_errors.append(msg)
                continue

            in_force = doc.get("first_valid_date") or None
            version_id = (
                doc.get("version_series_id") or doc.get("id") or qld_id
            )
            doc_payload: dict[str, Any] = {
                "id": entry["source_id"],
                "jurisdiction": "QLD",
                "type": entry.get("doc_type", "act"),
                "title": entry["title"],
                "shortTitle": entry["short_title"],
                "year": entry["year"],
                # Embed documentVersionId + retrievedAt in the existing
                # `number` field per the #852 corrections-comment contract
                # — formal fact-model deltas land in N4 (#876).
                "number": (
                    f"{entry['number']} | versionSeriesId={version_id} | "
                    f"retrievedAt={RETRIEVED_AT}"
                ),
                "inForceDate": in_force,
                "lastAmendedDate": in_force,
                "administeredBy": entry["administered_by"],
                "legislationUrl": (
                    f"https://www.legislation.qld.gov.au/view/whole/html/inforce/current/"
                    f"{qld_id.lower()}"
                ),
                "sections": sections,
            }
            if entry.get("related_to"):
                doc_payload["relatedDocs"] = [entry["related_to"]]

            docs_to_ingest.append(doc_payload)
            print(
                f"    OK {qld_id} -> {len(sections)} sections "
                f"(in_force={in_force}, version={version_id}, print_type={print_type_used})"
            )
            time.sleep(2.0)  # be a polite caller — same throttle as qld-parser.ts
        except Exception as exc:
            msg = f"{qld_id}: {exc}"
            print(f"    ERROR {msg}")
            fetch_errors.append(msg)

    if not docs_to_ingest:
        return {
            "ingested": 0,
            "documents": [],
            "errors": fetch_errors,
            "phase": "legislation",
        }

    print(
        f"[phase 1] POST /api/axiom/legislation/ingest "
        f"({len(docs_to_ingest)} docs)"
    )
    resp = requests.post(
        f"{base_url.rstrip('/')}/api/axiom/legislation/ingest",
        headers={"Content-Type": "application/json", "X-Admin-Key": admin_key},
        json={"documents": docs_to_ingest},
        timeout=120,
    )
    if not resp.ok:
        return {
            "ingested": 0,
            "documents": [],
            "errors": fetch_errors
            + [f"ingest HTTP {resp.status_code}: {resp.text[:500]}"],
            "phase": "legislation",
        }

    data = resp.json()
    for doc in data.get("documents", []):
        print(
            f"  ingested {doc['id']:30s}  {doc['sectionsInserted']:4d} sections"
        )
    return {
        "ingested": data.get("ingested", 0),
        "documents": data.get("documents", []),
        "errors": fetch_errors,
        "phase": "legislation",
    }


# ─── Phase 2 driver: institutional topics ───────────────────────────────────


def _import_psycopg2():
    try:
        import psycopg2
        import psycopg2.extras  # noqa: F401  (used implicitly when needed)

        return psycopg2
    except ImportError:
        print(
            "ERROR: psycopg2 required for phases 2+3. "
            "Install: pip install psycopg2-binary"
        )
        sys.exit(2)


def seed_topics() -> dict[str, Any]:
    psycopg2 = _import_psycopg2()
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[phase 2] DATABASE_URL not set — skipping topics")
        return {"phase": "topics", "skipped": True}

    print(f"[phase 2] Upserting {len(ALL_TOPICS)} topics directly into Postgres")
    created = 0
    updated = 0
    # NOTE: psycopg2 connections are themselves context managers that wrap a
    # transaction (commit on success, rollback on exception). Nesting `with
    # conn:` inside a top-level connection-as-transaction context manager
    # raises `the connection cannot be re-entered recursively`. Use the
    # connection directly as the transaction scope and explicitly close it
    # in `finally`.
    conn = psycopg2.connect(db_url)
    try:
        with conn:  # transaction scope
            with conn.cursor() as cur:
                for topic in ALL_TOPICS:
                    # Embed retrievedAt + documentVersionId in the body so the
                    # corrections-comment contract is honoured pending the
                    # formal fact-model deltas landing in N4 (#876).
                    body = (
                        f"{topic['content']}\n\n"
                        f"---\n"
                        f"documentVersionId: {topic['doc_version_id']}\n"
                        f"effectiveDate: {topic['effective_date']}\n"
                        f"retrievedAt: {RETRIEVED_AT}\n"
                    )
                    cur.execute(
                        "SELECT 1 FROM topics WHERE id = %s",
                        (topic["id"],),
                    )
                    existed = cur.fetchone() is not None
                    cur.execute(
                        """
                        INSERT INTO topics
                          (id, title, content, tier, status, canonical_claim,
                           jurisdiction, authority, source_ref, effective_date,
                           last_verified_at)
                        VALUES (%s, %s, %s, 'institutional', 'locked', %s,
                                %s, %s, %s, %s, NOW())
                        ON CONFLICT (id) DO UPDATE SET
                          title = EXCLUDED.title,
                          content = EXCLUDED.content,
                          canonical_claim = EXCLUDED.canonical_claim,
                          source_ref = EXCLUDED.source_ref,
                          effective_date = EXCLUDED.effective_date,
                          last_verified_at = EXCLUDED.last_verified_at
                        """,
                        (
                            topic["id"],
                            topic["title"],
                            body,
                            topic["canonical_claim"],
                            JURISDICTION,
                            "Queensland Government",
                            topic["source_ref"],
                            topic["effective_date"],
                        ),
                    )
                    if existed:
                        updated += 1
                        print(f"  updated {topic['id']}")
                    else:
                        created += 1
                        print(f"  created {topic['id']}")
    finally:
        conn.close()
    return {"phase": "topics", "created": created, "updated": updated, "total": len(ALL_TOPICS)}


# ─── Phase 3 driver: scenarios + applies_when edges ─────────────────────────


def seed_scenarios() -> dict[str, Any]:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[phase 3] DATABASE_URL not set — skipping scenarios")
        return {"phase": "scenarios", "skipped": True}

    # Import the existing helper module — same pattern as the #1152 seed
    # scripts. We intentionally avoid duplicating the helper logic here.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _scenario_seed_helpers import (  # type: ignore  # noqa: E402
        connect,
        upsert_scenario,
        add_applies_when,
    )

    print(f"[phase 3] Upserting {len(SCENARIOS)} scenarios + edges")
    created_scenarios = 0
    created_edges = 0
    total_edges = 0

    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                for scn in SCENARIOS:
                    cur.execute("SELECT 1 FROM scenarios WHERE id = %s", (scn["id"],))
                    existed = cur.fetchone() is not None
                    upsert_scenario(
                        cur,
                        scn["id"],
                        scn["title"],
                        scn["description"],
                        INDUSTRY,
                        scn["predicates"],
                        scn["tags"],
                        jurisdiction=JURISDICTION,
                        source_ref="#873 — SEQ planning regime seed",
                    )
                    if existed:
                        print(f"  updated scenario {scn['id']}")
                    else:
                        created_scenarios += 1
                        print(f"  created scenario {scn['id']}")

                    for topic_id, predicate, note in scn["topic_links"]:
                        # Confirm the topic exists by id (these are deterministic
                        # ids we just upserted in phase 2).
                        cur.execute("SELECT 1 FROM topics WHERE id = %s", (topic_id,))
                        if cur.fetchone() is None:
                            print(
                                f"    SKIP edge -> topic {topic_id} (not found — "
                                f"phase 2 may have been skipped)"
                            )
                            continue
                        total_edges += 1
                        if add_applies_when(
                            cur,
                            scn["id"],
                            topic_id=topic_id,
                            predicate=predicate,
                            note=note,
                        ):
                            created_edges += 1

                    for leg_id, predicate, note in scn["legislation_links"]:
                        # legislation_id is free text — no FK enforcement, so we
                        # don't need to verify existence here, but a quick check
                        # surfaces typos against legislation_docs.
                        cur.execute(
                            "SELECT 1 FROM legislation_docs WHERE id = %s",
                            (leg_id,),
                        )
                        if cur.fetchone() is None:
                            print(
                                f"    WARN edge -> legislation {leg_id} "
                                f"(not in legislation_docs — phase 1 may have failed)"
                            )
                        total_edges += 1
                        if add_applies_when(
                            cur,
                            scn["id"],
                            legislation_id=leg_id,
                            predicate=predicate,
                            note=note,
                        ):
                            created_edges += 1
    finally:
        conn.close()

    return {
        "phase": "scenarios",
        "created_scenarios": created_scenarios,
        "total_scenarios": len(SCENARIOS),
        "created_edges": created_edges,
        "total_edges": total_edges,
    }


# ─── Entry point ────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed the SEQ planning regime into Source (#873)"
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("SOURCE_BASE_URL", DEFAULT_BASE),
        help="Source base URL (default: SOURCE_BASE_URL env var or production)",
    )
    parser.add_argument(
        "--admin-key",
        default=os.environ.get("ADMIN_SECRET", ""),
        help="Admin key for /api/axiom/legislation/ingest (default: ADMIN_SECRET env var)",
    )
    parser.add_argument(
        "--phase",
        choices=["all", "legislation", "topics-and-scenarios", "topics", "scenarios"],
        default="all",
        help="Run a subset of phases (default: all)",
    )
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    summary: dict[str, Any] = {"retrievedAt": RETRIEVED_AT, "phases": []}

    legislation_ok = True

    if args.phase in ("all", "legislation"):
        if not args.admin_key:
            print("ERROR: phase 1 needs --admin-key or ADMIN_SECRET env var")
            return 1
        try:
            phase1 = seed_legislation(base, args.admin_key)
            summary["phases"].append(phase1)
            if phase1.get("ingested", 0) == 0:
                legislation_ok = False
                print(
                    "ERROR: phase 1 ingested zero documents — skipping phases 2 and 3 "
                    "to avoid creating dangling scenario edges. See errors above."
                )
        except Exception as exc:
            legislation_ok = False
            print(f"ERROR: phase 1 crashed: {exc}")
            summary["phases"].append({
                "phase": "legislation",
                "ingested": 0,
                "documents": [],
                "errors": [f"crashed: {exc}"],
            })

    # Phase 2 + 3 only run if phase 1 succeeded — otherwise the scenarios
    # would carry edges to topics/legislation that don't exist yet.
    if legislation_ok and args.phase in ("all", "topics-and-scenarios", "topics"):
        try:
            summary["phases"].append(seed_topics())
        except Exception as exc:
            print(f"ERROR: phase 2 (topics) crashed: {exc}")
            summary["phases"].append({"phase": "topics", "errors": [f"crashed: {exc}"]})

    if legislation_ok and args.phase in ("all", "topics-and-scenarios", "scenarios"):
        try:
            summary["phases"].append(seed_scenarios())
        except Exception as exc:
            print(f"ERROR: phase 3 (scenarios) crashed: {exc}")
            summary["phases"].append({"phase": "scenarios", "errors": [f"crashed: {exc}"]})

    print()
    print("=== Summary ===")
    print(json.dumps(summary, indent=2, default=str))

    if not legislation_ok:
        return 1

    # Soft warnings for partial phase-1 errors.
    for p in summary["phases"]:
        if p.get("phase") == "legislation" and p.get("errors"):
            print(f"WARN: phase 1 had {len(p['errors'])} fetch error(s)")

    # Hard-fail if any non-legislation phase reported a crash.
    for p in summary["phases"]:
        if p.get("phase") in ("topics", "scenarios") and p.get("errors"):
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
