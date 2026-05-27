# RFC: Matters — multi-fabric deal-room workspaces

> **Status:** RFC draft — design record only, NOT spec text. Per AGENTS.md rule 5, no normative text is freehanded; this exists in `docs/v2-prep/` for review before any spec work begins.
> **Target version:** PACT v2.2 candidate (NOT v2.1 — v2.1 is BLOCKED on RFC #14 with comment window closing 2026-05-26; do not re-scope v2.1).
> **Owner:** Knox Hart.
> **Related decisions:** D2 (2026-05-12, resolved B — see explicit-distinction section below); D5 (2026-05-12, peer-to-peer Sessions with opt-in facilitator).
> **Maintainer decisions on this RFC (2026-05-24):** core-vs-extension = **PACT-core, v2.2 candidate**; noun = **Matter**; side-channel = **typed events only**; GitHub issue = **file now with `rfc` label**.
> **Source:** conversation 2026-05-24 (Knox: "Like a deal room?" — confirmed the structural analogy holds but PACT scopes to one resource; this RFC closes that gap).

## Problem

PACT today scopes a **fabric** to a single resource. Two agents can join one fabric and negotiate over that resource's sections (v2.0.3 onboarding + §4.4 awareness + §10 ICS). v2.1 will add ephemeral **Parleys** for bounded 1-topic agent-to-agent exchanges. Neither shape covers the deal-room case Knox surfaced:

1. **Multi-artifact** — a real "deal" (M&A transaction, legal matter, procurement engagement, multi-document negotiation) consists of N peer artifacts. Term sheet + schedules + diligence binder. Engagement letter + draft contract + retainer schedule. RFP + N bids + negotiation thread. Each is its own PACT resource; today they have no protocol-level grouping.

2. **Side-channel discussion** — deal rooms have a side-thread for free-form coordination ("can we get the financials by Friday?", "I've added a redline to §3"). §13 Mediated Communication exists, but it is per-fabric and structured around protocol primitives (intent, constraint, proposal, objection) routed through a Mediator. It is not designed for casual cross-artifact coordination.

3. **Cross-fabric awareness** — §4.4 manifest is per-fabric only. An agent in a deal cannot ask "where am I across all the artifacts in this Matter, and what obligations are pending across them?" — only "where am I in this one fabric."

Concrete examples the current spec does not cleanly serve:

- **M&A**: term sheet (fabric A), diligence binder (fabric B), comms thread, shared participant set across both
- **Legal engagement**: engagement letter (fabric A), draft instrument (fabric B), retainer schedule (fabric C), same parties throughout
- **Procurement**: RFP (fabric A), bids (fabrics B/C/D — possibly with information barriers between bidders), negotiation thread with the winning bidder

In all three, the **Matter** (the workspace + participant set + side-thread) is the load-bearing concept, and the artifacts inside are peers, not parent-child.

## Explicit distinction from D2

D2 was resolved B on 2026-05-12: the **attached-resource model** (parent doc with weighted child docs — Mandatory liability clause, etc.) ships as a Tailor extension, NOT PACT core. This RFC is structurally different and must be evaluated on its own merits, not collapsed onto D2:

| Dimension | D2 (attached-resource, rejected as core) | This RFC (Matter) |
|---|---|---|
| Shape | Parent resource with weighted child resources | Container with N peer resources |
| Semantics | Document composition (weight, type) | Workspace grouping (membership, side-channel) |
| New surface | Composition primitives inside a fabric | Container above fabrics; cross-fabric awareness |
| Inside fabric? | Yes (sub-resources within one fabric) | No (fabrics remain independent and unmodified) |
| Domain | Document-domain-specific | Domain-agnostic (M&A, legal, procurement, govt) |

The Matter does NOT touch what a fabric is or how it merges. It adds a layer above. Maintainer call (2026-05-24): this is **distinct enough from D2 to be PACT-core** — the case being that cross-fabric obligation tracking, shared participant identity, and side-channel discussion are protocol-level concerns the way §4.4 manifest awareness is.

## Why this aligns with the v2.1 "Contexture" backronym refinement

`docs/v2-prep/v2.1-scope.yaml` records the maintainer decision (2026-05-17) that PACT's expansion becomes "Protocol for Agent **Contexture** and Trust," where Contexture names *"the shared resource (the fabric) and the context that gives it meaning travel[ling] together."* A Matter is the natural next layer of contexture: the shared **set** of resources, plus the cross-cutting context (participants, side-thread, obligations) that gives the *set* its meaning. v2.0.3 made one fabric self-aware; v2.1 will add Parleys for ephemeral cross-agent work; v2.2 Matters would make a *bundle* of fabrics self-aware.

This is not load-bearing for accepting the RFC — but it is why the shape feels native rather than bolt-on.

## Proposal

Add a new long-lived primitive — **Matter** — that:

- References N peer fabrics (each unchanged)
- Holds a shared participant set (members are `§23 agentId`s and `§17 HumanPrincipal`s)
- Exposes a typed side-channel for cross-artifact coordination (typed events only — no chat protocol)
- Surfaces a cross-fabric manifest (extension of §4.4 to Matter scope)
- Has its own lifecycle (`open → active → closed`) independent of constituent fabrics

### Matter shape (sketch — not normative)

```jsonc
{
  "matter": {
    "id": "mtr_xyz",
    "name": "Project Atlas acquisition",
    "members": [
      { "principal": "did:web:knox.example", "role": "owner" },
      { "principal": "did:web:counterparty.example", "role": "participant" }
    ],
    "fabrics": [
      { "resourceId": "doc_term_sheet", "attached_at": "2026-05-24T10:00Z" },
      { "resourceId": "doc_diligence", "attached_at": "2026-05-24T10:15Z" }
    ],
    "side_channel": {
      "kind": "typed-events",
      "event_log": "mtr_xyz/messages"
    },
    "phase": "active",   // open | active | closed
    "opened_at": "...",
    "closes_at": null     // optional TTL
  }
}
```

### Lifecycle (sketch)

```
POST   /api/pact/matters                        open a Matter
POST   /api/pact/matters/{id}/members           add a member
POST   /api/pact/matters/{id}/fabrics           attach an existing fabric
DELETE /api/pact/matters/{id}/fabrics/{rid}     detach a fabric
POST   /api/pact/matters/{id}/messages          post to side-channel (typed event)
GET    /api/pact/matters/{id}/manifest          caller-scoped cross-fabric manifest
POST   /api/pact/matters/{id}/close             close the Matter (does NOT close fabrics)
```

### Event types (sketch)

```
pact.matter.opened
pact.matter.member-added
pact.matter.member-removed
pact.matter.fabric-attached
pact.matter.fabric-detached
pact.matter.message            // the side-channel — typed, hash-chained per §6
pact.matter.closed
```

### Side-channel — what it is and isn't

Maintainer call (2026-05-24): **typed events only**. The side-channel is a Matter-scoped append-only log of `pact.matter.message` entries on the standard PACT event channel.

- **Is**: typed events, each carrying sender, timestamp, structured body, optional `references: { fabric_id, section_id }` link, hash-chained per §6.4, visible per §17.13 disclosure rules. Implementations may render as chat in their UI; the wire format stays typed events.
- **Isn't**: a chat product. No presence, no typing indicators, no reactions in the wire protocol. Free-form text is permitted as a `body.format: "text"` event payload, but the envelope is always a typed PACT event.

Rationale: PACT is a protocol, not a messaging product. Side-channel as typed events keeps everything hash-chained, signed-rooted, and auditable — the same posture as every other PACT event.

## Composition with shipped v2.0.x / scoped v2.1

| v2.0.3 / v2.1 surface | How Matters reuse it |
|---|---|
| §17 trust chain + §23 agent identity | Matter members ARE `HumanPrincipal` + `agentId` — no new identity model |
| §4.4 fabric manifest | Matter manifest is the §4.4 caller-scoped manifest extended to a *set* of fabrics; same shape, same disclosure rules per §17.13 |
| §4.4.3 heartbeat / attention | Matter-scoped heartbeat extends the per-fabric heartbeat to multi-fabric scope |
| §6 event log + §6.4 hash chain + signed root | The Matter event log AND the side-channel inherit §6 wholesale |
| §6.5 pending obligations | Cross-fabric obligation queries become first-class (a Matter member can ask "all my pending obligations across this Matter" — a §4.4-style query at Matter scope) |
| §13 Mediator | If a Matter opts in to mediation, ONE Mediator can be Matter-scoped, mediating across all attached fabrics rather than per-fabric (cleaner than the per-fabric mediator-per-document model) |
| §17.13 disclosure rules | Apply unchanged — Matter-scoped visibility filters are the same as fabric-scoped, just over a wider set of resources |
| v2.1 Parley (when shipped) | A Parley can open *with* a Matter as predecessor context — `predecessor_matter_id` analogous to the OQ4 `predecessor_parley_id` |

The net new normative surface is bounded to: the Matter object itself, the attach/detach lifecycle, the typed side-channel event shape, and the cross-fabric manifest extension. Everything else cross-references shipped text.

## Naming — record of decision

The acronym is taken or near-taken in PACT terminology for most candidates:

- ~~Session~~ — taken (§4.4 fabric session-awareness)
- ~~Negotiation~~ — taken (§13 mediated negotiation rounds)
- ~~Fabric~~ — taken (v2.0.3 per-resource workspace)
- ~~Parley~~ — taken (v2.1 ephemeral bilateral)
- **Matter** — **chosen** (2026-05-24). Strong in legal-domain English ("a matter" = case/engagement) and ports cleanly to M&A, procurement, and government engagements. No PACT-internal collision.
- Room (considered) — matched the user-facing "deal room" framing but the maintainer chose Matter.

Schema filenames, event-type stems, REST endpoints, and `$id` paths all key off **Matter** / **matter** / **matters**.

## Open design questions

These remain open after the maintainer's 2026-05-24 calls and need resolution before normative text:

1. **Can a fabric belong to multiple Matters?** Lean: yes (a draft contract may appear in both the M&A Matter and the firm's internal-engagement Matter). Disclosure rules per §17.13 handle the visibility split. Counter-argument: ambiguity in "where does this fabric live."

2. **Member-to-fabric propagation.** When an agent joins a Matter, do they automatically join every attached fabric? Lean: **no** — explicit fabric-level join still required (preserves §15.6 onboarding pattern + §17.13 per-fabric disclosure). Matter membership is *eligibility*, not *automatic enrollment*.

3. **Closure cascade.** Does closing a Matter close the attached fabrics? Lean: **no** — fabrics outlive Matters; closing a Matter detaches and records outcome, fabrics persist independently. (Mirrors how a deal can close while the underlying contract remains active.)

4. **Mediator scope.** If a Matter opts into §13 mediation, can one Mediator span all attached fabrics? Lean: **yes**, that's the point — Matter-scoped mediator is cleaner than per-fabric. Needs §13 amendment to allow Mediator role to be Matter-scoped, not just fabric-scoped.

5. **Cross-Matter references.** Can a Matter reference another Matter (e.g., M&A with sub-engagements)? Lean: **deferred** — single level of grouping for v2.2; nested Matters is a v2.3+ question if the need surfaces.

6. **Authorization-Required tier semantics.** Cross-org Matter membership presumably MUST require valid §17 authorization_proof on join — same rule as cross-org fabric messages. Confirm.

7. **Naming collision risk with "matter" in English.** The word "matter" appears in regular spec prose ("doesn't matter," "what matters"). Normative §-text MUST consistently capitalise "Matter" when referring to the primitive (same pattern v2.0.3 used to introduce "fabric"). A normative Terminology note in the v2.2 §-section would lock this in.

## Conformance impact (proposed)

- **Core**: Matters OPTIONAL. Core implementations may run fabric-only.
- **Extended**: SHOULD support Matters; MUST enforce cross-fabric §17.13 disclosure rules at Matter scope when Matters are advertised in the §15.1 Implementation Profile.
- **Authorization-Required**: cross-organisation Matter membership MUST carry valid §17 authorization_proof at join; cross-Matter messages on the side-channel inherit cross-org §17.9.
- **Runner**: new conformance-runner `kind: matter` for Matter-lifecycle vectors (open → attach → message → manifest → close), following the same fail-closed discipline as the v2.0.4 voice contract and the v2.0.3 `kind: session`.
- **Profile flag**: servers advertise support via `capabilities.matters: true` in the §15.1 Implementation Profile (mirrors v2.0.3's `capabilities.atomicOnboard` and the planned v2.1 `capabilities.parleys`).

## Non-goals

- **NOT a composition primitive.** D2=B settled that. Matters group peer fabrics; they do not introduce weighted parent-child relationships inside a fabric.
- **NOT a chat product.** Side-channel is typed events on the standard PACT event channel. No presence, no typing indicators, no reactions in the wire protocol.
- **NOT cross-server federation.** v2.1+ non-goal (per v2-plan federation_constraints). Matter endpoints MUST NOT preclude federation (portable IDs, canonical JSON transcripts), but federation itself is deferred.
- **NOT multi-fabric merge.** Each fabric remains its own merge boundary. Matters do not introduce cross-fabric atomic transactions.
- **NOT nested Matters.** Single level of grouping for v2.2; nesting is a later question.
- **NOT mandatory.** Matters are an additive primitive. Single-fabric workflows continue to work unchanged.

## Relationship to existing primitives

- **vs. Fabric** — a Matter *contains* fabrics. Fabric stays the unit of negotiation; Matter is the workspace above. Same relationship a file has to a folder.
- **vs. Parley** (v2.1) — Parley is ephemeral, bilateral, one-topic. Matter is long-lived, multi-party, multi-topic. They compose: a Parley may open *within* a Matter (`predecessor_matter_id`) carrying the Matter's context as starting state.
- **vs. §13 Mediator** — Mediator role becomes Matter-scopeable. A Matter with mediation has one Mediator across all attached fabrics; without it, fabrics inside remain unmediated unless individually configured.
- **vs. §17 / §23** — Matter membership IS §17 HumanPrincipals + §23 agentIds. No new identity primitive.

## Next steps (after maintainer triage of open questions 1–7)

1. **GitHub RFC issue** — filed on `TailorAU/pact` with label `rfc`, linking this design record. (Maintainer call 2026-05-24: file now, alongside RFC #14's final comment window.)
2. **Reviewer comment window** — same model as RFC #14 (typically 14 days from issue posting).
3. **Composition contract** — once open-questions converge, draft a synthesis YAML (mirroring `rfc-14-shepherd-synthesis.yaml`) that locks the reuse points (Matter manifest = §4.4 extended, side-channel events = §6 typed events, mediator = §13 Matter-scoped variant, etc.).
4. **v2.2 scope plan** — once v2.1 ships, open `docs/v2-prep/v2.2-scope.yaml` with Matters as the T1 track and any other v2.2-targeted work alongside it.
5. **Normative text** — authored in `spec/v2.2/SPECIFICATION.md` via coordinated PR (AGENTS.md rule 5), then mirrored out via `tools/mirror-spec.ps1 -Version 2.2`.
6. **Schemas** — `matter-create-request.json`, `matter-attach-fabric-request.json`, `matter-message-request.json`, `matter-manifest-response.json`, etc., with `$id` paths under `/v2.2/`.
7. **CLI / MCP coverage (T11 follow-up)** — `pact matter open / attach / detach / message / manifest / close` and corresponding MCP tools.

## Implementation notes (deferred)

- Reference algorithm for cross-fabric manifest extension of §4.4: TBD when this lands as normative.
- Test vectors: would live under `spec/v2.2/conformance/matters/`.
- Mirror PR pattern unchanged (pact-repo canonical → tailor-app via `tools/mirror-spec.ps1`).

---

*This RFC is a design record per AGENTS.md rule 5. No normative text is authored here. Normative text lands in `spec/v2.2/SPECIFICATION.md` via a reviewed coordinated PR, never freehand.*
