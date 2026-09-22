#!/usr/bin/env python3
"""
File the Brisbane council-instrument proposals into PACT's consensus queue.
Refs #5117 (child of epic #5114 — public-statute coverage, finding 4).

COUNCIL-INSTRUMENT CLASS (the #5117 decision — see sites/source/README.md
§ Council-instrument class): planning schemes and local laws made by local
governments are PUBLIC statutory instruments, but they are NOT published on
legislation.qld.gov.au and have no state-register reprint the curated
free-legislation tier can verify against. They are therefore CONSENSUS-TIER:
they enter the knowledge graph via `POST /api/pact/legislation/propose`
citing the official council source, and require independent agent
verification against that source before ingest (3+ verifications
auto-ingest). While queued they surface in the public search union as
"[Legislation Proposal]" topics, which the #5105 machinery classifies
`pending_verification` — status-only, never citable, never silently absent.

This script is a MANUAL, ONE-OFF filing tool. It is deliberately NOT wired
into cd-source.yml: the propose endpoint creates a new proposal topic on
every call (it is not an idempotent upsert), so re-running it on every
deploy would spam the consensus queue. Re-run only to file a NEW council
instrument (or to re-file after a proposal is rejected).

The proposal sections carry STRUCTURAL, verifiable facts only (what the
instrument is, who made it, under what power, where the official text
lives). Substantive provision text is left to the verification flow against
the official council source — nothing is fabricated.

Verification marshalling is HUMAN-owned (pact#47) and out of scope here:
after filing, flag the pending proposals for verifier marshalling.

Usage:
    python scripts/propose_bcc_council_instruments.py [--base-url URL] [--agent-key KEY] [--agent-name NAME]

    --agent-key   Bearer key of a registered PACT agent (or set SOURCE_AGENT_KEY).
                  If omitted, the script registers a fresh agent
                  (POST /api/pact/register) named --agent-name and uses its key.
"""

import argparse
import os
import sys

import requests

DEFAULT_BASE = "https://pact.tailor.au"

PROPOSALS = [
    {
        "document": {
            "id": "qld/bcc/city-plan-2014",
            "jurisdiction": "QLD",
            "type": "planning_scheme",
            "title": "Brisbane City Plan 2014 (Brisbane City Council planning scheme)",
            "shortTitle": "Brisbane City Plan 2014",
            "year": 2014,
            "administeredBy": "Brisbane City Council",
            "legislationUrl": "https://cityplan.brisbane.qld.gov.au/",
            "sections": [
                {
                    "sectionId": "part 1",
                    "title": "About the planning scheme",
                    "content": "Brisbane City Plan 2014 is Brisbane City Council's planning scheme for the City of Brisbane, in effect from 30 June 2014. It is a statutory instrument that now operates under the Planning Act 2016 (Qld) and applies to development within Brisbane City Council's local government area. The current in-force text, including all amendment packages, is published by Brisbane City Council on its ePlan site (cityplan.brisbane.qld.gov.au) — it is NOT published on legislation.qld.gov.au.",
                    "depth": 1, "order": 0, "status": "in_force",
                },
                {
                    "sectionId": "part 3",
                    "title": "Strategic framework",
                    "content": "The strategic framework sets the policy direction for the planning scheme and forms the basis for ensuring appropriate development occurs within the planning scheme area for the life of the planning scheme. Verification note: confirm current wording and structure against the in-force ePlan text.",
                    "depth": 1, "order": 1, "status": "in_force",
                },
                {
                    "sectionId": "parts 5-8",
                    "title": "Tables of assessment, zones, overlays and codes",
                    "content": "The scheme organises development regulation through categories of development and assessment (tables of assessment), zones and neighbourhood plans, overlays, and assessment benchmarks in zone/use/other development codes. Verification note: pinpoint content (e.g. specific zone codes or overlay provisions relevant to entertainment precincts and centre activities) must be verified against the in-force ePlan text before any pinpoint is served as citable.",
                    "depth": 1, "order": 2, "status": "in_force",
                },
            ],
        },
        "summary": (
            "Council-instrument class filing (#5117): Brisbane City Plan 2014 is a public statutory "
            "planning scheme made by Brisbane City Council under Queensland planning legislation "
            "(now operating under the Planning Act 2016). It is public but not on "
            "legislation.qld.gov.au, so it cannot ride the curated free-legislation tier — "
            "verification must run against the official BCC ePlan source."
        ),
        "gazetteUrl": "https://cityplan.brisbane.qld.gov.au/",
    },
    {
        "document": {
            "id": "qld/bcc/local-laws",
            "jurisdiction": "QLD",
            "type": "local_law",
            "title": "Brisbane City Council local laws (consolidated register)",
            "shortTitle": "BCC local laws",
            "administeredBy": "Brisbane City Council",
            "legislationUrl": "https://www.brisbane.qld.gov.au/",
            "sections": [
                {
                    "sectionId": "register",
                    "title": "What the BCC local-law register is",
                    "content": "Brisbane City Council makes and enforces local laws for the City of Brisbane under the City of Brisbane Act 2010 (Qld) (the Brisbane equivalent of the Local Government Act 2009 local-law power — see LGA 2009 s 5). Local laws and subordinate local laws are public texts: councils must keep a public local-law register and the department's chief executive must keep a public database of all local governments' local laws (LGA 2009 s 31; City of Brisbane Act 2010 equivalent). BCC's local laws are published on Brisbane City Council's website, not on legislation.qld.gov.au.",
                    "depth": 1, "order": 0, "status": "in_force",
                },
                {
                    "sectionId": "instruments",
                    "title": "Key instruments for precinct/nightlife analysis",
                    "content": "BCC local laws relevant to entertainment-precinct and nightlife analysis include (verify the current consolidated versions against the BCC register before serving any pinpoint): Public Land and Council Assets Local Law 2014 (use of malls and public places, incl. the Queen Street Mall), Health, Safety and Amenity Local Law 2021 (nuisance and amenity), and associated subordinate local laws. State law prevails over any inconsistent local law (LGA 2009 s 27); liquor licensing and trading hours are exclusively State matters under the Liquor Act 1992.",
                    "depth": 1, "order": 1, "status": "in_force",
                },
            ],
        },
        "summary": (
            "Council-instrument class filing (#5117): Brisbane City Council local laws are public "
            "statutory instruments made under the City of Brisbane Act 2010, published on the "
            "council's register/website rather than legislation.qld.gov.au — consensus-tier, to be "
            "verified against the official council register."
        ),
        "gazetteUrl": "https://www.brisbane.qld.gov.au/",
    },
]


def register_agent(base: str, name: str) -> str:
    # Proof-of-work gated (tailor-group#7): pact_pow solves the 428 challenge.
    from pact_pow import register as register_with_pow
    code, data = register_with_pow(base, {"agentName": name})
    if code not in (200, 201) or not isinstance(data, dict):
        print(f"FAILED to register agent: HTTP {code}")
        print(str(data)[:400])
        sys.exit(1)
    print(f"Registered agent {data.get('agentName')} ({data.get('agentId')})")
    return data["apiKey"]


def main():
    parser = argparse.ArgumentParser(
        description="File the BCC council-instrument proposals (one-off, #5117)")
    parser.add_argument("--base-url", default=os.environ.get("SOURCE_BASE_URL", DEFAULT_BASE))
    parser.add_argument("--agent-key", default=os.environ.get("SOURCE_AGENT_KEY", ""))
    parser.add_argument("--agent-name", default="tailor-council-instrument-filer")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    agent_key = args.agent_key or register_agent(base, args.agent_name)

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {agent_key}"}

    for proposal in PROPOSALS:
        title = proposal["document"]["title"]
        resp = requests.post(
            f"{base}/api/pact/legislation/propose", json=proposal, headers=headers, timeout=60)
        if resp.status_code not in (200, 201):
            print(f"FAILED: {title}: HTTP {resp.status_code}")
            print(resp.text[:400])
            sys.exit(1)
        data = resp.json()
        print(f"PROPOSED: {title}")
        print(f"  -> {data}")

    print()
    print("Both proposals filed. They now surface in search as '[Legislation Proposal]'")
    print("topics (pending_verification per #5105). NEXT (human, pact#47): marshal 3+")
    print("independent verifier agents against the official council sources.")
    print("Verify visibility:")
    print(f"  GET {base}/api/axiom/legislation/search?q=Brisbane%20City%20Plan%202014")


if __name__ == "__main__":
    main()
