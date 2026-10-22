#!/usr/bin/env python3
"""
Seed the Local Government Act 2009 (Qld) into PACT's Structured Legislation
API. Refs #5117 (child of epic #5114, cold-eye review remediation finding 4 —
public-statute coverage; sibling of the #5091 Liquor Act seed).

The Local Government Act 2009 is the framework statute for Queensland local
government competence: what a council is, the general-competence power, the
local-law making machinery, and the State-law supremacy rule (s 27). It is
load-bearing for any council-facing gap analysis (BCC nightlife-economy
story) because it defines WHAT a council can and cannot regulate.

CRITICAL ACCURACY NOTE (s 5): Brisbane City Council is principally governed
by the City of Brisbane Act 2010 (Qld), NOT this Act — LGA 2009 s 5 says so
in terms. The seed carries that section so the knowledge graph never implies
LGA 2009 alone constitutes or empowers BCC.

Ingestion path (per the #5091/#5117 triage comments): the established
CURATED-SEED pattern used for every QLD act already in the graph — a POST to
the admin `/api/axiom/legislation/ingest` endpoint. It deliberately does NOT
ride the QLD Legislation API live-fetch machinery (`api.legislation.qld.gov.au`),
which is broken and tracked separately in #2901.

Provenance: section numbering, titles and content were verified on
2026-08-12 against the official in-force reprint on
www.legislation.qld.gov.au (whole-view HTML for `act-2009-017`). Content is
summarised for agent consumption (not full gazette text), same convention as
the other curated legislation seeds.

Council-made instruments (Brisbane City Plan 2014, BCC local laws) are NOT
seeded here — they are consensus-tier (official council sources, PACT
propose flow). See `propose_bcc_council_instruments.py` and the
"Council-instrument class" section of sites/source/README.md.

Usage:
    python scripts/seed_qld_lga_legislation.py [--base-url URL] [--admin-key KEY]

Defaults:
    --base-url https://pact.tailor.au
    --admin-key (reads from ADMIN_SECRET env var)

Idempotent: the ingest endpoint upserts documents and delete-reinserts
sections, so re-running (e.g. on every cd-source deploy) is safe.
"""

import requests
import os
import sys
import argparse

# ── Configuration ──────────────────────────────────────────────────
DEFAULT_BASE = "https://pact.tailor.au"

# ── LGA 2009 data ──────────────────────────────────────────────────
# Verified against the legislation.qld.gov.au in-force reprint (2026-08-12).

LGA_DOCS = [
    {
        "id": "qld/act-2009-017",
        "jurisdiction": "QLD",
        "type": "act",
        "title": "Local Government Act 2009 (Qld)",
        "shortTitle": "Local Government Act 2009",
        "year": 2009,
        "number": "Act No. 17 of 2009",
        "administeredBy": "Department of Local Government, Water and Volunteers",
        "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-2009-017",
        "sections": [
            {"sectionId": "s 3", "title": "Purpose of this Act", "content": "The purpose of this Act is to provide for — (a) the way in which a local government is constituted and the nature and extent of its responsibilities and powers; and (b) a system of local government in Queensland that is accountable, effective, efficient and sustainable. The system of local government consists of a number of local governments (see Constitution of Queensland 2001, s 70).", "depth": 1, "order": 0, "parentSection": "Chapter 1 — Preliminary", "status": "in_force", "crossReferences": ["s 4", "s 5"]},
            {"sectionId": "s 4", "title": "Local government principles underpin this Act", "content": "Anyone performing a responsibility under this Act must do so in accordance with the local government principles, and any action taken under this Act must be consistent with them. The local government principles are — (a) transparent and effective processes, and decision-making in the public interest; (b) sustainable development and management of assets and infrastructure, and delivery of effective services; (c) democratic representation, social inclusion and meaningful community engagement; (d) good governance of, and by, local government; and (e) ethical and legal behaviour of councillors, local government employees and councillor advisors.", "depth": 2, "order": 1, "parentSection": "Chapter 1 — Preliminary", "status": "in_force", "crossReferences": ["s 3"]},
            {"sectionId": "s 5", "title": "Relationship with City of Brisbane Act 2010", "content": "Although the Brisbane City Council is a local government, the City of Brisbane Act 2010 — rather than this Act — provides for (a) the way in which the Brisbane City Council is constituted and the nature and extent of its responsibilities and powers, and (b) a system of local government in Brisbane. Any analysis of Brisbane City Council competence must therefore anchor to the City of Brisbane Act 2010 (which substantially mirrors this Act, including an equivalent local-law power); the Local Government Act 2009 applies to Brisbane only where expressly provided.", "depth": 2, "order": 2, "parentSection": "Chapter 1 — Preliminary", "status": "in_force", "crossReferences": ["s 3", "s 8"]},
            {"sectionId": "s 8", "title": "Local government's responsibility for local government areas", "content": "A local government is an elected body that is responsible for the good rule and local government of a part of Queensland (provided for in the Constitution of Queensland 2001, s 71). A part of Queensland governed by a local government is a local government area, which may be divided into divisions. The Brisbane City Council is the local government for the City of Brisbane — for its local government area see the City of Brisbane Act 2010, s 7. A regulation may describe area boundaries, fix councillor numbers, name areas, and classify an area as a city, town, shire or region.", "depth": 2, "order": 3, "parentSection": "Chapter 2 — Local governments", "status": "in_force", "crossReferences": ["s 5", "s 9"]},
            {"sectionId": "s 9", "title": "Powers of local governments generally", "content": "A local government has the power to do anything that is necessary or convenient for the good rule and local government of its local government area (the general competence power; see also s 262). HOWEVER, a local government can only do something that the State can validly do — and where a State law occupies a field (e.g. liquor licensing and trading hours under the Liquor Act 1992, administered by the Commissioner for Liquor and Gaming), the council's competence is correspondingly limited (see also s 27 on inconsistency). A local government may exercise its powers inside its area, or outside it with the written approval of the Minister (or under s 10(5)).", "depth": 2, "order": 4, "parentSection": "Chapter 2 — Local governments", "status": "in_force", "crossReferences": ["s 27", "s 262", "Liquor Act 1992 s 9"]},
            {"sectionId": "s 26", "title": "What this part is about (local laws)", "content": "Chapter 3, Part 1 is about local laws. A local law is a law made by a local government. Unless a contrary intention appears, a reference to a local law includes an interim local law (effect for 6 months or less), a subordinate local law (made under a power contained in a local law, providing for its detailed implementation — the local law prevails over it to the extent of any inconsistency), and a local law that incorporates a model local law (a local law the Minister approves by gazette notice as suitable for incorporation by all local governments).", "depth": 2, "order": 10, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 27", "s 28"]},
            {"sectionId": "s 27", "title": "Interaction with State laws", "content": "If there is any inconsistency between a local law and a law made by the State, the law made by the State prevails to the extent of the inconsistency. This is the supremacy rule that bounds council regulatory competence: a local law cannot override State instruments such as the Liquor Act 1992 or the Planning Act 2016.", "depth": 2, "order": 11, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 9", "s 28"]},
            {"sectionId": "s 28", "title": "Power to make a local law", "content": "A local government may make and enforce any local law that is necessary or convenient for the good rule and local government of its local government area. However, a local government must not make a local law that sets a penalty of more than 850 penalty units for each conviction of failing to comply with a local law; that purports to stop a local law being amended or repealed in the future; or about a subject prohibited under division 3. (For Brisbane City Council the equivalent power is conferred by the City of Brisbane Act 2010 — see s 5.)", "depth": 2, "order": 12, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 5", "s 26", "s 29", "s 38"]},
            {"sectionId": "s 29", "title": "Local law making process", "content": "A local government may decide its own process for making a local law to the extent the process is not inconsistent with this part, and makes a local law by passing a resolution. If a proposed new local law would be inconsistent with an existing local law on the same matter, the existing law must be amended or repealed so there is no inconsistency. An interim local law must state when it expires. Local laws must be drafted in compliance with the Parliamentary Counsel's guidelines under the Legislative Standards Act 1992, s 9. No public consultation is required before making an interim local law, or a local law that only incorporates a model local law and contains no anti-competitive provision.", "depth": 2, "order": 13, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 28", "s 29A", "s 29B"]},
            {"sectionId": "s 29A", "title": "State interest check", "content": "Before making a local law (other than one that only incorporates a model local law, or a subordinate local law), a local government must consult with relevant government entities about the overall State interest in the proposed local law.", "depth": 2, "order": 14, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 29"]},
            {"sectionId": "s 29B", "title": "Publication of local laws", "content": "A local government must let the public know a local law has been made by publishing a notice in the gazette and on the local government's website within 1 month after the resolution. The website notice must state (among other things) the local law's name, purpose and general effect, whether it incorporates a model local law, is interim (and its expiry), is subordinate (and its authorising local law), and whether it contains an anti-competitive provision.", "depth": 2, "order": 15, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 29", "s 31"]},
            {"sectionId": "s 31", "title": "Local law register", "content": "A local government must keep a register of its local laws, in the way required under a regulation, and the public may inspect the register at the local government's public office. The department's chief executive must keep a database of ALL local governments' local laws and ensure a copy may be viewed by the public on its website. This section is why council local laws are public texts even though they are not published on legislation.qld.gov.au: the authoritative sources are the council's own register/website and the department's local-law database.", "depth": 2, "order": 16, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 29B"]},
            {"sectionId": "s 38", "title": "Anti-competitive provisions", "content": "A local government must not make a local law containing an anti-competitive provision unless it has complied with the procedures prescribed under a regulation for the review of anti-competitive provisions. A local law is of no effect to the extent it is contrary to this section. Does not apply to an interim local law.", "depth": 2, "order": 17, "parentSection": "Chapter 3, Part 1 — Local laws", "status": "in_force", "crossReferences": ["s 28"]},
            {"sectionId": "s 60", "title": "Control of roads", "content": "A local government has control of all roads in its local government area, including the ability to construct, maintain and improve roads; approve naming/numbering; make a local law to regulate the use of roads — including the movement of traffic and the parking of vehicles subject to the Transport Operations (Road Use Management) Act 1995; make a local law to regulate public utilities and ancillary works along, in, over or under roads; realign roads; and acquire land for use as a road. Relevant to nightlife/entertainment-precinct analysis: footpath dining, busking and street activity on roads are regulable by council local law within these bounds.", "depth": 2, "order": 20, "parentSection": "Chapter 3, Part 3 — Roads and other infrastructure", "status": "in_force", "crossReferences": ["s 28"]},
            {"sectionId": "s 262", "title": "Powers in support of responsibilities", "content": "If a local government is required or empowered to perform a responsibility under a Local Government Act, it has the power to do anything necessary or convenient for performing the responsibility, including all the powers of an individual — for example the power to enter into contracts; acquire, hold, deal with and dispose of property; and charge for a service or facility (other than one for which a cost-recovery fee may be fixed).", "depth": 2, "order": 30, "parentSection": "Chapter 7 — Other provisions", "status": "in_force", "crossReferences": ["s 9"]},
        ],
    },
]


def main():
    parser = argparse.ArgumentParser(description="Seed the Local Government Act 2009 (Qld) into PACT")
    parser.add_argument("--base-url", default=os.environ.get("SOURCE_BASE_URL", DEFAULT_BASE))
    parser.add_argument("--admin-key", default=os.environ.get("ADMIN_SECRET", ""))
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    admin_key = args.admin_key

    if not admin_key:
        print("ERROR: No admin key provided. Set ADMIN_SECRET env var or use --admin-key")
        sys.exit(1)

    print(f"Seeding {len(LGA_DOCS)} QLD local-government legislation documents to {base}")
    print(f"Total sections: {sum(len(d.get('sections', [])) for d in LGA_DOCS)}")
    print()

    url = f"{base}/api/axiom/legislation/ingest"
    headers = {
        "Content-Type": "application/json",
        "X-Admin-Key": admin_key,
    }

    resp = requests.post(url, json={"documents": LGA_DOCS}, headers=headers, timeout=60)

    if resp.status_code != 200:
        print(f"FAILED: HTTP {resp.status_code}")
        print(resp.text[:500])
        sys.exit(1)

    data = resp.json()
    print(f"SUCCESS: Ingested {data['ingested']} documents")
    for doc in data.get("documents", []):
        print(f"  {doc['id']:24s}  {doc['sectionsInserted']:3d} sections  {doc['title']}")

    print()
    print(f"Total sections ingested: {sum(d['sectionsInserted'] for d in data.get('documents', []))}")
    print()
    print("Verify:")
    print(f"  GET {base}/api/axiom/legislation/search?q=Local%20Government%20Act%202009")
    print(f"  GET {base}/api/axiom/legislation/qld%2Fact-2009-017?section=s%205&format=text")
    print(f"  GET {base}/api/axiom/legislation/qld%2Fact-2009-017?section=s%2028&format=text")


if __name__ == "__main__":
    main()
