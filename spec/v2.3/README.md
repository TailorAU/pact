# PACT v2.3 — DRAFT / NOT FOR CITATION

> **This directory is a DRAFT.** It has **not** been signed off per
> AGENTS.md rule 3 and MUST NOT be cited, mirrored, or treated as stable.
> Cite **`spec/v2.2/`** (stable, Matter-line) or **`spec/v2.0/`** (stable,
> v2.0.3) until this banner is removed by an explicit maintainer sign-off
> recorded below. Review vehicles:
> [#53](https://github.com/TailorAU/pact/issues/53),
> [#54](https://github.com/TailorAU/pact/issues/54),
> [#55](https://github.com/TailorAU/pact/issues/55).

## Sign-off record

| Event | Authority | Date |
|---|---|---|
| Draft opened (multi-cell RFC PR) | agent, per #53 / #54 / #55 | 2026-08-20 |
| Promotion to stable | *(pending — requires explicit maintainer sign-off)* | — |

## What v2.3 contains

A carry-forward of the stable **v2.2** body (itself v2.0.3 + §24 Matters)
plus the **multi-cell fabric** rule set, authored from the design record
`docs/v2-prep/rfc-multi-cell-quorum.md` (Changes 1–4) via issues
#53 / #54 / #55:

- **Cells and the §15.4 cell trigger** (#53) — *cell* defined as a
  vendor-neutral isolation grouping identified by a cell DID; fabric
  membership carries `cell_id`; the participant cell set is fixed at
  fabric establish; a fifth §15.4 cross-organisation trigger fires when
  two participants on the same fabric carry different `cell_id` values,
  so §17.6 `authorization_proof` and the §17.9 Authorization-Required
  checks apply on the cross-cell wire.
- **`cell-quorum` approval policy + multi-cell policy bans** (#54) —
  a new `ApprovalPolicy` requiring ≥1 counted approval from **each**
  cell in the fixed participant set (bucketed by `cell_id`, not
  head-count; a dark cell fails closed). On fabrics whose participant
  cell set has cardinality > 1, agent-count policies (`single` /
  `majority` / `unanimous`) and silence-merge policies (`auto` /
  `objection-based`) MUST NOT be configured.
- **Multi-cell conflicts MUST human-escalate** (#55) — when the
  participant cell set has cardinality > 1, the conflict strategy MUST
  be `human-escalate`; `first-wins` and `merge-both` MUST NOT be used;
  `vote` is not a substitute unless it is itself cell-quorum and still
  escalates when any cell is dark.

**Not in this directory:** §19–22 (Parleys / Mandates / push /
service-account — the v2.1 line, still draft in `spec/v2.1/`) and the
§25 consensus/authorization/legal-execution boundary (v2.1-line,
PR #45). Both fold into this line when their own review vehicles land
and are signed off; this draft does not duplicate or pre-empt them.
`spec/v2.2/` itself remains stable and unedited per AGENTS.md rule 4;
this directory is a copy that adds the multi-cell rules, not an edit
of v2.2.

## Conformance level claims (draft)

- **Core**: identical to v2.2. Single-cell fabrics are unaffected by
  every rule in this line.
- **Extended**: v2.2 Extended + implementations advertising
  `capabilities.cellQuorum` MUST enforce the §5 multi-cell policy bans
  and the §5 multi-cell conflict rule.
- **Authorization-Required**: v2.2 Authorization-Required + the §15.4
  cell trigger MUST be evaluated on every message on a fabric whose
  participant cell set has cardinality > 1.

## File map

| Path | What |
|---|---|
| `SPECIFICATION.md` | v2.2 normative text + multi-cell rules (§5, §10.5, §15.1, §15.4) |
| `schemas/` | unchanged from v2.2 (a `cell_id` membership schema field is expected before promotion) |
| `conformance/` | unchanged from v2.2 (multi-cell vectors are expected before promotion) |
| `resource-types.yaml` | unchanged from v2.2 |
| `GETTING_STARTED.md` | unchanged from v2.2 |

## Citation

Do **not** cite this directory until the DRAFT banner is removed. After
promotion, cite it as **"PACT v2.3"** and the multi-cell rules as
**"PACT v2.3 §5 / §15.4"**.
