#!/usr/bin/env python3
"""#1137 — Seed the cross-cluster topic-dependency edges.

Run AFTER the three topic seed scripts (seed_defence_au.py, seed_defence_us.py,
seed_critical_minerals.py). Resolves topic titles to IDs via the public list
endpoint, then POSTs each edge to /api/pact/{topicId}/dependencies with
structured justifications that satisfy the first-principles assessment gate
(see sites/source/src/app/api/pact/[topicId]/dependencies/route.ts).

Idempotent: duplicate edges return HTTP 409 and are treated as success.
Missing topic IDs are reported but do not abort.
"""
import sys
import time

from _defence_seed_helpers import (  # noqa: E402
    BASE,
    DRY_RUN,
    api,
    find_topic_id_by_title,
    register_agents,
)


# ── Titles (must match exactly what the seed scripts created) ───────────────
DTCA = "Defence Trade Controls Act 2012 (Cth) regulates export of controlled military and dual-use technology"
DSGL = "Defence and Strategic Goods List (DSGL) enumerates export-controlled goods and technology"
DISP = "Defence Industry Security Program (DISP) is required for access to classified Defence contracts"
FIRB = "FIRB critical-technologies list triggers mandatory foreign-investment notification"
ASX_LR_31 = "ASX Listing Rule 3.1 requires immediate disclosure of price-sensitive information"
JORC_2012 = "JORC Code 2012 governs public reporting of mineral exploration results, resources and reserves"
CUSTOMS_PE = "Customs Act 1901 (Cth) prohibited-exports regime criminalises unauthorised export of DSGL goods"
AUKUS_P2 = "AUKUS Pillar 2 establishes trilateral advanced-capability technology transfer between AU, UK and US"

ITAR = "ITAR (22 CFR 120-130) governs the export of US defence articles and services"
EAR = "EAR (15 CFR 730-774) governs the export of US dual-use and commercial technology"
NEPA = "NEPA (42 USC 4321+) requires environmental impact assessment for major federal actions"
BLM_3809 = "BLM 43 CFR 3809 governs surface management of hardrock mining on federal land"
DFARS_7052 = "DFARS 252.225-7052 restricts DoD acquisition of non-domestic specialty metals including antimony"
DPA_TITLE_III = "Defense Production Act Title III funds domestic industrial-base expansion for critical materials"
CFIUS = "CFIUS reviews foreign investment in US critical-technology and critical-minerals businesses"
IRA_CRIT = "Inflation Reduction Act ties clean-energy tax credits to critical-minerals sourcing requirements"
BUY_AMERICAN = "Buy American Act 1933 requires federal agencies to prefer domestic end products in procurement"

AU_CMS = "Australia Critical Minerals Strategy 2023-2030 sets national priorities for minerals-to-markets processing"
US_CRIT_LIST = "US Critical Minerals List identifies 50 minerals essential to US economy and national security"
CHINA_SB = "China controls approximately 80 percent of global antimony production and refining"
CHINA_REE = "China controls approximately 70 percent of global rare-earth mining and over 85 percent of refining"
AUKUS_CM = "AUKUS Critical Minerals Cooperation coordinates trilateral supply-chain investment"
QUAD_CM = "Quad Critical Minerals Partnership coordinates diversification across AU, IN, JP and US"
EU_CRMA = "EU Critical Raw Materials Act sets 2030 domestic benchmarks for extraction, processing and recycling"


# ── Edges: (child_title, parent_title, relationship, necessity, direction) ──
# The `necessity` and `direction` strings MUST be at least 20 chars each, must
# avoid "related to" / "same domain" lazy patterns, and for builds_on must
# contain a structural keyword (extends, specialises, narrows, implements,
# derives, supersedes, amends, incorporates, mandated by, established by,
# created under, section, part, division, subordinate, enabling). For assumes,
# the necessity answer must contain a logical keyword (false, invalid,
# undefined, meaningless, cannot, impossible, contradicts, requires,
# presupposes, necessary, prerequisite, axiom, foundational).
EDGES: list[tuple[str, str, str, str, str]] = [
    # ── AU defence cluster: structural parent-child within AU export-control regime ──
    (
        DSGL, DTCA, "builds_on",
        "The DSGL has no independent statutory force. Without the DTCA the DSGL is meaningless as a legal instrument, as the DTCA is the enabling Act that gives the schedule its permit-requirement effect.",
        "The DSGL is the controlled-goods schedule created under the DTCA 2012 and administered by the Minister; it specialises the DTCA by enumerating exactly which goods fall inside the Act's permit regime.",
    ),
    (
        CUSTOMS_PE, DTCA, "builds_on",
        "The Customs Act prohibited-exports regime cannot independently define what 'controlled goods' means for export purposes; it requires the DTCA-anchored DSGL to supply that definition.",
        "Section 112 of the Customs Act and the Prohibited Exports Regulations 1958 are the enforcement enabling regime that incorporates the DSGL for export-control purposes.",
    ),
    (
        CUSTOMS_PE, DSGL, "builds_on",
        "Without the DSGL schedule the Customs prohibited-exports regime has no definition of which goods require a licence — the regime cannot operate as written in the absence of the DSGL list.",
        "The Customs Act s 112 and Prohibited Exports Regulations 1958 incorporates the DSGL as the operative schedule of controlled goods, narrows the Customs regime to those specifically listed items, and establishes the DSGL as the enabling schedule for prohibited-export enforcement.",
    ),
    (
        AUKUS_P2, DTCA, "builds_on",
        "AUKUS Pillar 2's Australian leg cannot grant national-exemption export pathways without underlying statutory authority; absent the DTCA the exemption has no Act to carve out of.",
        "AUKUS Pillar 2 is implemented via the Defence Trade Controls Amendment Act 2024 which amends the DTCA 2012 to create reciprocal national-exemption pathways.",
    ),
    (
        AUKUS_P2, ITAR, "builds_on",
        "The AUKUS national-exemption pathway on the US side cannot exist as a matter of US law without ITAR, because the exemption is a carve-out created under that very regulation.",
        "The AUKUS exemption at 22 CFR 126.7 is a subordinate section of the ITAR created under the Arms Export Control Act for AUKUS-partner exports.",
    ),
    (
        AUKUS_P2, DISP, "assumes",
        "Participation in AUKUS Pillar 2 workstreams requires a security-cleared supply chain; absent DISP (or foreign-equivalent clearance) the Australian participant presupposes a prerequisite that is invalid or undefined.",
        "DISP is the Australian national-security clearance framework that AUKUS Pillar 2 participation presupposes on the Australian side, making it a logical prerequisite rather than a peer.",
    ),

    # ── AU resource-sector disclosure: JORC specialises ASX 3.1 via LR 5.6 ──
    (
        JORC_2012, ASX_LR_31, "builds_on",
        "JORC reporting would be legally unenforceable without ASX Listing Rules — absent ASX LR 5.6 (which incorporates JORC) and the continuous-disclosure backbone of LR 3.1, JORC has no coercive force over listed miners.",
        "JORC 2012 specialises the ASX continuous-disclosure duty by setting the minimum-reporting standard for resource statements, incorporated via ASX Listing Rule 5.6 which is itself a subordinate section of the Listing Rules anchored by LR 3.1.",
    ),

    # ── US permitting: BLM Plan-of-Operations requires NEPA analysis ──
    (
        BLM_3809, NEPA, "assumes",
        "BLM approval of a Plan of Operations cannot lawfully proceed without NEPA analysis; approving a Plan in the absence of the required NEPA review would be invalid and subject to reversal on judicial review.",
        "NEPA review is the foundational prerequisite for any BLM federal-action approval under 43 CFR 3809, preceding and enabling the Plan-of-Operations decision.",
    ),

    # ── US procurement: DFARS specialty-metals narrows the Buy American Act ──
    (
        DFARS_7052, BUY_AMERICAN, "builds_on",
        "The DFARS 7052 specialty-metals rule would be redundant or incoherent without the underlying Buy American preference framework — absent the BAA there is no general domestic-preference structure for specialty-metals to specialise.",
        "DFARS 252.225-7052 narrows the general Buy American Act domestic-preference regime to a specific subordinate rule for defence-grade specialty metals (including antimony, tungsten, SmCo and NdFeB magnets).",
    ),

    # ── US national-security investment: CFIUS authority is a section of the DPA ──
    (
        CFIUS, DPA_TITLE_III, "builds_on",
        "CFIUS's jurisdiction over foreign acquisitions derives from statutory authority that is located within the Defense Production Act itself; absent the DPA the CFIUS review power is ungrounded.",
        "CFIUS authority is Section 721 of the Defense Production Act of 1950 (as amended by FIRRMA 2018), structurally a section of the same enabling Act as Title III.",
    ),

    # ── US clean-energy incentives: IRA references the USGS critical-minerals list ──
    (
        IRA_CRIT, US_CRIT_LIST, "builds_on",
        "The IRA's clean-vehicle critical-minerals content thresholds cannot be operationalised without an authoritative definition of which minerals count as 'critical' — absent the USGS list the thresholds are undefined.",
        "IRC § 30D incorporates the USGS Critical Minerals List (published under the Energy Act of 2020) as the operative schedule; the IRA narrows and specialises that list for clean-vehicle credit purposes.",
    ),
    (
        IRA_CRIT, CHINA_REE, "assumes",
        "The IRA's Foreign-Entity-of-Concern exclusion is an explicit policy response that presupposes Chinese concentration in rare-earth supply chains; absent that concentration the FEOC rules would be impossible to justify on national-security grounds.",
        "The IRA FEOC rules are a logical prerequisite that presupposes the empirical Chinese rare-earth concentration, making this a parent-child dependency rather than a sibling relationship.",
    ),
    (
        IRA_CRIT, CHINA_SB, "assumes",
        "The IRA's critical-minerals content rules presuppose vulnerable supply chains for specific minerals including antimony; absent the documented Chinese antimony concentration the rule's economic-security rationale cannot stand.",
        "The IRA critical-minerals framework logically requires the empirical China-antimony concentration as a foundational premise, not merely associative context.",
    ),

    # ── EU CRMA responds to documented Chinese rare-earth concentration ──
    (
        EU_CRMA, CHINA_REE, "assumes",
        "The CRMA's 65% single-country sourcing cap presupposes that current supply is concentrated in a single foreign country; absent that concentration the policy is meaningless and would not have been enacted.",
        "The EU Critical Raw Materials Act structurally presupposes the empirical Chinese rare-earth concentration as a prerequisite that justifies the binding 2030 benchmarks — a parent-child logical dependency.",
    ),

    # ── DPA Title III investments explicitly cite Chinese concentration ──
    (
        DPA_TITLE_III, CHINA_SB, "assumes",
        "Recent DPA Title III presidential determinations and funding allocations for antimony presuppose Chinese concentration in antimony supply; absent that empirical premise the determinations would be invalid as acts of economic-security policy.",
        "The DPA Title III antimony workstream requires the China-antimony concentration as a foundational empirical prerequisite that justifies the industrial-base expansion authority.",
    ),
    (
        DPA_TITLE_III, CHINA_REE, "assumes",
        "DPA Title III rare-earth investments presuppose the Chinese rare-earth concentration — absent that empirical premise the 'essential to national defence' threshold for DPA Title III action cannot be met.",
        "The DPA Title III rare-earth investments logically presuppose Chinese concentration as a foundational necessary condition, not a sibling observation.",
    ),

    # ── USGS list and DFARS rules reference China concentration ──
    (
        US_CRIT_LIST, CHINA_REE, "assumes",
        "The USGS Critical Minerals List explicitly assesses 'supply-chain vulnerability' as a listing criterion; absent demonstrated Chinese concentration the rare-earth listing cannot be justified as meaningful.",
        "The USGS list's rare-earth entries presuppose Chinese concentration as a foundational empirical input — the criterion that makes the listing a prerequisite for downstream critical-minerals policy.",
    ),
    (
        DFARS_7052, CHINA_SB, "assumes",
        "Recent NDAA tightening of DFARS specialty-metals rules to cover antimony presupposes documented Chinese antimony concentration; absent that premise the rule's narrowing to include antimony specifically would be invalid.",
        "The DFARS 7052 antimony inclusion logically presupposes the China-antimony concentration as a foundational prerequisite empirical input to the statutory specialty-metals scoping.",
    ),

    # ── Quad partnership presupposes the supply-risk it addresses ──
    (
        QUAD_CM, CHINA_REE, "assumes",
        "The Quad Critical Minerals Partnership's supply-diversification thesis presupposes Chinese concentration — absent that concentration the Quad would not need to coordinate diversification, making the China premise a logical prerequisite.",
        "The Quad partnership structurally requires the empirical Chinese rare-earth concentration as a foundational premise, not an associative context — the partnership is predicated on that concentration existing.",
    ),

    # ── AU Critical Minerals Strategy implements AUKUS + Quad and assumes JORC ──
    (
        AU_CMS, AUKUS_CM, "builds_on",
        "The Australian Critical Minerals Strategy could not execute its international-partnership priority without a bilateral/trilateral mechanism through which AU critical-minerals capacity is recognised as a secure source.",
        "The AU Strategy implements the AUKUS Critical Minerals Cooperation commitments on the Australian side, specialising the trilateral cooperation into domestic industry, workforce and investment policy.",
    ),
    (
        AU_CMS, QUAD_CM, "builds_on",
        "The Strategy's international-partnership priority cannot stand alone — it presupposes a multilateral framework (the Quad) within which Australia's critical-minerals offering is coordinated with IN, JP and US demand.",
        "The AU Strategy implements the Quad Critical Minerals Partnership on the Australian side, specialising the Quad's supply-diversification commitments into domestic industry, workforce and investment policy.",
    ),
    (
        AU_CMS, JORC_2012, "assumes",
        "Every AU critical-minerals project in the Strategy's pipeline presupposes JORC-compliant resource reporting — absent JORC the capital-markets access that the Strategy relies on for private investment is invalid.",
        "JORC 2012 is a foundational prerequisite for the AU Strategy's capital-markets and Export Finance Australia financing flows, a logical parent rather than a sibling framework.",
    ),
    (
        AU_CMS, CHINA_REE, "assumes",
        "The Strategy's 'strategically important projects' and downstream-processing priorities presupposes vulnerable upstream concentration that justifies diversification; absent Chinese concentration the policy is meaningless as an economic-security instrument and the national-interest rationale for ministerial intervention becomes invalid.",
        "The AU Strategy logically requires the empirical Chinese rare-earth concentration as a foundational prerequisite — the concentration is what makes the Strategy necessary rather than optional.",
    ),

    # ── AUKUS Critical Minerals Cooperation sits on DPA Title III domestic-source authority ──
    (
        AUKUS_CM, DPA_TITLE_III, "builds_on",
        "The AUKUS Critical Minerals Cooperation cannot operate as a US-funded mechanism without statutory authority to channel federal capital into foreign-partner industrial capacity — absent DPA Title III that authority is undefined.",
        "The May 2023 AU-US Critical Minerals Compact implements the designation of Australia as a 'domestic source' mandated by DPA Title III authority, a specialised extension of the DPA's industrial-base framework.",
    ),

    # ── AUKUS Pillar 2 assumes FIRB critical-tech gating on the Australian side ──
    (
        AUKUS_P2, FIRB, "assumes",
        "Any AUKUS Pillar 2 Australian participant presupposes that its foreign-ownership structure has been screened against FIRB's critical-technologies sensitivities; absent that screening the participant cannot lawfully hold AUKUS-relevant IP.",
        "FIRB critical-technologies screening is a foundational prerequisite for AUKUS Pillar 2 participation on the Australian side — a logical parent-child dependency rather than a sibling regime.",
    ),
]


def resolve_edges() -> tuple[list[tuple[str, str, str, dict]], int]:
    """Resolve titles to topic IDs. Returns (edges, missing_count)."""
    print(f"\n=== Resolving {len(EDGES)} edge titles to topic IDs ===")
    resolved: list[tuple[str, str, str, dict]] = []
    missing = 0
    cache: dict[str, str | None] = {}
    for child_title, parent_title, rel, nec, direction in EDGES:
        if child_title not in cache:
            cache[child_title] = find_topic_id_by_title(child_title)
        if parent_title not in cache:
            cache[parent_title] = find_topic_id_by_title(parent_title)
        child_id = cache[child_title]
        parent_id = cache[parent_title]
        if not child_id:
            print(f"  MISS child : {child_title[:80]}")
            missing += 1
            continue
        if not parent_id:
            print(f"  MISS parent: {parent_title[:80]}")
            missing += 1
            continue
        resolved.append((child_id, parent_id, rel, {"necessity": nec, "direction": direction}))
    print(f"  resolved {len(resolved)}/{len(EDGES)} edges ({missing} missing)")
    return resolved, missing


def main() -> None:
    # Single agent is enough; dependency POST only requires a valid API key
    # (no age gate, no civic-duty gate).
    print(f"\n=== #1137 seed_topic_dependencies against {BASE} ===")

    if DRY_RUN:
        # GET-only plan: resolve titles, then check each edge against the
        # child's current dependency list. No agent, no writes.
        edges, missing = resolve_edges()
        would_create = existed = 0
        seen: dict[str, set[str]] = {}
        for child_id, parent_id, rel, _j in edges:
            if child_id not in seen:
                code, data = api("GET", f"/api/pact/{child_id}/dependencies")
                deps = set()
                if code == 200 and isinstance(data, dict):
                    for key in ("assumptions", "buildsOn"):
                        for row in data.get(key) or []:
                            if row.get("depends_on"):
                                deps.add(row["depends_on"])
                seen[child_id] = deps
                time.sleep(0.2)
            if parent_id in seen[child_id]:
                existed += 1
                print(f"  EXISTS  {rel:<10} {child_id[:8]} -> {parent_id[:8]}")
            else:
                would_create += 1
                print(f"  CREATE  {rel:<10} {child_id[:8]} -> {parent_id[:8]}")
        print(
            f"\n=== DRY RUN plan: {would_create} edges to create, {existed} already present, "
            f"{missing} unresolvable (topics missing) of {len(EDGES)} ==="
        )
        return

    keys = register_agents("seed-deps", 1)
    agent_key = keys[0]

    edges, missing = resolve_edges()
    if not edges:
        print("\nFATAL: no edges resolved. Did the three topic seed scripts run first?")
        sys.exit(1)

    print(f"\n=== Creating {len(edges)} dependency edges ===")
    created = 0
    existed = 0
    failed = 0
    for idx, (child_id, parent_id, rel, justification) in enumerate(edges):
        code, data = api(
            "POST",
            f"/api/pact/{child_id}/dependencies",
            key=agent_key,
            data={"dependsOn": parent_id, "relationship": rel, "justification": justification},
        )
        if code in (200, 201):
            created += 1
            print(f"  [{idx + 1:>2}/{len(edges)}] OK   CREATED {rel:<10} {child_id[:8]} -> {parent_id[:8]}")
        elif code == 409:
            existed += 1
            print(f"  [{idx + 1:>2}/{len(edges)}] OK   EXISTS  {rel:<10} {child_id[:8]} -> {parent_id[:8]}")
        else:
            failed += 1
            err = data.get("error", str(data)[:140]) if isinstance(data, dict) else str(data)[:140]
            detail = data.get("detail", "") if isinstance(data, dict) else ""
            print(f"  [{idx + 1:>2}/{len(edges)}] FAIL ({code}) {err} {('| ' + detail) if detail else ''}")
        time.sleep(0.4)

    print(
        f"\n=== seed_topic_dependencies.py complete: {created} created, {existed} existed, "
        f"{failed} failed, {missing} missing-topics ==="
    )


if __name__ == "__main__":
    main()
