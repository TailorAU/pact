#!/usr/bin/env python3
"""
Seed South Australian and Tasmanian legislation into Source's structured
legislation API.

This is a public-law top-up for Source coverage. It deliberately avoids
customer-specific scenarios and only ingests generic, official statutes that
industrial, resources, WHS, environmental-licence, and closure workflows can
query.

Usage:
    python scripts/seed_sa_tas_legislation.py [--base-url URL] [--admin-key KEY]

Defaults:
    --base-url https://source.tailor.au
    --admin-key (reads from ADMIN_SECRET env var)
"""

import argparse
import os
import sys

import requests


DEFAULT_BASE = "https://source.tailor.au"


SA_TAS_ACTS = [
    # ---------------------------------------------------------------------
    # SOUTH AUSTRALIA
    # ---------------------------------------------------------------------
    {
        "id": "sa/act-1993-076",
        "jurisdiction": "SA",
        "type": "act",
        "title": "Environment Protection Act 1993 (SA)",
        "shortTitle": "Environment Protection Act 1993",
        "year": 1993,
        "number": "Act No. 76 of 1993",
        "inForceDate": "1995-05-01",
        "lastAmendedDate": "2024-03-01",
        "administeredBy": "Environment Protection Authority South Australia",
        "legislationUrl": "https://www.legislation.sa.gov.au/LZ/C/A/ENVIRONMENT%20PROTECTION%20ACT%201993.aspx",
        "sections": [
            {
                "sectionId": "s 10",
                "title": "Objects of Act",
                "content": "The Act establishes South Australia's environmental protection framework, including ecologically sustainable development, protection and restoration of environmental values, and integrated pollution prevention and control.",
                "depth": 1,
                "order": 0,
                "status": "in_force",
            },
            {
                "sectionId": "s 25",
                "title": "General environmental duty",
                "content": "A person must not undertake an activity that pollutes, or might pollute, the environment unless the person takes all reasonable and practicable measures to prevent or minimise environmental harm.",
                "depth": 2,
                "order": 1,
                "parentSection": "Part 4 - General environmental duty",
                "status": "in_force",
                "crossReferences": ["s 10", "s 36"],
            },
            {
                "sectionId": "s 36",
                "title": "Requirement for licence",
                "content": "A person must hold an environmental authorisation, including a licence where required, before undertaking prescribed activities of environmental significance.",
                "depth": 2,
                "order": 2,
                "parentSection": "Part 6 - Environmental authorisations",
                "status": "in_force",
                "crossReferences": ["s 38", "s 40", "s 47"],
            },
            {
                "sectionId": "s 47",
                "title": "Criteria for grant and conditions of environmental authorisations",
                "content": "The Authority may grant an environmental authorisation subject to conditions directed to environmental protection, pollution control, monitoring, reporting, and compliance obligations.",
                "depth": 2,
                "order": 3,
                "parentSection": "Part 6 - Environmental authorisations",
                "status": "in_force",
                "crossReferences": ["s 36", "s 40"],
            },
            {
                "sectionId": "s 83A",
                "title": "Notification of site contamination of underground water",
                "content": "A person who becomes aware of site contamination affecting, or threatening, underground water must notify the Authority in accordance with the Act.",
                "depth": 2,
                "order": 4,
                "parentSection": "Part 10 - Miscellaneous environmental management",
                "status": "in_force",
                "crossReferences": ["s 103D", "s 103I"],
            },
            {
                "sectionId": "s 103D",
                "title": "Causing site contamination",
                "content": "The site-contamination provisions allocate responsibility for contamination and support assessment, remediation, and audit controls for contaminated land.",
                "depth": 2,
                "order": 5,
                "parentSection": "Part 10A - Site contamination",
                "status": "in_force",
                "crossReferences": ["s 83A", "s 103I", "s 103P"],
            },
        ],
    },
    {
        "id": "sa/act-2012-040",
        "jurisdiction": "SA",
        "type": "act",
        "title": "Work Health and Safety Act 2012 (SA)",
        "shortTitle": "WHS Act 2012 (SA)",
        "year": 2012,
        "number": "Act No. 40 of 2012",
        "inForceDate": "2013-01-01",
        "lastAmendedDate": "2024-10-01",
        "administeredBy": "SafeWork SA",
        "legislationUrl": "https://www.legislation.sa.gov.au/LZ/C/A/WORK%20HEALTH%20AND%20SAFETY%20ACT%202012.aspx",
        "sections": [
            {
                "sectionId": "s 3",
                "title": "Object",
                "content": "The Act provides a nationally consistent framework to secure the health and safety of workers and workplaces by eliminating or minimising risks arising from work.",
                "depth": 1,
                "order": 0,
                "status": "in_force",
            },
            {
                "sectionId": "s 19",
                "title": "Primary duty of care",
                "content": "A person conducting a business or undertaking must ensure, so far as is reasonably practicable, the health and safety of workers and other persons affected by the work.",
                "depth": 2,
                "order": 1,
                "parentSection": "Part 2 - Health and safety duties",
                "status": "in_force",
                "crossReferences": ["s 27", "s 28"],
            },
            {
                "sectionId": "s 27",
                "title": "Duty of officers",
                "content": "An officer of a person conducting a business or undertaking must exercise due diligence to ensure the person complies with WHS duties and obligations.",
                "depth": 2,
                "order": 2,
                "parentSection": "Part 2 - Health and safety duties",
                "status": "in_force",
                "crossReferences": ["s 19"],
            },
            {
                "sectionId": "s 38",
                "title": "Duty to notify of notifiable incidents",
                "content": "A PCBU must ensure the regulator is notified immediately after becoming aware that a notifiable incident arising out of the conduct of the business or undertaking has occurred.",
                "depth": 2,
                "order": 3,
                "parentSection": "Part 3 - Incident notification",
                "status": "in_force",
                "crossReferences": ["s 35", "s 37", "s 39"],
            },
            {
                "sectionId": "s 46",
                "title": "Duty to consult with other duty holders",
                "content": "If more than one person has a duty in relation to the same matter, each duty holder must, so far as is reasonably practicable, consult, cooperate, and coordinate activities with the others.",
                "depth": 2,
                "order": 4,
                "parentSection": "Part 5 - Consultation, representation and participation",
                "status": "in_force",
                "crossReferences": ["s 47"],
            },
            {
                "sectionId": "s 47",
                "title": "Duty to consult workers",
                "content": "A PCBU must, so far as is reasonably practicable, consult with workers who are, or are likely to be, directly affected by WHS matters.",
                "depth": 2,
                "order": 5,
                "parentSection": "Part 5 - Consultation, representation and participation",
                "status": "in_force",
                "crossReferences": ["s 46", "s 48", "s 49"],
            },
        ],
    },
    {
        "id": "sa/act-1971-109",
        "jurisdiction": "SA",
        "type": "act",
        "title": "Mining Act 1971 (SA)",
        "shortTitle": "Mining Act 1971",
        "year": 1971,
        "number": "Act No. 109 of 1971",
        "inForceDate": "1972-07-03",
        "lastAmendedDate": "2024-01-01",
        "administeredBy": "Department for Energy and Mining South Australia",
        "legislationUrl": "https://www.legislation.sa.gov.au/LZ/C/A/MINING%20ACT%201971.aspx",
        "sections": [
            {
                "sectionId": "s 17",
                "title": "Royalty",
                "content": "Royalty is payable to the Crown on minerals recovered from land in South Australia, subject to the royalty assessment principles and any applicable exemptions or reductions.",
                "depth": 2,
                "order": 0,
                "parentSection": "Part 3 - Reservation of minerals and royalty",
                "status": "in_force",
            },
            {
                "sectionId": "s 28",
                "title": "Grant of exploration licence",
                "content": "The Minister may grant an exploration licence authorising exploration for minerals subject to the Act, licence conditions, land-access requirements, and environmental controls.",
                "depth": 2,
                "order": 1,
                "parentSection": "Part 5 - Exploration licences",
                "status": "in_force",
                "crossReferences": ["s 29", "s 70A"],
            },
            {
                "sectionId": "s 34",
                "title": "Grant of mining lease",
                "content": "A mining lease is the principal tenure for mining operations and may be granted subject to terms, conditions, programs, and regulatory requirements under the Act.",
                "depth": 2,
                "order": 2,
                "parentSection": "Part 6 - Mining leases",
                "status": "in_force",
                "crossReferences": ["s 38", "s 70A"],
            },
            {
                "sectionId": "s 70A",
                "title": "Object of programs for environment protection and rehabilitation",
                "content": "The Act requires programs for environment protection and rehabilitation so mining operations are planned, conducted, rehabilitated, and closed with environmental impacts managed.",
                "depth": 2,
                "order": 3,
                "parentSection": "Part 10A - Programs for environment protection and rehabilitation",
                "status": "in_force",
                "crossReferences": ["s 70E", "s 70F"],
            },
            {
                "sectionId": "s 70E",
                "title": "Direction to prevent or minimise environmental damage",
                "content": "The Minister may direct a tenement holder to take action to prevent or minimise environmental damage associated with mining operations.",
                "depth": 2,
                "order": 4,
                "parentSection": "Part 10B - Environmental protection",
                "status": "in_force",
                "crossReferences": ["s 70F", "s 73H"],
            },
            {
                "sectionId": "s 73H",
                "title": "General duty to avoid undue environmental damage",
                "content": "A person undertaking authorised mining operations must avoid undue environmental damage and comply with applicable environmental and rehabilitation obligations.",
                "depth": 2,
                "order": 5,
                "parentSection": "Part 10B - Environmental protection",
                "status": "in_force",
                "crossReferences": ["s 70A", "s 70E", "s 70F"],
            },
        ],
    },
    # ---------------------------------------------------------------------
    # TASMANIA
    # ---------------------------------------------------------------------
    {
        "id": "tas/act-1994-044",
        "jurisdiction": "TAS",
        "type": "act",
        "title": "Environmental Management and Pollution Control Act 1994 (Tas)",
        "shortTitle": "EMPCA 1994",
        "year": 1994,
        "number": "Act No. 44 of 1994",
        "inForceDate": "1996-01-01",
        "lastAmendedDate": "2026-04-16",
        "administeredBy": "Environment Protection Authority Tasmania",
        "legislationUrl": "https://www.legislation.tas.gov.au/view/html/inforce/current/act-1994-044",
        "sections": [
            {
                "sectionId": "s 5",
                "title": "Environmental harm",
                "content": "Environmental harm is an adverse effect on the environment and may be classified as serious environmental harm or material environmental harm depending on severity, cost, and consequences.",
                "depth": 2,
                "order": 0,
                "status": "in_force",
                "crossReferences": ["s 6", "s 8"],
            },
            {
                "sectionId": "s 6",
                "title": "Responsibility for pollution",
                "content": "A person who causes or permits pollution may be responsible for resulting environmental harm, including harm caused directly or indirectly by the pollution.",
                "depth": 2,
                "order": 1,
                "status": "in_force",
                "crossReferences": ["s 5", "s 44"],
            },
            {
                "sectionId": "s 8",
                "title": "Objectives to be furthered",
                "content": "Decision-makers must further the objectives of environmental management and pollution control, including sustainable development, pollution prevention, waste minimisation, and protection of environmental values.",
                "depth": 2,
                "order": 2,
                "status": "in_force",
                "crossReferences": ["s 5"],
            },
            {
                "sectionId": "s 25",
                "title": "Assessment of level 2 activities",
                "content": "Activities that may cause environmental harm can be referred for assessment by the Board, integrating environmental impact assessment with planning and approval processes.",
                "depth": 2,
                "order": 3,
                "parentSection": "Part 3 - Environmental impact assessment",
                "status": "in_force",
                "crossReferences": ["s 27", "s 27A"],
            },
            {
                "sectionId": "s 27A",
                "title": "Classes of assessment",
                "content": "The Board determines the class of environmental assessment for an activity, with assessment class driving information requirements, public consultation, and decision timeframes.",
                "depth": 2,
                "order": 4,
                "parentSection": "Part 3 - Environmental impact assessment",
                "status": "in_force",
                "crossReferences": ["s 25", "s 27C", "s 27H"],
            },
            {
                "sectionId": "s 44",
                "title": "Environment protection notices",
                "content": "An environment protection notice can require a person to take measures to prevent, control, reduce, or remediate environmental harm or nuisance.",
                "depth": 2,
                "order": 5,
                "parentSection": "Part 4 - Environmental protection notices",
                "status": "in_force",
                "crossReferences": ["s 5", "s 6"],
            },
        ],
    },
    {
        "id": "tas/act-2012-001",
        "jurisdiction": "TAS",
        "type": "act",
        "title": "Work Health and Safety Act 2012 (Tas)",
        "shortTitle": "WHS Act 2012 (Tas)",
        "year": 2012,
        "number": "Act No. 1 of 2012",
        "inForceDate": "2013-01-01",
        "lastAmendedDate": "2025-07-01",
        "administeredBy": "WorkSafe Tasmania",
        "legislationUrl": "https://www.legislation.tas.gov.au/view/html/inforce/current/act-2012-001",
        "sections": [
            {
                "sectionId": "s 3",
                "title": "Object",
                "content": "The Act provides a nationally consistent framework to secure worker health and safety by eliminating or minimising risks from work and providing consultation, representation, and compliance mechanisms.",
                "depth": 1,
                "order": 0,
                "status": "in_force",
            },
            {
                "sectionId": "s 19",
                "title": "Primary duty of care",
                "content": "A PCBU must ensure, so far as is reasonably practicable, the health and safety of workers and other persons affected by the work.",
                "depth": 2,
                "order": 1,
                "parentSection": "Part 2 - Health and safety duties",
                "status": "in_force",
                "crossReferences": ["s 27", "s 28"],
            },
            {
                "sectionId": "s 27",
                "title": "Duty of officers",
                "content": "An officer must exercise due diligence to ensure the PCBU complies with WHS duties, including processes for hazards, incidents, resources, training, and compliance verification.",
                "depth": 2,
                "order": 2,
                "parentSection": "Part 2 - Health and safety duties",
                "status": "in_force",
                "crossReferences": ["s 19"],
            },
            {
                "sectionId": "s 38",
                "title": "Duty to notify of notifiable incidents",
                "content": "A PCBU must ensure the regulator is notified immediately after becoming aware of a notifiable incident arising out of the conduct of the business or undertaking.",
                "depth": 2,
                "order": 3,
                "parentSection": "Part 3 - Incident notification",
                "status": "in_force",
                "crossReferences": ["s 35", "s 37", "s 39"],
            },
            {
                "sectionId": "s 46",
                "title": "Duty to consult with other duty holders",
                "content": "Where multiple duty holders have duties in relation to the same matter, each must consult, cooperate, and coordinate activities so far as reasonably practicable.",
                "depth": 2,
                "order": 4,
                "parentSection": "Part 5 - Consultation, representation and participation",
                "status": "in_force",
                "crossReferences": ["s 47"],
            },
            {
                "sectionId": "s 47",
                "title": "Duty to consult workers",
                "content": "A PCBU must consult with workers who are, or are likely to be, directly affected by work health and safety matters.",
                "depth": 2,
                "order": 5,
                "parentSection": "Part 5 - Consultation, representation and participation",
                "status": "in_force",
                "crossReferences": ["s 46", "s 48", "s 49"],
            },
        ],
    },
    {
        "id": "tas/act-1995-116",
        "jurisdiction": "TAS",
        "type": "act",
        "title": "Mineral Resources Development Act 1995 (Tas)",
        "shortTitle": "MRDA 1995",
        "year": 1995,
        "number": "Act No. 116 of 1995",
        "inForceDate": "1996-07-01",
        "lastAmendedDate": "2026-03-04",
        "administeredBy": "Mineral Resources Tasmania",
        "legislationUrl": "https://www.legislation.tas.gov.au/view/html/inforce/current/act-1995-116",
        "sections": [
            {
                "sectionId": "s 5",
                "title": "Application of Act",
                "content": "The Act applies to minerals and mineral resources in Tasmania, subject to specified exclusions and exemptions.",
                "depth": 2,
                "order": 0,
                "status": "in_force",
            },
            {
                "sectionId": "s 11",
                "title": "Application for exploration licence",
                "content": "A person may apply to the Minister for an exploration licence, including information about the proposed exploration program and likely environmental impacts.",
                "depth": 2,
                "order": 1,
                "parentSection": "Part 2 - Exploration licences",
                "status": "in_force",
                "crossReferences": ["s 17", "s 18"],
            },
            {
                "sectionId": "s 17",
                "title": "Granting application for exploration licence",
                "content": "The Minister may grant an exploration licence after considering the application, objections, applicant capacity, and whether sufficient information has been provided about likely environmental impacts.",
                "depth": 2,
                "order": 2,
                "parentSection": "Part 2 - Exploration licences",
                "status": "in_force",
                "crossReferences": ["s 11", "s 18"],
            },
            {
                "sectionId": "s 29",
                "title": "Duties under exploration licence",
                "content": "The holder of an exploration licence must comply with licence conditions, work program obligations, reporting requirements, and rehabilitation standards specified in relevant codes of practice.",
                "depth": 2,
                "order": 3,
                "parentSection": "Part 2 - Exploration licences",
                "status": "in_force",
                "crossReferences": ["s 18"],
            },
            {
                "sectionId": "s 60",
                "title": "Application for mining lease",
                "content": "A mining lease application must provide information about the mineral, land, proposed development, environmental risks, and rehabilitation relevant to the proposed mining operation.",
                "depth": 2,
                "order": 4,
                "parentSection": "Part 4 - Mining leases",
                "status": "in_force",
                "crossReferences": ["s 70", "s 78"],
            },
            {
                "sectionId": "s 78",
                "title": "Conditions of mining lease",
                "content": "A mining lease may be subject to conditions, including conditions addressing work programs, environmental management, reporting, rehabilitation, and compliance with relevant codes.",
                "depth": 2,
                "order": 5,
                "parentSection": "Part 4 - Mining leases",
                "status": "in_force",
                "crossReferences": ["s 60", "s 84"],
            },
        ],
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed SA and TAS legislation into Source")
    parser.add_argument("--base-url", default=os.environ.get("SOURCE_BASE_URL", DEFAULT_BASE))
    parser.add_argument("--admin-key", default=os.environ.get("ADMIN_SECRET", ""))
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    admin_key = args.admin_key
    if not admin_key:
        print("ERROR: No admin key provided. Set ADMIN_SECRET env var or use --admin-key")
        return 1

    print(f"Seeding {len(SA_TAS_ACTS)} SA/TAS legislation documents to {base}")
    print(f"Total sections: {sum(len(a.get('sections', [])) for a in SA_TAS_ACTS)}")

    response = requests.post(
        f"{base}/api/axiom/legislation/ingest",
        json={"documents": SA_TAS_ACTS},
        headers={"Content-Type": "application/json", "X-Admin-Key": admin_key},
        timeout=60,
    )
    if response.status_code != 200:
        print(f"FAILED: HTTP {response.status_code}")
        print(response.text[:500])
        return 1

    data = response.json()
    print(f"SUCCESS: Ingested {data['ingested']} documents")
    for doc in data.get("documents", []):
        print(f"  {doc['id']:28s} {doc['sectionsInserted']:3d} sections  {doc['title']}")

    print()
    print("API endpoints now available:")
    print(f"  GET {base}/api/axiom/legislation?jurisdiction=SA")
    print(f"  GET {base}/api/axiom/legislation?jurisdiction=TAS")
    print(f"  GET {base}/api/axiom/legislation/search?q=environmental+licence&jurisdiction=SA")
    print(f"  GET {base}/api/axiom/legislation/search?q=environmental+harm&jurisdiction=TAS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
