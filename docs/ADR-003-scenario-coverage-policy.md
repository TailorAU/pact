# ADR-003: Scenario Coverage Policy

> **Status:** Accepted
> **Date:** 2026-04-18
> **Extends:** [ADR-002](ADR-002-sovereign-decision-layer.md) — tri-entity graph with scenarios as predicate containers.
> **Context:** #1160 — scenario library expansion from 9 → ~31, `applicability_spotcheck` work type, and the scenario maintenance lifecycle.
> **Author:** Source executor agent, working from `docs/agents/handoffs/2-active/1160-source-scenario-library-expansion-and-applicability-spotcheck.md`.

---

## 1. Problem

ADR-002 introduced `scenarios` as predicate containers that emit `applies_when` edges into the tri-entity graph. The #1152 seed shipped 9 scenarios covering defence, critical-minerals, and ASX. Three policy gaps surfaced as the library grew toward the pitch pipeline (Foxleigh mining, QGov ICT, enterprise Privacy/AML, US-inbound defence):

1. **Scope creep risk.** Without a policy, scenarios drift toward customer- or project-specific applicability (e.g. "Foxleigh coal mine WHS obligations"). That leaks tenant context into the public graph and pollutes match results for other users.
2. **Citation drift.** Early scenarios had free-text `source_ref` prose (or none). Without a hard rule, later scenarios silently lose the "statute-grade" property that makes Source trustworthy for regulated-industry pitches.
3. **ID collisions + namespace drift.** Ad-hoc ids (`scenario_1`, `mining_scenario`) are unusable as stable join keys. Future co-apply edges and work-economy assignments need a deterministic id format.
4. **Asymmetry confusion.** `scenario_applies_when` and `legislation_co_applies` serve different purposes but can look similar to a new contributor. Without explicit direction rules, contributors add the wrong edge type.
5. **Agent authorship scope.** Agents will want to propose scenarios (especially via the `applicability_spotcheck` work type in Round 3). Without policy, an agent could silently merge a scenario with a bad citation.

## 2. Decisions

### Decision A — Scenarios are general-industry predicate containers

**Adopted:** Source `scenarios` are the public canonical set of **general-industry** applicability predicates. Customer- or project-specific applicability stays **tenant-side in Tailor** (per-org graph overlays, not the public Source graph).

**Rule:** A scenario qualifies for the public Source seed if and only if it is specific enough to be actionable (e.g. "QLD coal mine — statutory role appointments") but general enough that any market participant with matching predicates would agree it applies. Use the **"two-customer" test**: if only one customer would ever match, it's tenant-side; if ≥ 2 independent entities with matching predicates would all pull in the same obligation set, it belongs in Source.

**Rejected alternatives:**
- **Customer-tagged scenarios in the public seed.** Rejected: leaks tenant context, dilutes the signal for other users, and produces a maintenance burden (customer-specific scenarios change with customer circumstances, not with legislation).
- **Scenarios as PACT topics.** Rejected: a scenario is not a canonical claim — it's a predicate container. See ADR-002 Decision A.

**Consequences:**
- The #1160 seed scripts are fenced: no Foxleigh-specific, no QGov-specific, no named-organisation scenarios. The six new clusters (mining-safety, procurement, privacy, WHS, AML/CTF, US-inbound) are all industry-grade predicates.
- A future ticket will add `tenant_scenarios` overlays in Tailor that reference Source scenarios as their base and layer tenant context on top. Out of scope for #1160.

### Decision B — Every scenario cites a statute, listing rule, or standard

**Adopted:** Every scenario MUST populate a `source_ref` column (added in #1160 Round 1) that cites:

- A specific statute and section where it exists: `"Privacy Act 1988 (Cth) s 26WK"`, `"Coal Mining Safety and Health Act 1999 (Qld) s 41"`.
- A named framework document where no single statute applies: `"QITC Framework v2.3 (QGov)"`, `"ASX Listing Rule 3.1 (Guidance Note 8)"`.
- A multi-statute citation where a scenario spans instruments: `"Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) Part 3 Div 2; AUSTRAC Rules ch 10"`.

**Rule:** No prose-only citations without specifics. Citations without section numbers or named framework documents fail review.

**Rejected alternatives:**
- **Optional `source_ref`.** Rejected: creates silent drift where early scenarios have citations and later ones don't. The whole point of Source is statute-grade provenance.
- **Auto-generated citations from the topic graph.** Rejected: topics may reference multiple statutes; the scenario's citation is scenario-specific, not topic-derived.

**Consequences:**
- The golden test harness (Round 4) asserts `source_ref` is non-empty for every scenario.
- The predicate-pr-check workflow (Round 6.3) fails any PR adding a scenario without `source_ref`.
- The `/scenarios/[id]` page renders `sourceRef` prominently as the first-class citation.

### Decision C — Stable id namespace: `scn.{jurisdiction}-{industry-slug}-{situation-slug}`

**Adopted:** Scenario ids follow the pattern `scn.{jurisdiction}-{industry-slug}-{situation-slug}`.

- `{jurisdiction}`: ISO country code + optional state/territory (`au`, `au-qld`, `us`, `us-to-au`, `cth`).
- `{industry-slug}`: kebab-case industry or regulatory regime (`coal-mine`, `privacy`, `procurement`, `aml-ctf`, `whs`).
- `{situation-slug}`: kebab-case specific trigger (`safety-role-appointment`, `cross-border-transfer`, `notifiable-data-breach`).

**Examples:**
- `scn.au-qld-coal-mine-safety-role-appointment`
- `scn.au-privacy-cross-border-transfer`
- `scn.us-to-au-itar-controlled-import`
- `scn.au-cth-procurement-cpr`

**Rule:** Once published to `dev`, ids are **stable**. Retire via deprecation + supersession (see #1160 Round 6.2), never by renaming.

**Rejected alternatives:**
- **Opaque uuids.** Rejected: ids are used in MCP tool calls, CLI invocations, defect reports, and PR bodies — a human-readable slug is load-bearing UX.
- **Free-form slugs.** Rejected: `mining_scenario` vs `coal-mine-stuff` collide and fragment the namespace.

**Consequences:**
- Seed helpers validate the id pattern before upserting. Scripts fail fast on malformed ids.
- `scenario_revisions` tracks id (never changes) and title/description/edges (may change), so history stays readable even when content evolves.

### Decision D — Applicability is asymmetric

**Adopted:** Two edge types with distinct direction rules:

- `scenario_applies_when` — **directional**: a scenario pulls in applicable topics or legislation. Answers "given this situation, which obligations apply?"
- `legislation_co_applies` — **reciprocal, scenario-scoped**: two legislation instruments reinforce each other **only when** a specific scenario is live. Answers "given this situation, which instruments reinforce each other?"

**Rule:** Never use `legislation_co_applies` without a scoping `scenario_id`. A pair of acts that always co-apply (e.g. Privacy Act ↔ its NDB guidelines) is still scenario-scoped because the co-application fires when a breach scenario is triggered, not as a blanket claim.

**Allowed `relationship` values on `legislation_co_applies`:**
- `both_apply` — both instruments apply simultaneously
- `mutually_reinforcing` — one's obligations cite or depend on the other's
- `alternative_pathway` — either instrument can satisfy the obligation (new value introduced in #1160 Round 2.7)

**Rejected alternatives:**
- **Symmetric scenario edges.** Rejected: loses semantic clarity on who pulls whom. Applicability is always "this situation → those obligations".
- **Unscoped co-applies.** Rejected: produces a combinatorial explosion of edges that confuse rather than inform.

**Consequences:**
- The UI distinguishes the two edge types visually (`applies_when` dashed, `co_applies` double-line — see ADR-002).
- The match API returns `appliesWhen` and `coApplies` as separate fields with different semantics.

### Decision E — Agents propose, humans curate

**Adopted:** Agents may propose new scenarios via a future `scenario_proposal` work type but **cannot merge them unilaterally**. Scenario creation and edge changes require a human Chief-of-Source approver (or the orchestrator for minor text fixes) per the Round 6 maintenance lifecycle.

**Rule for #1160:** The scenario_proposal work type is explicitly out of scope for this handoff. The scope here is Round 3's `applicability_spotcheck` work type, which stress-tests existing edges (blind-predict) or flags defects on existing edges (review-existing). Agents earn credits; they do not merge.

**Rejected alternatives:**
- **Auto-merge high-confidence scenario proposals.** Rejected: a hallucinated citation at 0.9 confidence is still hallucinated. The trust model of Source depends on every scenario being human-approved.
- **No agent proposals at all.** Rejected: loses the long-tail coverage that agent-submitted proposals unlock.

**Consequences:**
- The `applicability_spotcheck` review-existing mode writes findings to `applicability_spotcheck_defects` (Round 3) in `open` status; a human curator moves them to `accepted` or `dismissed` via `/api/work/defects/{id}/resolve`.
- The next ticket (after #1160) introduces `scenario_proposal` — agents author draft scenarios that enter a PR queue, not the live graph.

## 3. Consequences

- Seed scripts under `sites/source/scripts/seed_scenarios_*.py` share `_scenario_seed_helpers.py` and enforce the id pattern, the `source_ref` rule, and the audit-write (Round 6.1).
- The `chief-source.mdc` rule links to this ADR and to the Round 6 runbook (`docs/operations/source-scenario-lifecycle.md`) as the canonical operational reference.
- The predicate vocabulary doc (Round 6.3) polices predicate keys; this ADR polices scenario identity and citation discipline. They are complementary.
- The `scenario_revisions` audit table (Round 6.1) captures every change per ADR decision with a `trigger_code` matching the Round 6.2 taxonomy.
- The two-customer test from Decision A is embedded in the runbook intake template so future curators apply it consistently.

## 4. Non-consequences

- **Does not change the tri-entity graph shape.** ADR-002 still governs node + edge types on `/map`.
- **Does not change PACT consensus flows.** Scenarios are not topics and never enter consensus. The applicability_spotcheck work type earns credits for graph-quality work, not for topic authorship.
- **Does not introduce customer scoping.** Tenant-side overlays are a future concern for Tailor, not Source.

---

## References

- ADR-001 — topics-only map (superseded by ADR-002)
- ADR-002 — tri-entity graph with scenarios as predicate containers
- Handoff: `docs/agents/handoffs/2-active/1160-source-scenario-library-expansion-and-applicability-spotcheck.md`
- Runbook (forthcoming in this handoff): `docs/operations/source-scenario-lifecycle.md`
- Predicate vocabulary (forthcoming in this handoff): `sites/source/docs/scenario-predicate-vocabulary.md`
