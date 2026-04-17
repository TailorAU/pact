#!/usr/bin/env python3
"""#1160 Round 2.7 — Expansion co-applies pairs for the 6 new scenario clusters.

Adds ≥ 8 new scenario-scoped legislation_co_applies edges covering privacy,
WHS, AML/CTF, procurement, AUKUS, mining-safety + environment, and Tranche-2.
Runs AFTER seed_scenarios_{mining_safety,procurement,privacy,whs,aml_ctf,us_inbound}.py
so all referenced scenarios + topic stubs exist.

Introduces the new `relationship` value `alternative_pathway` for cases where
either of two statutes / regulations can satisfy a licensing or compliance
obligation (e.g. ITAR 126.7 AUKUS exemption vs standard ITAR licence).
The `relationship` column is TEXT so no schema change is required — the
value is surfaced through the existing API decoder as a plain string.

Idempotent. Safe to re-run. Requires $DATABASE_URL.

Usage:
    $env:DATABASE_URL = "postgres://..."
    python sites/source/scripts/seed_co_applies_edges_expansion.py
"""
from __future__ import annotations

from _scenario_seed_helpers import (  # noqa: E402
    connect, add_co_applies, topic_id_by_title_prefix, summarise,
)


# Each row: (scenario_ids[], relationship, left_spec, right_spec, note)
# left_spec / right_spec are ("topic_prefix_or_legislation_id", "T"|"L").
EDGES = [
    (
        ["scn.au-privacy-notifiable-data-breach"],
        "both_apply",
        ("Notifiable Data Breaches scheme", "T"),
        ("Notification obligation", "T"),
        "NDB eligible-breach definition + s 26WK / 26WL notification obligation both engage on data-breach events",
    ),
    (
        ["scn.au-privacy-notifiable-data-breach", "scn.au-privacy-cross-border-transfer"],
        "mutually_reinforcing",
        ("APP 8", "T"),
        ("s 16C", "T"),
        "APP 8 reasonable-steps obligation + s 16C liability pass-through jointly police overseas disclosures",
    ),
    (
        ["scn.au-cdr-data-holder"],
        "both_apply",
        ("CDR regime", "T"),
        ("CDR privacy safeguards", "T"),
        "CDR Part IVD framework and the 13 CDR privacy safeguards are a single compliance surface for accredited data holders",
    ),
    (
        ["scn.au-qld-industrial-manslaughter"],
        "mutually_reinforcing",
        ("QLD industrial-manslaughter offence — PCBU", "T"),
        ("CMSHA coal-mine carve-out", "T"),
        "QLD industrial-manslaughter offences and the CMSHA coal-mine carve-out define where the WHS vs CMSHA regime applies on fatality events",
    ),
    (
        ["scn.au-whs-contractor-pcbu-duties"],
        "both_apply",
        ("Concurrent WHS duties", "T"),
        ("Duty to consult", "T"),
        "Multiple-duty-holder principle + consultation duty jointly govern shared workplaces",
    ),
    (
        ["scn.au-sanctions-designated-destination"],
        "both_apply",
        ("Autonomous Sanctions — permit regime", "T"),
        ("Sanctioned-person screening", "T"),
        "Permit regime and screening obligation together define the AU autonomous-sanctions compliance surface",
    ),
    (
        ["scn.au-sanctions-designated-destination", "scn.au-austrac-reporting-entity"],
        "mutually_reinforcing",
        ("AML/CTF Act — designated services", "T"),
        ("Autonomous Sanctions — permit regime", "T"),
        "AML/CTF CDD + autonomous-sanctions screening reinforce each other on sanctioned-counterparty transactions",
    ),
    (
        ["scn.au-tranche2-professional-services"],
        "both_apply",
        ("Tranche-2 captured professions", "T"),
        ("Tranche-2 roll-out obligations", "T"),
        "Expanded-scope definition + phased implementation obligations together drive Tranche-2 compliance",
    ),
    (
        ["scn.au-qld-ict-qitc-procurement"],
        "mutually_reinforcing",
        ("QITC Framework — General Contract Conditions", "T"),
        ("Commonwealth Procurement Rules — Division 1 principles", "T"),
        "QITC contract terms + CPR Division 1 principles apply jointly when QGov ICT contracts touch a Commonwealth panel",
    ),
    (
        ["scn.us-to-au-aukus-reciprocal-path"],
        "alternative_pathway",
        ("22 CFR 126.7 AUKUS reciprocal exemption", "T"),
        ("ITAR licensing", "T"),
        "ITAR-controlled transfers can proceed via the AUKUS 126.7 exemption OR standard ITAR licence — either pathway may be relied on",
    ),
    (
        ["scn.au-qld-environmental-authority", "scn.au-qld-mineral-resources-act-tenure"],
        "both_apply",
        ("QLD Environmental Authority", "T"),
        ("QLD mineral resources tenure", "T"),
        "EA + tenure conditions stack — both are preconditions to lawful operation of a QLD mine",
    ),
    (
        ["scn.us-to-au-itar-controlled-import"],
        "mutually_reinforcing",
        ("ITAR licensing + re-transfer", "T"),
        ("AU recipient obligations", "T"),
        "US-side ITAR re-transfer rules + AU-side DTCA controlled-supply offences bind the Australian recipient",
    ),
]


def _resolve_side(cur, spec: str, kind: str) -> tuple[str | None, str | None]:
    """Returns (topic_id, legislation_id) with exactly one non-None."""
    if kind == "T":
        tid = topic_id_by_title_prefix(cur, spec)
        return tid, None
    if kind == "L":
        return None, spec
    raise ValueError(f"Unknown side kind: {kind}")


def run() -> int:
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                created = 0
                skipped = 0
                resolved = 0
                for scenarios, rel, left, right, note in EDGES:
                    left_t, left_l = _resolve_side(cur, left[0], left[1])
                    right_t, right_l = _resolve_side(cur, right[0], right[1])
                    if (left[1] == "T" and not left_t) or (right[1] == "T" and not right_t):
                        print(f"  SKIP (missing topic): '{left[0][:50]}' <-> '{right[0][:50]}'")
                        skipped += 1
                        continue
                    resolved += 1
                    if add_co_applies(
                        cur,
                        scenario_ids=scenarios, relationship=rel,
                        left_topic_id=left_t, left_legislation_id=left_l,
                        right_topic_id=right_t, right_legislation_id=right_l,
                        note=note,
                    ):
                        created += 1
                print()
                summarise("Co-applies expansion edges", created, resolved)
                if skipped:
                    print(f"  Skipped: {skipped} (topic prefix did not match — run scenario seeds first)")
                print(f"  Total attempted: {len(EDGES)}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(run())
