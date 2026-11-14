# RFC: Multi-cell fabrics — cross-org trigger, cell-quorum, no silence-merge

> **Status:** RFC — for discussion before normative spec text lands.
> **Target version:** PACT v2.3 draft (`spec/v2.3/`, already the consensus / authorization line for [#41](https://github.com/TailorAU/pact/issues/41)). Do not edit frozen `spec/v2.0/` or rewrite `spec/v2.2/`.
> **Owner:** Knox Hart.
> **Source:** Cursor background composer [bc-019ff94f](https://cursor.com/agents) (Door and cell collaboration, 2026-08-17) plus RNM/AN I9.
> **Not this RFC:** sign-in routing, cell stamps, border agents, CRDT replicas, notary cells, per-cell inference keys. Those are implementer / deployment concerns. PACT starts after a session is bound to a fabric.

> **Landing addendum (2026-08-20).** Issues filed as
> [#53](https://github.com/TailorAU/pact/issues/53) (Change 1),
> [#54](https://github.com/TailorAU/pact/issues/54) (Changes 2+3) and
> [#55](https://github.com/TailorAU/pact/issues/55) (Change 4); landed
> as one draft PR ([#57](https://github.com/TailorAU/pact/pull/57),
> `spec/v2.3/`) rather than four spec PRs. The "Ready-to-file issues"
> section below is retained as the historical record. Two corrections
> against the landed text: **(1)** the consensus / legal-execution
> boundary (§25, [#41](https://github.com/TailorAU/pact/issues/41) /
> PR [#45](https://github.com/TailorAU/pact/pull/45)) is on the
> **v2.1 line**, not v2.3 as this file assumed when written — the fit
> analysis below still holds; read "v2.3 §25" as "§25 (v2.1 line)".
> **(2)** the landed text is stricter than this RFC in one respect:
> `cell_id` MUST be **bound to a proof of control of the cell DID**
> (a cell membership attestation signed by the cell key, or a
> cell-scoped invite minted under the cell DID's authority), and
> unproven `cell_id` claims MUST be rejected or at most bucketed as
> the joining operator's own cell — a hardening added from the PR #57
> adversarial review (finding F1: self-asserted `cell_id` lets an
> initiator stuff the counterparty's quorum bucket). The landed text
> also resolves OQ2 as "both" (`participant_cells` at establish, with
> a first-join-binding fallback) and defines omitted-`cell_id`
> memberships as one implicit cell for cardinality.

## Problem

A **cell** here is a vendor-neutral isolation boundary: a group of agents that share a data and compute plane and are identified by a cell DID (SHOULD be `did:key`). Two cells collaborating on one fabric keep **separate replicas**. What crosses the boundary is PACT ops plus proofs — never a shared store.

Today the spec cannot say that safely:

1. **§15.4 does not treat two `did:key` cells as cross-org.** Cross-org is triggered by different DID *methods*, `did:web` eTLD+1, an unresolvable federated registry, or an explicit `cross_org_assertion`. Two cells that both use `did:key` and appear in a shared registry fail every heuristic. `authorization_proof` (§17.6) and the Authorization-Required checks (§17.9) therefore **do not fire** on the exact path they exist for.
2. **§5 approval policies count agents, not isolation boundaries.** `single` / `majority` / `unanimous` can be satisfied entirely inside one cell. Two agents in cell A can majority-merge with zero approvals from cell B.
3. **`objection-based` treats silence as a merge.** v2.3 §25 already says that silence is not legal consent. That is not enough here: a quiet peer would still merge **foreign content** into a sealed replica. Sovereignty, not signature law.
4. **Conflict strategies include `first-wins` and `merge-both`.** Across cells those silently prefer one replica or an LLM merge. The only safe strategy is `human-escalate`.

I9 (RNM/AN) already requires the cross-cell wire to be open MIT PACT only. These four gaps are why that wire is not load-bearing yet.

This is **core protocol**, not a Tailor extension. Any implementer that isolates compute/data into more than one participant group hits the same holes. Tailor-specific machinery (door, border agent, DOCX sanitiser, Sovrgn keys) stays out of the spec.

## Proposal

Add a first-class **cell** grouping on a fabric, then four normative changes in this order. One RFC, four spec PRs after accept (same pattern as #41 → `spec/v2.3/`).

### Cell (protocol term)

A **cell** is a declared grouping of agents that share one isolation boundary.

- Identified by a **cell DID**. Implementations SHOULD use `did:key`. `did:web` MAY be used; Authorization-Required SHOULD still prefer `did:key` (existing §17 guidance).
- Membership carries `cell_id`. Agents without a `cell_id` are treated as belonging to a single implicit cell for that fabric (today's behaviour).
- The **participant cell set** is fixed at fabric establish (or at the `_onboard` that first declares a second cell). It is not a live agent count.
- Two `did:key` agents are **not** automatically two cells. Inference from DID method is forbidden — that is today's §15.4 bug in reverse.

Do not rename Matter (§24) "shared participant set". A Matter participant set is membership of a Matter. A cell set is an isolation grouping on a fabric. They may coincide; they are not the same noun.

### Change 1 — multi-cell is always cross-org (§15.4)

Land **before** 2–4 so HAL actually applies.

Add a fifth cross-organisation trigger:

> A message from agent A to agent B is **cross-organisation** if A and B carry different `cell_id` values on the same fabric, or if the fabric's declared participant cell set has cardinality > 1 and the message is a `propose`, `_onboard`, or any other operation that §17 already requires `authorization_proof` for when cross-org.

Keep the existing four triggers. A sender MAY still set `cross_org_assertion` (more checks, not fewer). Intra-org remains "none of the triggers hold."

Consequence: `authorization_proof` fires on every inter-cell `propose` / `_onboard` at Authorization-Required. Two `did:key` cells in one registry can no longer launder as intra-org.

### Change 2 — `cell-quorum` approval policy (§5)

New `ApprovalPolicy` value:

| Policy | Description |
|---|---|
| `cell-quorum` | Merge requires ≥1 counted approval from **each** cell in the fabric's fixed participant cell set. Approvals are bucketed by `cell_id`, not by agent head-count. |

- The set is the one fixed at establish. A cell that later goes dark does **not** shrink the set (fail closed; no silence-merge of the missing cell).
- The existing self-approval rule still applies **inside** a cell: an author's approval of their own proposal does not satisfy that cell's bucket unless `allowSelfApproval` is true.
- `human-only` remains valid but is not a substitute: a single human in cell A must not satisfy the whole fabric. If `human-only` is used on a multi-cell fabric, it MUST be evaluated as human-only **and** cell-quorum (one human approval per cell).

### Change 3 — ban silence-merge and agent-count policies on multi-cell fabrics (§5, §10.5)

When the participant cell set has cardinality > 1, implementations MUST NOT use:

- `objection-based`
- `auto`
- `single` / `majority` / `unanimous` (agent-count)

Configuring one of those on a multi-cell fabric is a profile error: refuse establish / policy change, fail closed. v2.3 §25.6 already blocks `auto` / `objection-based` from *applying* `external-irreversible` effects. This change additionally blocks them from **merging replica state** across cells, including `internal-reversible` document drafts.

Changes 2 and 3 land together: a quorum without a silence back-door.

### Change 4 — multi-cell conflicts MUST `human-escalate` (§5 Conflict Detection)

When the participant cell set has cardinality > 1, the conflict strategy MUST be `human-escalate`.

MUST NOT: `first-wins`, `merge-both`. `vote` is not a substitute unless the vote is itself cell-quorum (one vote bucket per cell) **and** still escalates when any cell is dark.

### Implementer note (not a spec PR)

A server that hosts a multi-cell fabric MUST advertise and pass `POST /api/pact/_probe/tier` at **Authorization-Required** (§15.5 / §17.9). Claiming Extended on a shared hostname is not the boundary profile. Event `prev_hash` + daily signed root stay as they are at that tier. No new verbs.

## What this is not

- A Tailor product noun. "Cell" is the isolation grouping; implementers may call the deployment stamp something else.
- A shared database, blob, embedding store, or "neutral" copy of the resource.
- New PACT verbs. `join` · `intent` · `constrain` · `propose` · `object` · `negotiate` · `escalate` · `done` are unchanged.
- Sign-in / door routing. Binding a browser session to a stamp is outside PACT (`join` happens after the session exists).
- Permission to implement a Tailor-only merge rule at the boundary if this RFC is rejected. The fallback is: do not run a multi-cell fabric.

## Fit with v2.3 §25

§25 answers "does consensus mean a legal signature?" (no). This RFC answers "may one isolation boundary merge into another without that boundary's approval?" (no). Both are fail-closed; they are not substitutes.

| §25 | This RFC |
|---|---|
| Silence is not legal consent | Silence MUST NOT merge foreign replica bytes |
| Guarded apply needs payload-bound human attestation | Inter-cell propose needs `authorization_proof` because it is cross-org |
| `auto` / `objection-based` cannot apply `external-irreversible` | Those policies cannot even be configured when cells > 1 |

## Open questions

1. **Noun.** Is `cell` acceptable as a core term, or should the spec say `isolation_group` / `participant_group` to avoid Tailor-product collision? Lean: `cell` — short, already used in RNM/AN, not a registered product mark in this repo. Change is a search-replace if the maintainer prefers another noun.
2. **Where `cell_id` lives.** Agent registration object vs fabric establish document vs both? Lean: both — establish lists the allowed cell DIDs; each member carries one of those DIDs.
3. **Single-cell fabrics.** No change. Implicit one-cell set; today's policies remain valid (still subject to §25).
4. **Matter vs cell.** Can a Matter span cells? Lean: yes, and then the Matter inherits this RFC's rules (cross-org + cell-quorum + no silence-merge). Confirm against RFC #18 OQ5 (cross-Matter references deferred).
5. **Dark cell.** If a declared cell never approves, the proposal stays pending forever unless a human on *that* cell escalates or the fabric is re-established with a new (explicit, authorised) participant set. No TTL carve-out.

## Sequenced landing (after accept)

| Order | Spec PR | Sections | Why this order |
|---|---|---|---|
| 1 | Multi-cell ⇒ cross-org | §15.4, membership/`cell_id` | HAL / `authorization_proof` must fire before any merge rule |
| 2+3 | `cell-quorum` + ban agent-count / silence-merge | §5, §10.5, §15.1 profile | Quorum without a silence back-door |
| 4 | Multi-cell conflict ⇒ `human-escalate` | §5 Conflict Detection | Last, depends on 1–3 being sayable |

Conformance vectors belong in `spec/v2.3/conformance/` (new family, e.g. `extended/multi-cell/`). Do not add them to frozen `spec/v2.0/conformance/`.

Normative prose is **not** in this file. Maintainer sign-off required before any `SPECIFICATION.md` edit (`AGENTS.md` rule 5, `GOVERNANCE.md` §3).

## Ready-to-file issues (blocked on `gh auth`)

`gh` against github.com is 401 (Tailor-AUS token invalid). After `gh auth login -h github.com`, file four issues on `TailorAU/pact` with labels `rfc` + `spec-change`. Bodies below.

### Issue A — `[SPEC] Multi-cell participant set is always cross-org (§15.4)`

**Section(s) Affected:** §15.4; agent/fabric membership (`cell_id`).

**Current Behavior:** Cross-org is DID-method, `did:web` eTLD+1, unresolvable registry, or `cross_org_assertion`. Two `did:key` cells in a shared registry are intra-org. `authorization_proof` does not fire.

**Proposed Change:** Declare `cell` as a grouping with a cell DID. Different `cell_id` on the same fabric ⇒ cross-org. Participant cell set fixed at establish.

**Rationale:** HAL is pointless at the cell boundary if the boundary does not trigger §15.4. See `docs/v2-prep/rfc-multi-cell-quorum.md` Change 1.

### Issue B — `[SPEC] Add cell-quorum ApprovalPolicy`

**Section(s) Affected:** §5 Approval Policy.

**Current Behavior:** Policies count agents (`single` / `majority` / `unanimous`) or silence (`objection-based`).

**Proposed Change:** `cell-quorum`: ≥1 counted approval from each cell in the fixed participant set. Self-approval rule still applies inside a cell.

**Rationale:** Agent-count majority lets one cell merge for everyone. See RFC Change 2. File with Issue C; land in the same PR.

### Issue C — `[SPEC] Forbid objection-based and agent-count policies on multi-cell fabrics`

**Section(s) Affected:** §5, §10.5.

**Current Behavior:** `objection-based` auto-merges on TTL. Agent-count policies are legal on any fabric.

**Proposed Change:** When participant cells > 1, MUST NOT configure `objection-based`, `auto`, `single`, `majority`, or `unanimous`. Fail closed at establish / policy change.

**Rationale:** Silence-merge writes foreign content into a sealed replica. §25 is about legal execution, not replica sovereignty. See RFC Change 3. Same PR as Issue B.

### Issue D — `[SPEC] Multi-cell conflicts MUST human-escalate`

**Section(s) Affected:** §5 Conflict Detection.

**Current Behavior:** `first-wins`, `vote`, `human-escalate`, `merge-both` are all allowed.

**Proposed Change:** Multi-cell fabrics MUST use `human-escalate`. MUST NOT `first-wins` or `merge-both`.

**Rationale:** First-wins / LLM merge-both silently prefer one cell. See RFC Change 4. Lands after A and B+C.

## Comment window (once filed)

Propose 14 days from the Issue A file date, same shape as RFC #14. A clarifying question does not stop the clock; only a substantive design objection does (`GOVERNANCE.md` §3).
