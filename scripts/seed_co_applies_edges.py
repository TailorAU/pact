#!/usr/bin/env python3
"""#1152 Round 2 — Seed scoped legislation_co_applies edges.

Each co_applies edge is scenario-scoped: two legislative instruments reinforce
each other ONLY in the context of one or more declared scenarios. Running
this requires the scenario scripts to have already run (same transaction DB,
same ON CONFLICT idempotency model).

Idempotent. Requires $DATABASE_URL.
"""
from _scenario_seed_helpers import (  # noqa: E402
    connect, add_co_applies, topic_id_by_title_prefix, summarise,
)


# Each row: (scenario_ids[], relationship, left_spec, right_spec, note)
# left_spec / right_spec are ("topic_prefix", "T") | ("legislation_id", "L")
EDGES = [
    (
        ["scn.au-defence-export-to-us"],
        "both_apply",
        ("Defence Trade Controls Act 2012 (Cth) regulates export", "T"),
        ("AUKUS Pillar 2 establishes trilateral", "T"),
        "DTCA 2012 permit regime and AUKUS Pillar 2 exemption pathway both apply to AU→US defence export",
    ),
    (
        ["scn.au-defence-export-to-us", "scn.au-defence-export-generic"],
        "both_apply",
        ("Defence Trade Controls Act 2012 (Cth) regulates export", "T"),
        ("Customs Act 1901 (Cth) prohibited-exports regime", "T"),
        "DTCA permit regime and Customs Act prohibited-exports regime jointly criminalise unauthorised DSGL export",
    ),
    (
        ["scn.au-defence-export-to-us", "scn.au-defence-export-generic"],
        "mutually_reinforcing",
        ("Defence Trade Controls Act 2012 (Cth) regulates export", "T"),
        ("Weapons of Mass Destruction (Prevention of Proliferation) Act 1995", "T"),
        "DTCA listed-goods regime + WMD Act intent-based catch-all provide layered export control",
    ),
    (
        ["scn.au-inbound-defence-investment", "scn.au-asx-listed-foreign-ownership"],
        "both_apply",
        ("FIRB critical-technologies list triggers", "T"),
        ("National Security Legislation Amendment (Espionage and Foreign Interference) Act 2018", "T"),
        "FIRB national-security review plus NSLA EFI criminal regime together govern foreign-influence risk",
    ),
    (
        ["scn.au-asx-listed-material-info", "scn.au-asx-listed-foreign-ownership"],
        "mutually_reinforcing",
        ("ASX Listing Rule 3.1 requires immediate disclosure", "T"),
        ("FIRB critical-technologies list triggers", "T"),
        "Continuous-disclosure and FIRB notification obligations co-arise on foreign-acquisition events in critical-tech issuers",
    ),
    (
        ["scn.au-critical-mineral-export-license"],
        "both_apply",
        ("Safeguards Act 1987 (Cth) implements", "T"),
        ("Customs Act 1901 (Cth) prohibited-exports regime", "T"),
        "Safeguards Act nuclear-material permit and Customs Act prohibited-exports both apply to source-material-bearing concentrates",
    ),
    (
        ["scn.us-defence-procurement-aukus-priority"],
        "one_triggers_the_other",
        ("AUKUS Pillar 2 establishes trilateral", "T"),
        ("DFARS", "T"),
        "AUKUS-origin content invokes the DFARS specialty-metals exception pathway",
    ),
    (
        ["scn.us-antimony-federal-lands-permit"],
        "one_triggers_the_other",
        ("NEPA", "T"),
        ("BLM", "T"),
        "NEPA environmental-review trigger brings BLM 43 CFR 3809 surface-management rules into play",
    ),
    (
        ["scn.au-us-critical-mineral-offtake"],
        "mutually_reinforcing",
        ("AU Critical Minerals Strategy", "T"),
        ("IRA critical-minerals", "T"),
        "AU supply-side strategy and US IRA demand-side pull together structure the AU→US offtake corridor",
    ),
    (
        ["scn.au-us-critical-mineral-offtake"],
        "both_apply",
        ("AUKUS Critical Minerals", "T"),
        ("Quad", "T"),
        "AUKUS CM Cooperation + Quad CM Partnership both frame trilateral/quadrilateral CM trade",
    ),
    (
        ["scn.au-defence-export-generic"],
        "one_triggers_the_other",
        ("Autonomous Sanctions Act 2011 (Cth) authorises", "T"),
        ("Customs Act 1901 (Cth) prohibited-exports regime", "T"),
        "Designation under Autonomous Sanctions activates Customs prohibited-exports pathways for the destination",
    ),
]


def _resolve_side(cur, prefix_or_id: str, kind: str) -> tuple[str | None, str | None]:
    """Returns (topic_id, legislation_id) with exactly one non-None."""
    if kind == "T":
        tid = topic_id_by_title_prefix(cur, prefix_or_id)
        return tid, None
    if kind == "L":
        return None, prefix_or_id
    raise ValueError(f"Unknown side kind: {kind}")


def run() -> int:
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                created = 0
                total = 0
                skipped = 0
                for scenarios, rel, left, right, note in EDGES:
                    left_t, left_l = _resolve_side(cur, left[0], left[1])
                    right_t, right_l = _resolve_side(cur, right[0], right[1])
                    total += 1
                    if (left[1] == "T" and not left_t) or (right[1] == "T" and not right_t):
                        print(f"  SKIP (missing topic): {left[0][:40]} <-> {right[0][:40]}")
                        skipped += 1
                        continue
                    if add_co_applies(cur,
                                      scenario_ids=scenarios,
                                      relationship=rel,
                                      left_topic_id=left_t, left_legislation_id=left_l,
                                      right_topic_id=right_t, right_legislation_id=right_l,
                                      note=note):
                        created += 1
                print()
                summarise("Co-applies edges", created, total - skipped)
                if skipped:
                    print(f"  Skipped: {skipped} (missing topic — expected on fresh DB)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(run())
