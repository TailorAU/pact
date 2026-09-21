#!/usr/bin/env python3
"""#1137 — Seed AU defence + export-control regulatory topics.

Seeds ~12 institutional-tier PACT topics covering the primary AU defence-industry
regulatory regime: export controls (DTCA + DSGL), security framework (DISP),
foreign-investment triggers (FIRB critical-tech), ASX continuous-disclosure +
resource-reporting standards, and the surrounding sanctions / counter-proliferation
legislation.

No admin secret required — goes through POST /api/pact/topics. Idempotent: a
second run creates zero new rows.

Usage:
    python seed_defence_au.py                         # targets https://source.tailor.au
    SOURCE_BASE=http://localhost:3001 python seed_defence_au.py   # dev
"""
from _defence_seed_helpers import DRY_RUN, seed_topic_batch  # noqa: E402


TOPICS: list[dict] = [
    {
        "title": "Defence Trade Controls Act 2012 (Cth) regulates export of controlled military and dual-use technology",
        "content": (
            "The Defence Trade Controls Act 2012 (Cth) (DTCA) is the primary Australian statute "
            "governing the supply, brokering and publication of goods, software and technology "
            "listed on the Defence and Strategic Goods List (DSGL). Exports of DSGL items without "
            "a permit from the Minister for Defence carry criminal penalties of up to 10 years "
            "imprisonment. The DTCA complements the Customs Act 1901 (Cth) prohibited exports regime "
            "and aligns Australia with the Wassenaar Arrangement, MTCR, NSG and Australia Group."
        ),
        "jurisdiction": "AU",
        "authority": "Commonwealth Parliament of Australia",
        "sourceRef": "Defence Trade Controls Act 2012 (Cth), Act No. 153 of 2012",
        "canonicalClaim": "The Defence Trade Controls Act 2012 (Cth) requires a permit for the supply of DSGL-listed technology out of Australia",
    },
    {
        "title": "Defence and Strategic Goods List (DSGL) enumerates export-controlled goods and technology",
        "content": (
            "The Defence and Strategic Goods List is the controlled-goods schedule referenced by "
            "both the Customs (Prohibited Exports) Regulations 1958 and the Defence Trade Controls "
            "Act 2012. It is maintained by the Department of Defence and updated in alignment with "
            "the four multilateral export-control regimes. Part 1 covers munitions (defence articles); "
            "Part 2 covers dual-use goods — chemicals, microorganisms, electronics, computers, "
            "telecommunications, information security, sensors and lasers, navigation and avionics, "
            "marine, aerospace and propulsion."
        ),
        "jurisdiction": "AU",
        "authority": "Department of Defence (Defence Export Controls)",
        "sourceRef": "Defence and Strategic Goods List (current edition), made under the Customs Act 1901 (Cth) and DTCA 2012",
        "canonicalClaim": "The Defence and Strategic Goods List enumerates the goods and technology whose export from Australia requires a permit",
    },
    {
        "title": "Defence Industry Security Program (DISP) is required for access to classified Defence contracts",
        "content": (
            "DISP is administered by the Defence Industry Security Office. It provides four "
            "membership levels (Entry to Level 3) covering governance, personnel, physical, ICT "
            "and information-security controls aligned with the PSPF, ISM and Defence Security "
            "Principles Framework. Suppliers handling OFFICIAL:Sensitive or classified Defence "
            "information, or working in Defence security zones, must be DISP-accredited. Membership "
            "is a common prime-contract flow-down clause."
        ),
        "jurisdiction": "AU",
        "authority": "Department of Defence (Defence Industry Security Office)",
        "sourceRef": "Defence Industry Security Program — DISP Member Handbook (current edition)",
        "canonicalClaim": "DISP membership is the minimum security accreditation for industry access to classified Defence information and contracts",
    },
    {
        "title": "FIRB critical-technologies list triggers mandatory foreign-investment notification",
        "content": (
            "Under the Foreign Acquisitions and Takeovers Act 1975 (Cth) as amended by the 2020 "
            "national-security reforms, any acquisition in a 'national security business' — including "
            "businesses that develop, manufacture or supply critical technologies on the Government's "
            "List of Critical Technologies in the National Interest — requires notification to FIRB "
            "regardless of the investment value. Critical-minerals extraction and processing, advanced "
            "materials and manufacturing (including antimony), and quantum/semiconductor technology are "
            "on the list."
        ),
        "jurisdiction": "AU",
        "authority": "Foreign Investment Review Board (Treasury)",
        "sourceRef": "Foreign Acquisitions and Takeovers Act 1975 (Cth) s 55B; List of Critical Technologies in the National Interest (2023)",
        "canonicalClaim": "Acquiring an Australian business in a listed critical-technology sector requires FIRB notification under FATA s 55B regardless of value",
    },
    {
        "title": "ASX Listing Rule 3.1 requires immediate disclosure of price-sensitive information",
        "content": (
            "ASX Listing Rule 3.1 obliges every listed entity to immediately disclose to ASX any "
            "information concerning it that a reasonable person would expect to have a material "
            "effect on the price or value of its securities, subject only to the limited exceptions "
            "in Rule 3.1A (information that is incomplete or confidential, for which breach of "
            "confidence would be unlawful, and that a reasonable person would not expect to be "
            "disclosed). Breach exposes directors to personal liability under ss 180-181 Corporations "
            "Act 2001 (Cth) and to ASIC enforcement under s 674."
        ),
        "jurisdiction": "AU",
        "authority": "ASX Limited (with statutory backing via Corporations Act s 674)",
        "sourceRef": "ASX Listing Rules Chapter 3, Rule 3.1 (continuous disclosure); Corporations Act 2001 (Cth) s 674",
        "canonicalClaim": "ASX Listing Rules require immediate disclosure of information a reasonable person would expect to materially affect a security's price",
    },
    {
        "title": "JORC Code 2012 governs public reporting of mineral exploration results, resources and reserves",
        "content": (
            "The Australasian Code for Reporting of Exploration Results, Mineral Resources and Ore "
            "Reserves (JORC Code 2012) is the minimum standard for public reporting by ASX-listed "
            "mining and exploration companies. It is incorporated into ASX Listing Rule 5.6 and "
            "requires reports be signed off by a named Competent Person with minimum five years "
            "of relevant experience. It classifies Mineral Resources as Inferred / Indicated / "
            "Measured and Ore Reserves as Probable / Proved based on geological confidence and "
            "modifying factors."
        ),
        "jurisdiction": "AU",
        "authority": "Joint Ore Reserves Committee (AusIMM, AIG, MCA)",
        "sourceRef": "JORC Code 2012 (Australasian Code for Reporting of Exploration Results, Mineral Resources and Ore Reserves)",
        "canonicalClaim": "JORC Code 2012 mandates Competent Person sign-off for public mineral resource statements by ASX-listed companies",
    },
    {
        "title": "Customs Act 1901 (Cth) prohibited-exports regime criminalises unauthorised export of DSGL goods",
        "content": (
            "Section 112 of the Customs Act 1901 (Cth) and the Customs (Prohibited Exports) "
            "Regulations 1958 make it an offence to export goods prescribed as absolutely prohibited "
            "or prohibited without a licence. The DSGL is the schedule that determines which goods "
            "are licensed exports. Penalties include forfeiture of the goods and criminal penalties "
            "up to 10 years imprisonment or 2,500 penalty units. Administered by the Australian "
            "Border Force in conjunction with Defence Export Controls."
        ),
        "jurisdiction": "AU",
        "authority": "Commonwealth Parliament of Australia; Australian Border Force",
        "sourceRef": "Customs Act 1901 (Cth) s 112; Customs (Prohibited Exports) Regulations 1958",
        "canonicalClaim": "Customs Act 1901 (Cth) s 112 criminalises the unauthorised export of DSGL-listed goods from Australia",
    },
    {
        "title": "AUKUS Pillar 2 establishes trilateral advanced-capability technology transfer between AU, UK and US",
        "content": (
            "AUKUS Pillar 2 covers eight advanced-capability workstreams: undersea capabilities, "
            "quantum, AI and autonomy, advanced cyber, hypersonic and counter-hypersonic, electronic "
            "warfare, innovation, and information sharing. Enabling legislation includes the US "
            "ITAR AUKUS exemption (22 CFR 126.7) and Australia's Defence Trade Controls Amendment "
            "Act 2024 which creates reciprocal national-exemption pathways for AUKUS partner exports. "
            "Participation requires DISP or equivalent foreign clearance, and the DTCA permit regime "
            "continues to apply to transfers outside the AUKUS partner exemption."
        ),
        "jurisdiction": "AU",
        "authority": "Department of Defence; trilateral AUKUS working arrangements",
        "sourceRef": "AUKUS Pillar 2 Joint Leaders Statement (2021); Defence Trade Controls Amendment Act 2024 (Cth); 22 CFR 126.7 AUKUS exemption",
        "canonicalClaim": "AUKUS Pillar 2 is the trilateral framework for advanced-capability technology transfer between Australia, the UK and the US",
    },
    {
        "title": "Safeguards Act 1987 (Cth) implements Australia's nuclear non-proliferation obligations",
        "content": (
            "The Nuclear Non-Proliferation (Safeguards) Act 1987 (Cth) implements Australia's "
            "obligations under the NPT, the Australia-IAEA Comprehensive Safeguards Agreement and "
            "the Additional Protocol. It requires permits for possession, transport and communication "
            "of nuclear material and associated technology, and is administered by the Australian "
            "Safeguards and Non-Proliferation Office (ASNO). Relevant to critical-minerals operators "
            "handling monazite or rare-earth concentrates with source-material isotopes (uranium, thorium)."
        ),
        "jurisdiction": "AU",
        "authority": "Australian Safeguards and Non-Proliferation Office (DFAT)",
        "sourceRef": "Nuclear Non-Proliferation (Safeguards) Act 1987 (Cth), Act No. 8 of 1987",
        "canonicalClaim": "The Safeguards Act 1987 (Cth) implements Australia's obligations under the Nuclear Non-Proliferation Treaty",
    },
    {
        "title": "Weapons of Mass Destruction (Prevention of Proliferation) Act 1995 (Cth) prohibits WMD programme support",
        "content": (
            "The WMD Act 1995 (Cth) prohibits the supply of goods or services, and the provision of "
            "technology, that will or may assist a WMD programme — nuclear, chemical, biological or "
            "long-range missile. Unlike the DTCA which turns on a listed-goods schedule, the WMD Act "
            "applies a catch-all intent-based test: an export is prohibited if the exporter knows, "
            "suspects or ought reasonably to suspect the destination or end-use involves WMD. "
            "Penalties up to 8 years imprisonment."
        ),
        "jurisdiction": "AU",
        "authority": "Commonwealth Parliament of Australia; Department of Foreign Affairs and Trade",
        "sourceRef": "Weapons of Mass Destruction (Prevention of Proliferation) Act 1995 (Cth), Act No. 72 of 1995",
        "canonicalClaim": "The WMD (Prevention of Proliferation) Act 1995 (Cth) prohibits supplying goods or services suspected to serve a WMD programme",
    },
    {
        "title": "Autonomous Sanctions Act 2011 (Cth) authorises Australian targeted financial and trade sanctions",
        "content": (
            "The Autonomous Sanctions Act 2011 (Cth) and the Autonomous Sanctions Regulations 2011 "
            "provide the legal basis for Australia to impose targeted financial sanctions, travel "
            "bans and sectoral trade restrictions (including on Russia, Myanmar, North Korea, Iran "
            "and designated individuals). The 2021 Magnitsky-style amendments added a thematic "
            "designation power for serious human-rights abuses and significant corruption. "
            "Administered by DFAT's Australian Sanctions Office. Non-compliance carries criminal "
            "penalties up to 10 years imprisonment."
        ),
        "jurisdiction": "AU",
        "authority": "Department of Foreign Affairs and Trade (Australian Sanctions Office)",
        "sourceRef": "Autonomous Sanctions Act 2011 (Cth); Autonomous Sanctions Regulations 2011; 2021 Magnitsky amendments",
        "canonicalClaim": "The Autonomous Sanctions Act 2011 (Cth) authorises Australia's targeted financial, travel and sectoral sanctions",
    },
    {
        "title": "National Security Legislation Amendment (Espionage and Foreign Interference) Act 2018 criminalises foreign interference",
        "content": (
            "The 2018 NSLA EFI Act inserted new Commonwealth offences in Division 92 of the Criminal "
            "Code 1995 covering espionage, foreign interference, theft of trade secrets on behalf of "
            "a foreign principal, and the sabotage offences in Part 5.1. It complements the Foreign "
            "Influence Transparency Scheme Act 2018 (registration of activities undertaken on behalf "
            "of foreign principals) and is directly relevant to defence-industry suppliers managing "
            "insider-threat and foreign-ownership-influence risk."
        ),
        "jurisdiction": "AU",
        "authority": "Commonwealth Parliament of Australia",
        "sourceRef": "National Security Legislation Amendment (Espionage and Foreign Interference) Act 2018 (Cth); Criminal Code 1995 (Cth) Division 92",
        "canonicalClaim": "The NSLA (Espionage and Foreign Interference) Act 2018 (Cth) inserted foreign-interference offences into the Criminal Code 1995",
    },
]


def main() -> None:
    result = seed_topic_batch("seed-au-def", TOPICS)
    ok = sum(1 for v in result.values() if v)
    if DRY_RUN:
        print(f"\n=== seed_defence_au.py dry run: {ok}/{len(TOPICS)} already present, "
              f"{len(TOPICS) - ok} to create — nothing written ===")
    else:
        print(f"\n=== seed_defence_au.py complete: {ok}/{len(TOPICS)} topics in place ===")


if __name__ == "__main__":
    main()
