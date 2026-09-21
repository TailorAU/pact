#!/usr/bin/env python3
"""#1137 — Seed critical-minerals + supply-chain topics.

Seeds ~8 institutional-tier PACT topics covering the critical-minerals policy
landscape: AU Critical Minerals Strategy, US Critical Minerals List, rare-earth
supply concentration, antimony-specific supply facts, AUKUS critical-minerals
cooperation, Quad critical-minerals partnership, EU Critical Raw Materials Act
and Japan JOGMEC stockpiling.

No admin secret required. Idempotent.
"""
from _defence_seed_helpers import seed_topic_batch  # noqa: E402


TOPICS: list[dict] = [
    {
        "title": "Australia Critical Minerals Strategy 2023-2030 sets national priorities for minerals-to-markets processing",
        "content": (
            "The Australia Critical Minerals Strategy 2023-2030 (published June 2023 by the "
            "Department of Industry, Science and Resources) names six strategic priorities: "
            "develop strategically important projects, attract investment and build international "
            "partnerships, grow the workforce, First Nations engagement, ESG performance, and "
            "unlock investment in downstream processing. The accompanying Critical Minerals List "
            "identifies 31 minerals critical to the modern economy. Antimony, rare-earth elements, "
            "lithium, graphite, manganese, nickel and cobalt are in scope. The Strategy underpins "
            "the AUD 4bn Critical Minerals Facility at Export Finance Australia."
        ),
        "jurisdiction": "AU",
        "authority": "Australian Government (Department of Industry, Science and Resources)",
        "sourceRef": "Australia's Critical Minerals Strategy 2023-2030 (June 2023); Australian Critical Minerals List 2023",
        "canonicalClaim": "Australia's Critical Minerals Strategy 2023-2030 is accompanied by a Critical Minerals List naming 31 critical minerals",
    },
    {
        "title": "US Critical Minerals List identifies 50 minerals essential to US economy and national security",
        "content": (
            "The US Critical Minerals List, published by the US Geological Survey under the Energy "
            "Act of 2020 (30 USC 1606), identifies 50 non-fuel minerals deemed essential to US "
            "economic and national security whose supply chains are vulnerable to disruption. The "
            "2022 update added nickel and zinc; the list must be revised at least every three years. "
            "Antimony, tungsten, graphite, rare-earth elements, gallium, germanium, tantalum and "
            "indium are included. Separately, the Defense Logistics Agency maintains a National "
            "Defense Stockpile of selected minerals under 50 USC 98 et seq."
        ),
        "jurisdiction": "US",
        "authority": "US Geological Survey (Department of the Interior)",
        "sourceRef": "Energy Act of 2020, 30 USC 1606; US Critical Minerals List (2022)",
        "canonicalClaim": "The USGS Critical Minerals List identifies 50 non-fuel minerals essential to US economic and national security",
    },
    {
        "title": "China controls approximately 80 percent of global antimony production and refining",
        "content": (
            "Published USGS Mineral Commodity Summaries consistently report China as the dominant "
            "global producer of antimony ores and refined metal, with recent annual mine production "
            "around 40,000 tonnes out of a global total near 83,000 tonnes, and an even higher "
            "share of metallurgical refining capacity. Russia and Tajikistan are the next-largest "
            "producers. In August 2024 the Chinese Ministry of Commerce announced export licensing "
            "for antimony, antimony ores and antimony trioxide effective 15 September 2024 — a "
            "materially restrictive measure for downstream defence and flame-retardant markets "
            "outside China."
        ),
        "jurisdiction": "INTERNATIONAL",
        "authority": "US Geological Survey (Mineral Commodity Summaries); China Ministry of Commerce",
        "sourceRef": "USGS Mineral Commodity Summaries: Antimony (2023, 2024); MOFCOM Announcement No. 33 of 2024 (antimony export licensing)",
        "canonicalClaim": "USGS reports recent Chinese antimony mine production near 40,000 tonnes of a global total near 83,000 tonnes",
    },
    {
        "title": "China controls approximately 70 percent of global rare-earth mining and over 85 percent of refining",
        "content": (
            "USGS and IEA data show China accounts for approximately 70 percent of global rare-"
            "earth-oxide mine production and more than 85 percent of separation and refining "
            "capacity. Heavy rare earths (dysprosium, terbium, yttrium) — the magnet-critical "
            "elements — are particularly concentrated. In 2023-2024 China placed export controls on "
            "gallium, germanium, graphite, and rare-earth extraction and separation technology, "
            "tightening the export-licensing regime. This concentration is the anchor risk for the "
            "Inflation Reduction Act FEOC rules and the AUKUS-Quad critical-minerals cooperation."
        ),
        "jurisdiction": "INTERNATIONAL",
        "authority": "US Geological Survey; International Energy Agency (Critical Minerals Outlook)",
        "sourceRef": "USGS Mineral Commodity Summaries: Rare Earths (2024); IEA Critical Minerals Outlook 2024",
        "canonicalClaim": "China accounts for about 70 percent of global rare-earth mine production per USGS data",
    },
    {
        "title": "AUKUS Critical Minerals Cooperation coordinates trilateral supply-chain investment",
        "content": (
            "In parallel with the AUKUS Pillar 2 advanced-capability workstreams, the AUKUS "
            "partners have committed to coordinate investment in secure critical-minerals supply "
            "chains. The US Department of Defense has made DPA Title III investments in AUKUS-"
            "partner projects (including Australian rare-earth separation capacity). The "
            "Australia-US Climate, Critical Minerals and Clean Energy Transformation Compact (May "
            "2023) expressly aligns the two countries' critical-minerals programmes and designates "
            "Australia as a 'domestic source' for the purposes of DPA Title III."
        ),
        "jurisdiction": "INTERNATIONAL",
        "authority": "AUKUS partner governments (AU, UK, US)",
        "sourceRef": "Australia-US Climate, Critical Minerals and Clean Energy Transformation Compact (May 2023); AUKUS Joint Leaders Statement (2023)",
        "canonicalClaim": "The 2023 Australia-US Climate, Critical Minerals and Clean Energy Compact designates Australia a domestic source under DPA Title III",
    },
    {
        "title": "Quad Critical Minerals Partnership coordinates diversification across AU, IN, JP and US",
        "content": (
            "The Quad Critical and Emerging Technology Working Group, formalised at the 2021 Tokyo "
            "Leaders Summit and expanded through the 2023-2024 Joint Leaders Statements, "
            "coordinates critical-minerals supply-chain diversification between Australia, India, "
            "Japan and the United States. Key workstreams include joint mapping of reserves, "
            "information sharing on trade restrictions, harmonised ESG standards, and alignment of "
            "export-credit financing. The partnership recognises that no single Quad economy can "
            "diversify away from Chinese concentration independently."
        ),
        "jurisdiction": "INTERNATIONAL",
        "authority": "Quad partner governments (Australia, India, Japan, United States)",
        "sourceRef": "Quad Joint Leaders Statements 2021-2024; Quad Critical and Emerging Technology Working Group",
        "canonicalClaim": "The Quad Critical and Emerging Technology Working Group coordinates critical-minerals supply-chain diversification among its members",
    },
    {
        "title": "EU Critical Raw Materials Act sets 2030 domestic benchmarks for extraction, processing and recycling",
        "content": (
            "EU Regulation 2024/1252 (the Critical Raw Materials Act, in force May 2024) establishes "
            "binding 2030 benchmarks: at least 10 percent of EU annual consumption of strategic raw "
            "materials extracted in the EU, 40 percent processed in the EU, 25 percent recycled in "
            "the EU, and no more than 65 percent from a single third country. Strategic raw "
            "materials include rare earths, lithium, cobalt, nickel, manganese, natural graphite, "
            "tungsten, gallium and germanium. Implements Strategic Project designations and faster "
            "permitting timelines (27 months extraction / 15 months processing)."
        ),
        "jurisdiction": "EU",
        "authority": "European Parliament and Council",
        "sourceRef": "Regulation (EU) 2024/1252 (Critical Raw Materials Act)",
        "canonicalClaim": "The EU Critical Raw Materials Act (Regulation 2024/1252) sets binding 2030 benchmarks for extraction, processing and recycling",
    },
    {
        "title": "Japan JOGMEC maintains strategic metals stockpiles and co-invests in overseas supply",
        "content": (
            "Japan Organization for Metals and Energy Security (JOGMEC, formerly JOGMEC / JNC), "
            "under the Ministry of Economy, Trade and Industry (METI), operates Japan's strategic "
            "rare-metals stockpile (typically 60 days of domestic consumption for each listed "
            "metal) and takes equity positions in overseas critical-minerals projects to secure "
            "off-take. JOGMEC investments have played a stabilising role in Australian rare-earth "
            "processing ventures since Lynas (Mount Weld / Kuantan) in 2011. The JOGMEC model is "
            "frequently cited as a template for Australian and US strategic stockpiling policy."
        ),
        "jurisdiction": "JP",
        "authority": "Japan Organization for Metals and Energy Security (under METI)",
        "sourceRef": "Japan Organization for Metals and Energy Security Act (Act No. 94 of 2002); METI Stockpile Policy",
        "canonicalClaim": "Japan's JOGMEC operates a 60-day strategic stockpile of rare metals under METI policy",
    },
]


def main() -> None:
    result = seed_topic_batch("seed-crit-min", TOPICS)
    ok = sum(1 for v in result.values() if v)
    print(f"\n=== seed_critical_minerals.py complete: {ok}/{len(TOPICS)} topics in place ===")


if __name__ == "__main__":
    main()
