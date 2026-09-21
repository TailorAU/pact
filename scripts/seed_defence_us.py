#!/usr/bin/env python3
"""#1137 — Seed US defence + export-control regulatory topics.

Seeds ~10 institutional-tier PACT topics covering the US frameworks that any
Australian critical-minerals or defence-industry supplier selling into the US
defence supply chain must navigate: ITAR, EAR, NEPA, BLM surface-management,
DFARS specialty-metals, California SMARA, DPA Title III, CFIUS, IRA critical-
minerals provisions and Buy American.

No admin secret required. Idempotent.
"""
from _defence_seed_helpers import seed_topic_batch  # noqa: E402


TOPICS: list[dict] = [
    {
        "title": "ITAR (22 CFR 120-130) governs the export of US defence articles and services",
        "content": (
            "The International Traffic in Arms Regulations (22 CFR 120-130) implement the Arms "
            "Export Control Act (22 USC 2778). ITAR controls the export, re-export, temporary "
            "import and brokering of items and technical data on the US Munitions List (USML). "
            "It is administered by the State Department's Directorate of Defense Trade Controls "
            "(DDTC). 'Deemed exports' — release of controlled technical data to a foreign person "
            "inside the US — are regulated the same as a physical export. Civil penalties exceed "
            "USD 1 million per violation; criminal penalties up to 20 years imprisonment. The "
            "AUKUS national-exemption pathway (22 CFR 126.7) is the principal Australian supplier "
            "channel for reduced licensing friction."
        ),
        "jurisdiction": "US",
        "authority": "US Department of State (Directorate of Defense Trade Controls)",
        "sourceRef": "International Traffic in Arms Regulations, 22 CFR 120-130; Arms Export Control Act, 22 USC 2778",
        "canonicalClaim": "ITAR (22 CFR 120-130) controls the export of US Munitions List defence articles, services and technical data",
    },
    {
        "title": "EAR (15 CFR 730-774) governs the export of US dual-use and commercial technology",
        "content": (
            "The Export Administration Regulations (15 CFR 730-774) implement the Export Control "
            "Reform Act of 2018 and control exports of commercial and dual-use items. The Commerce "
            "Control List (CCL, 15 CFR Part 774) is organised into ten categories mirroring the "
            "Wassenaar Arrangement. License requirements are determined by the Export Control "
            "Classification Number (ECCN), destination country (Country Chart), end-user (Entity "
            "List, Denied Persons) and end-use (military, WMD, space). Administered by the Bureau "
            "of Industry and Security (BIS) in the Commerce Department."
        ),
        "jurisdiction": "US",
        "authority": "US Department of Commerce (Bureau of Industry and Security)",
        "sourceRef": "Export Administration Regulations, 15 CFR 730-774; Export Control Reform Act of 2018, 50 USC 4801",
        "canonicalClaim": "EAR (15 CFR 730-774) controls US dual-use exports through ECCN classification on the Commerce Control List",
    },
    {
        "title": "NEPA (42 USC 4321+) requires environmental impact assessment for major federal actions",
        "content": (
            "The National Environmental Policy Act of 1969 (42 USC 4321 et seq) requires federal "
            "agencies to assess the environmental effects of proposed major federal actions prior "
            "to decisions. Actions 'significantly affecting the quality of the human environment' "
            "trigger preparation of an Environmental Impact Statement (EIS); lesser actions may "
            "require an Environmental Assessment (EA) or qualify for a Categorical Exclusion. "
            "Implementing regulations are at 40 CFR Parts 1500-1508 (CEQ) and agency-specific "
            "supplements. Mining projects on federal land nearly always require NEPA analysis as a "
            "prerequisite to BLM permit approval."
        ),
        "jurisdiction": "US",
        "authority": "US Council on Environmental Quality; federal action agencies",
        "sourceRef": "National Environmental Policy Act of 1969, 42 USC 4321 et seq; 40 CFR Parts 1500-1508",
        "canonicalClaim": "NEPA (42 USC 4321 et seq) requires an Environmental Impact Statement for major federal actions significantly affecting the human environment",
    },
    {
        "title": "BLM 43 CFR 3809 governs surface management of hardrock mining on federal land",
        "content": (
            "43 CFR Subpart 3809 establishes the Bureau of Land Management's surface-management "
            "program for locatable-mineral operations on BLM-administered public lands. Operators "
            "must file a Notice (for exploration disturbing <=5 acres) or a Plan of Operations "
            "(for larger or commercial operations). A Plan triggers NEPA review, financial-assurance "
            "bonding, reclamation standards, and Tribal consultation under the NHPA s 106. Applicable "
            "to virtually every US critical-minerals project on federal land — including antimony, "
            "lithium, rare earths and nickel operations in the western states."
        ),
        "jurisdiction": "US",
        "authority": "US Bureau of Land Management (Department of the Interior)",
        "sourceRef": "43 CFR Part 3809, Subparts 3809.1-3809.605 (Surface Management)",
        "canonicalClaim": "BLM 43 CFR 3809 requires an approved Plan of Operations for commercial hardrock mining on federal land",
    },
    {
        "title": "DFARS 252.225-7052 restricts DoD acquisition of non-domestic specialty metals including antimony",
        "content": (
            "DFARS clause 252.225-7052 (Restriction on the Acquisition of Certain Magnets and "
            "Tungsten / 252.225-7008 Specialty Metals, as progressively tightened) implements the "
            "statutory specialty-metals prohibition in 10 USC 4863 (formerly 10 USC 2533b). The "
            "clause prohibits DoD prime contractors from delivering end items containing specialty "
            "metals that were not melted or produced in the United States or a qualifying country, "
            "unless a domestic-non-availability determination applies. Antimony, tungsten, tantalum, "
            "samarium-cobalt and neodymium-iron-boron magnets are progressively being scoped into "
            "strict domestic-sourcing rules through FY23-FY25 NDAAs."
        ),
        "jurisdiction": "US",
        "authority": "US Department of Defense (Defense Acquisition Regulations System)",
        "sourceRef": "DFARS 252.225-7052; DFARS 252.225-7008; 10 USC 4863 (specialty metals)",
        "canonicalClaim": "The DFARS specialty-metals clause bars DoD end items containing specialty metals not melted or produced in the US or a qualifying country",
    },
    {
        "title": "California SMARA requires state permitting and reclamation for surface-mining operations",
        "content": (
            "The Surface Mining and Reclamation Act of 1975 (California Public Resources Code §§ "
            "2710-2796) requires every surface-mine operator in California to obtain a permit from "
            "the local lead agency, submit an approved Reclamation Plan and post financial "
            "assurance. Oversight by the State Geologist and the State Mining and Geology Board. "
            "The Mojave Desert critical-minerals corridor (San Bernardino County) sits under both "
            "SMARA (state) and BLM 3809 (federal), creating a concurrent dual-permit regime."
        ),
        "jurisdiction": "US-CA",
        "authority": "California Department of Conservation (Division of Mine Reclamation); State Mining and Geology Board",
        "sourceRef": "Surface Mining and Reclamation Act of 1975, California Public Resources Code §§ 2710-2796",
        "canonicalClaim": "California SMARA requires an approved reclamation plan and financial assurance for surface-mining operations",
    },
    {
        "title": "Defense Production Act Title III funds domestic industrial-base expansion for critical materials",
        "content": (
            "Title III of the Defense Production Act of 1950 (50 USC 4531-4533) authorises the "
            "President to incentivise expansion of US industrial capacity for materials, equipment "
            "and services essential to national defence. Instruments include purchase commitments, "
            "purchase guarantees and direct awards for plant expansion. Recent presidential "
            "determinations have invoked DPA Title III authority to accelerate domestic production "
            "of antimony, graphite, lithium, nickel, cobalt, manganese and rare earths — the inputs "
            "to US defence and clean-energy supply chains."
        ),
        "jurisdiction": "US",
        "authority": "Executive Office of the President; Department of Defense (Office of the Under Secretary for Acquisition and Sustainment)",
        "sourceRef": "Defense Production Act of 1950, Title III, 50 USC 4531-4533",
        "canonicalClaim": "DPA Title III (50 USC 4531-4533) authorises federal funding to expand domestic industrial capacity for defence-essential materials",
    },
    {
        "title": "CFIUS reviews foreign investment in US critical-technology and critical-minerals businesses",
        "content": (
            "The Committee on Foreign Investment in the United States (CFIUS), reformed by the "
            "Foreign Investment Risk Review Modernization Act of 2018 (FIRRMA), reviews covered "
            "transactions for national-security risk. Mandatory declarations apply to foreign "
            "acquisitions of US businesses dealing in critical technologies (aligned to the 'emerging "
            "and foundational technologies' regime), critical infrastructure, or sensitive personal "
            "data. Critical-minerals extraction and processing businesses on federal land fall "
            "squarely within covered real-estate and covered-control jurisdiction."
        ),
        "jurisdiction": "US",
        "authority": "US Department of the Treasury (chair of CFIUS); interagency committee",
        "sourceRef": "Section 721 of the Defense Production Act, 50 USC 4565; Foreign Investment Risk Review Modernization Act 2018",
        "canonicalClaim": "CFIUS reviews foreign acquisitions of US businesses in critical technology, critical infrastructure or sensitive personal data",
    },
    {
        "title": "Inflation Reduction Act ties clean-energy tax credits to critical-minerals sourcing requirements",
        "content": (
            "The Inflation Reduction Act of 2022 (IRA, Pub L 117-169) restructured the Section 30D "
            "clean-vehicle credit and created new advanced-manufacturing production credits (45X) "
            "and clean-energy tax credits (45, 45Y, 48, 48E). The 30D credit is conditional on the "
            "percentage of critical minerals in the battery that were extracted or processed in the "
            "United States or a country with which the US has a free-trade agreement — explicitly "
            "including Australia. Foreign-Entity-of-Concern (FEOC) rules (effective 2024) exclude "
            "vehicles with battery components or critical minerals sourced from Chinese, Russian, "
            "North Korean or Iranian entities."
        ),
        "jurisdiction": "US",
        "authority": "US Congress; Internal Revenue Service (Treasury)",
        "sourceRef": "Inflation Reduction Act of 2022, Pub L 117-169; Internal Revenue Code §§ 30D, 45X, 45, 45Y",
        "canonicalClaim": "The IRA conditions the IRC s 30D clean-vehicle credit on critical minerals sourced from the US or a free-trade-agreement partner",
    },
    {
        "title": "Buy American Act 1933 requires federal agencies to prefer domestic end products in procurement",
        "content": (
            "The Buy American Act of 1933 (41 USC 8301-8305) requires federal agencies to procure "
            "'domestic end products' — items manufactured in the US from components that are more "
            "than 60% domestic (rising to 75% by 2029 under the 2022 amendments) — absent an "
            "unreasonable-cost, non-availability or public-interest exception. Implemented via FAR "
            "Part 25 and DFARS Part 225. Works alongside the separate Berry Amendment (10 USC 4862) "
            "for textiles/food and the specialty-metals restriction (10 USC 4863)."
        ),
        "jurisdiction": "US",
        "authority": "US Congress; federal contracting agencies",
        "sourceRef": "Buy American Act, 41 USC 8301-8305; FAR Part 25; 2022 Executive Order 14005 domestic-content amendments",
        "canonicalClaim": "The Buy American Act 1933 (41 USC 8301-8305) requires federal agencies to prefer domestic end products in procurement",
    },
]


def main() -> None:
    result = seed_topic_batch("seed-us-def", TOPICS)
    ok = sum(1 for v in result.values() if v)
    print(f"\n=== seed_defence_us.py complete: {ok}/{len(TOPICS)} topics in place ===")


if __name__ == "__main__":
    main()
