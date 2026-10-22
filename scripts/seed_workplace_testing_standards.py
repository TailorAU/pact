#!/usr/bin/env python3
"""pact#28 ask-1 — Seed workplace drug-and-alcohol-testing standards as
institutional PACT topics (metadata only — NO copyrighted standard content).

Seeds five institutional-tier topics:

  * AS/NZS 4308:2008  — urine drug screening (specimen collection + quantitation)
  * AS/NZS 4760:2019  — oral fluid drug testing
  * AS 3547:2019      — breath alcohol testing devices
  * ISO 45001:2018    — OHS management systems
  * A workplace drug-and-alcohol-testing CONTEXT topic that anchors the
    dependency edges ("what activity demands the standard").

Each standard topic carries: designation, full catalogue title, publisher,
edition/year, status=current, and a scope sentence describing the activity
that demands it. `sourceRef` is the standards.org.au / iso.org CATALOGUE URL
— a pointer to the authoritative catalogue entry, never standard content.
Standards Australia / ISO text is copyrighted; only bibliographic metadata
and independent scope descriptions are seeded.

Edges: the topic-dependency vocabulary is `builds_on` / `assumes`
(VALID_RELATIONSHIPS in sites/source/src/lib/db.ts — there is no
`applies_when` relationship on topic_dependencies; `applies_when` proper is
a scenario-library edge in scenario_applies_when). Following how the
seed_defence scripts express applicability, the workplace-testing context
topic declares `assumes` edges onto each standard via
POST /api/pact/{topicId}/dependencies with the structured justification the
first-principles assessment gate requires.

No admin secret required — everything goes through the public PACT API.
Idempotent: duplicate titles return 409 + existingTopicId, duplicate edges
return 409; both are treated as success. Safe to re-run.

DO NOT run against production as part of a code deploy — this script is for
an operator to run out-of-band:

Usage:
    python seed_workplace_testing_standards.py                    # https://source.tailor.au
    SOURCE_BASE=https://pact.tailor.au python seed_workplace_testing_standards.py
    SOURCE_BASE=http://localhost:4000 python seed_workplace_testing_standards.py   # dev
"""
import sys
import time

from _defence_seed_helpers import (  # noqa: E402
    BASE,
    api,
    find_topic_id_by_title,
    register_agents,
    seed_topic_batch,
)


# ── Topic titles (edge resolution keys — must match TOPICS exactly) ──────────
AS_NZS_4308 = "AS/NZS 4308:2008 sets the procedures for specimen collection and the detection and quantitation of drugs of abuse in urine"
AS_NZS_4760 = "AS/NZS 4760:2019 sets the procedures for specimen collection and the detection and quantitation of drugs in oral fluid"
AS_3547 = "AS 3547:2019 specifies requirements for breath alcohol testing devices for personal and workplace use"
ISO_45001 = "ISO 45001:2018 specifies requirements for occupational health and safety management systems"
WDT_CONTEXT = "Workplace drug and alcohol testing in Australia is defensible when conducted to the recognised Australian Standards"


TOPICS: list[dict] = [
    {
        "title": AS_NZS_4308,
        "content": (
            "Designation: AS/NZS 4308:2008. Full title: 'Procedures for specimen collection "
            "and the detection and quantitation of drugs of abuse in urine'. Publisher: "
            "Standards Australia / Standards New Zealand (joint standard). Edition: 2008 "
            "(current). Status: current. Scope: the standard that workplace URINE drug-screening "
            "programs demand — it governs specimen collection and handling, chain-of-custody, "
            "on-site initial (screening) testing, and laboratory confirmatory testing for drugs "
            "of abuse in urine. Employers, testing providers and laboratories cite compliance "
            "with AS/NZS 4308 to establish that a workplace urine testing program is procedurally "
            "defensible (including in unfair-dismissal and safety-regulator proceedings). "
            "Bibliographic metadata only — the standard's text is copyrighted by Standards "
            "Australia and is not reproduced here."
        ),
        "jurisdiction": "AU",
        "authority": "Standards Australia / Standards New Zealand",
        "sourceRef": "https://store.standards.org.au/product/as-nzs-4308-2008",
        "canonicalClaim": (
            "AS/NZS 4308:2008 (Standards Australia / Standards New Zealand, current) is the "
            "recognised standard for workplace urine drug screening in Australia, covering "
            "specimen collection, chain-of-custody, initial screening and laboratory "
            "confirmatory testing."
        ),
    },
    {
        "title": AS_NZS_4760,
        "content": (
            "Designation: AS/NZS 4760:2019. Full title: 'Procedures for specimen collection "
            "and the detection and quantitation of drugs in oral fluid'. Publisher: Standards "
            "Australia / Standards New Zealand (joint standard). Edition: 2019 (supersedes the "
            "2006 edition). Status: current. Scope: the standard that workplace ORAL FLUID "
            "(saliva) drug-testing programs demand — it governs oral-fluid specimen collection, "
            "on-site screening devices, and laboratory confirmatory testing. Oral fluid testing "
            "is the common alternative to urine testing where recent-use detection is the "
            "program objective; industrial tribunals have weighed AS/NZS 4760 compliance when "
            "assessing the reasonableness of workplace testing policies. Bibliographic metadata "
            "only — the standard's text is copyrighted by Standards Australia and is not "
            "reproduced here."
        ),
        "jurisdiction": "AU",
        "authority": "Standards Australia / Standards New Zealand",
        "sourceRef": "https://store.standards.org.au/product/as-nzs-4760-2019",
        "canonicalClaim": (
            "AS/NZS 4760:2019 (Standards Australia / Standards New Zealand, current) is the "
            "recognised standard for workplace oral fluid drug testing in Australia, covering "
            "specimen collection, on-site screening and laboratory confirmatory testing."
        ),
    },
    {
        "title": AS_3547,
        "content": (
            "Designation: AS 3547:2019. Full title: 'Breath alcohol testing devices'. "
            "Publisher: Standards Australia. Edition: 2019 (supersedes AS 3547-1997). Status: "
            "current. Scope: the standard that workplace BREATH ALCOHOL testing demands — it "
            "specifies requirements and test methods for breath alcohol testing devices "
            "(breathalysers) used for personal and workplace testing, including device type "
            "classification, accuracy and calibration requirements. Workplace alcohol testing "
            "policies cite AS 3547-verified devices so that a positive breath test result is "
            "evidentially defensible. Bibliographic metadata only — the standard's text is "
            "copyrighted by Standards Australia and is not reproduced here."
        ),
        "jurisdiction": "AU",
        "authority": "Standards Australia",
        "sourceRef": "https://store.standards.org.au/product/as-3547-2019",
        "canonicalClaim": (
            "AS 3547:2019 (Standards Australia, current) specifies the requirements for breath "
            "alcohol testing devices used in Australian workplace alcohol testing, including "
            "accuracy and calibration requirements."
        ),
    },
    {
        "title": ISO_45001,
        "content": (
            "Designation: ISO 45001:2018. Full title: 'Occupational health and safety "
            "management systems — Requirements with guidance for use'. Publisher: International "
            "Organization for Standardization (ISO). Edition: first edition, 2018. Status: "
            "current. Scope: the standard that a certified OHS MANAGEMENT SYSTEM demands — it "
            "specifies requirements for an occupational health and safety management system "
            "within which hazard-control programs (including workplace drug and alcohol testing "
            "programs and fitness-for-work policies) are planned, operated, audited and "
            "improved. ISO 45001 superseded OHSAS 18001. Bibliographic metadata only — the "
            "standard's text is copyrighted by ISO and is not reproduced here."
        ),
        "jurisdiction": "INTERNATIONAL",
        "authority": "International Organization for Standardization (ISO)",
        "sourceRef": "https://www.iso.org/standard/63787.html",
        "canonicalClaim": (
            "ISO 45001:2018 (ISO, current) specifies the requirements for occupational health "
            "and safety management systems, the framework within which workplace "
            "fitness-for-work and drug-and-alcohol-testing programs are operated and audited."
        ),
    },
    {
        "title": WDT_CONTEXT,
        "content": (
            "Workplace drug and alcohol testing in Australia sits on the primary WHS duty of "
            "care (Work Health and Safety Act 2011 model provisions s 19) and is commonly a "
            "condition of safety-critical work (mining, construction, transport, rail, "
            "aviation). A testing program's procedural defensibility — in unfair-dismissal "
            "proceedings before the Fair Work Commission, in safety-regulator engagement, and "
            "in enterprise-agreement disputes — turns on whether testing was conducted to the "
            "recognised standards: AS/NZS 4308:2008 for urine screening, AS/NZS 4760:2019 for "
            "oral fluid testing, and AS 3547:2019 for breath alcohol devices, within a managed "
            "OHS system of the kind specified by ISO 45001:2018."
        ),
        "jurisdiction": "AU",
        "authority": "Fair Work Commission jurisprudence; model WHS laws (Safe Work Australia)",
        "sourceRef": "Work Health and Safety Act 2011 (model provisions) s 19; FWC unfair-dismissal jurisprudence on workplace testing",
        "canonicalClaim": (
            "An Australian workplace drug and alcohol testing program is procedurally "
            "defensible when specimen collection and testing are conducted to AS/NZS 4308:2008 "
            "(urine), AS/NZS 4760:2019 (oral fluid) and AS 3547:2019 (breath alcohol), operated "
            "within an OHS management system consistent with ISO 45001:2018."
        ),
    },
]


# ── Edges: (child_title, parent_title, relationship, necessity, direction) ──
# Topic-dependency vocabulary is builds_on/assumes (no applies_when on
# topic_dependencies). The context topic ASSUMES each standard: absent the
# standard, the program's defensibility premise is invalid. The assessment
# gate requires: necessity ≥ 20 chars WITH a logical keyword for `assumes`
# (invalid, cannot, presupposes, prerequisite, requires, meaningless...);
# direction ≥ 20 chars explaining parent→child, and for `builds_on` a
# structural keyword in the direction answer.
EDGES: list[tuple[str, str, str, str, str]] = [
    (
        WDT_CONTEXT, AS_NZS_4308, "assumes",
        "A workplace urine drug-screening result cannot be procedurally defended without the "
        "collection, chain-of-custody and confirmatory-testing procedures of AS/NZS 4308:2008 — "
        "absent the standard, the defensibility claim is invalid because there is no recognised "
        "benchmark the program presupposes.",
        "AS/NZS 4308:2008 is the foundational procedural prerequisite that workplace urine "
        "testing presupposes; the testing context is the dependent child applying the parent "
        "standard's procedures, not a peer framework.",
    ),
    (
        WDT_CONTEXT, AS_NZS_4760, "assumes",
        "A workplace oral fluid testing program presupposes the specimen-collection and "
        "confirmatory-testing procedures of AS/NZS 4760:2019 — absent the standard, a "
        "saliva-based result has no recognised benchmark and the defensibility premise is "
        "invalid.",
        "AS/NZS 4760:2019 is the foundational procedural prerequisite for the oral-fluid arm "
        "of a workplace testing program; the testing context is the dependent child applying "
        "the parent standard, not a sibling regime.",
    ),
    (
        WDT_CONTEXT, AS_3547, "assumes",
        "A workplace breath alcohol test result presupposes a device meeting AS 3547:2019 "
        "accuracy and calibration requirements — absent a conforming device, the reading "
        "cannot support disciplinary or fitness-for-work action and the defensibility premise "
        "is invalid.",
        "AS 3547:2019 is the foundational device-conformance prerequisite for the breath "
        "alcohol arm of a workplace testing program; the testing context is the dependent "
        "child relying on the parent standard's device requirements.",
    ),
    (
        WDT_CONTEXT, ISO_45001, "assumes",
        "A defensible testing program presupposes a managed OHS system in which the policy is "
        "planned, communicated, operated and audited — without the management-system framework "
        "ISO 45001:2018 specifies, standalone testing is procedurally unanchored and the "
        "program's systematic-management premise cannot stand.",
        "ISO 45001:2018 specifies the parent management-system framework within which a "
        "workplace drug and alcohol testing program operates as a dependent hazard-control "
        "child process, not a peer standard.",
    ),
]


def seed_edges() -> tuple[int, int, int, int]:
    """Resolve edge titles → IDs and POST each dependency edge. Idempotent."""
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

    if not resolved:
        return 0, 0, 0, missing

    # Dependency POST only needs a valid API key (no age gate, no civic duty).
    keys = register_agents("seed-wdt-deps", 1)
    agent_key = keys[0]

    print(f"\n=== Creating {len(resolved)} dependency edges ===")
    created = existed = failed = 0
    for idx, (child_id, parent_id, rel, justification) in enumerate(resolved):
        code, data = api(
            "POST",
            f"/api/pact/{child_id}/dependencies",
            key=agent_key,
            data={"dependsOn": parent_id, "relationship": rel, "justification": justification},
        )
        if code in (200, 201):
            created += 1
            print(f"  [{idx + 1}/{len(resolved)}] OK   CREATED {rel:<10} {child_id[:8]} -> {parent_id[:8]}")
        elif code == 409:
            existed += 1
            print(f"  [{idx + 1}/{len(resolved)}] OK   EXISTS  {rel:<10} {child_id[:8]} -> {parent_id[:8]}")
        else:
            failed += 1
            err = data.get("error", str(data)[:140]) if isinstance(data, dict) else str(data)[:140]
            detail = data.get("detail", "") if isinstance(data, dict) else ""
            print(f"  [{idx + 1}/{len(resolved)}] FAIL ({code}) {err} {('| ' + detail) if detail else ''}")
        time.sleep(0.4)
    return created, existed, failed, missing


def main() -> None:
    print(f"\n=== pact#28 seed_workplace_testing_standards against {BASE} ===")
    result = seed_topic_batch("seed-wdt-std", TOPICS)
    ok = sum(1 for v in result.values() if v)
    if ok == 0:
        print("\nFATAL: no topics in place; skipping edges.")
        sys.exit(1)

    created, existed, failed, missing = seed_edges()
    print(
        f"\n=== seed_workplace_testing_standards.py complete: {ok}/{len(TOPICS)} topics, "
        f"edges {created} created / {existed} existed / {failed} failed / {missing} missing ==="
    )


if __name__ == "__main__":
    main()
