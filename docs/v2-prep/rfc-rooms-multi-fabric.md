# RFC: Rooms — multi-fabric deal-room workspaces

> **Status:** RFC draft — design record only, NOT spec text. Per AGENTS.md rule 5, no normative text is freehanded; this exists in `docs/v2-prep/` for Knox sign-off before any spec work begins.
> **Target version:** PACT v2.2 candidate (NOT v2.1 — v2.1 is BLOCKED on RFC #14 with comment window closing 2026-05-26; do not re-scope v2.1).
> **Owner:** Knox Hart.
> **Related decisions:** D2 (2026-05-12, resolved B — see explicit-distinction section below); D5 (2026-05-12, peer-to-peer Sessions with opt-in facilitator).
> **Source:** conversation 2026-05-24 (Knox: "Like a deal room?" — confirmed the structural analogy holds but PACT scopes to one resource; this RFC closes that gap).

## Problem

PACT today scopes a **fabric** to a single resource. Two agents can join one fabric and negotiate over that resource's sections (v2.0.3 onboarding + §4.4 awareness + §10 ICS). v2.1 will add ephemeral **Parleys** for bounded 1-topic agent-to-agent exchanges. Neither shape covers the deal-room case Knox surfaced:

1. **Multi-artifact** — a real "deal" (M&A transaction, legal matter, procurement engagement, multi-document negotiation) consists of N peer artifacts. Term sheet + schedules + diligence binder. Engagement letter + draft contract + retainer schedule. RFP + N bids + negotiation thread. Each is its own PACT resource; today they have no protocol-level grouping.

2. **Side-channel discussion** — deal rooms have a side-thread for free-form coordination ("can we get the financials by Friday?", "I've added a redline to §3"). §13 Mediated Communication exists, but it is per-fabric and structured around protocol primitives (intent, constraint, proposal, objection) routed through a Mediator. It is not designed for casual cross-artifact coordination.

3. **Cross-fabric awareness** — §4.4 manifest is per-fabric only. An agent in a deal cannot ask "where am I across all the artifacts in this matter, and what obligations are pending across them?" — only "where am I in this one fabric."

Concrete examples the current spec does not cleanly serve:

- **M&A**: term sheet (fabric A), diligence binder (fabric B), comms thread, shared participant set across both
- **Legal matter**: engagement letter (fabric A), draft instrument (fabric B), retainer schedule (fabric C), same parties throughout
- **Procurement**: RFP (fabric A), bids (fabrics B/C/D — possibly with information barriers between bidders), negotiation thread with the winning bidder

In all three, the **room** (the workspace + participant set + side-thread) is the load-bearing concept, and the artifacts inside are peers, not parent-child.

## Explicit distinction from D2

D2 was resolved B on 2026-05-12: the **attached-resource model** (parent doc with weighted child docs — Mandatory liability clause, etc.) ships as a Tailor extension, NOT PACT core. This RFC is structurally different and must be evaluated on its own merits, not collapsed onto D2:

| Dimension | D2 (attached-resource, rejected as core) | This RFC (Room) |
|---|---|---|
| Shape | Parent resource with weighted child resources | Container with N peer resources |
| Semantics | Document composition (weight, type) | Workspace grouping (membership, side-channel) |
| New surface | Composition primitives inside a fabric | Container above fabrics; cross-fabric awareness |
| Inside fabric? | Yes (sub-resources within one fabric) | No (fabrics remain independent and unmodified) |
| Domain | Document-domain-specific | Domain-agnostic (M&A, legal, procurement, govt) |

The Room does NOT touch what a fabric is or how it merges. It adds a layer above. If Knox reads this as D2-shape after all, the answer is the same as D2: ship as a Tailor extension. But the case for PACT-core is that cross-fabric obligation tracking, shared participant identity, and side-channel discussion are protocol-level concerns the way §4.4 manifest awareness is.

## Why this aligns with the v2.1 "Contexture" backronym refinement

`docs/v2-prep/v2.1-scope.yaml` records the maintainer decision (2026-05-17) that PACT's expansion becomes "Protocol for Agent **Contexture** and Trust," where Contexture names *"the shared resource (the fabric) and the context that gives it meaning travel[ling] together."* A Room is the natural next layer of contexture: the shared **set** of resources, plus the cross-cutting context (participants, side-thread, obligations) that gives the *set* its meaning. v2.0.3 made one fabric self-aware; v2.1 will add Parleys for ephemeral cross-agent work; v2.2 Rooms would make a *bundle* of fabrics self-aware.

This is not a load-bearing argument for landing the RFC — but it is why the shape feels native rather than bolt-on.

## Proposal

Add a new long-lived primitive — **Room** (working name; see Naming below) — that:

- References N peer fabrics (each unchanged)
- Holds a shared participant set (members are `§23 agentId`s and `§17 HumanPrincipal`s)
- Exposes a typed side-channel for cross-artifact coordination
- Surfaces a cross-fabric manifest (extension of §4.4 to Room scope)
- Has its own lifecycle (`open → active → closed`) independent of constituent fabrics

### Room shape (sketch — not normative)

```jsonc
{
  "room": {
    "id": "room_xyz",
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
      "event_log": "room_xyz/messages"
    },
    "phase": "active",   // open | active | closed
    "opened_at": "...",
    "closes_at": null     // optional TTL
  }
}
```

### Lifecycle (sketch)

```
POST /api/pact/rooms                       open a Room
POST /api/pact/rooms/{id}/members          add a member
POST /api/pact/rooms/{id}/fabrics          attach an existing fabric
DELETE /api/pact/rooms/{id}/fabrics/{rid}  detach a fabric
POST /api/pact/rooms/{id}/messages         post to side-channel (typed event)
GET  /api/pact/rooms/{id}/manifest         caller-scoped cross-fabric manifest
POST /api/pact/rooms/{id}/close            close the Room (does NOT close fabrics)
```

### Event types (sketch)

```
pact.room.opened
pact.room.member-added
pact.room.member-removed
pact.room.fabric-attached
pact.room.fabric-detached
pact.room.message            // the side-channel — typed, hash-chained per §6
pact.room.closed
```

### Side-channel — what it is and isn't

- **Is**: a Room-scoped append-only event log of typed `pact.room.message` entries. Each entry has a sender, timestamp, body, optional `references: { fabric_id, section_id }` link, and is hash-chained per §6.4. Visible to Room members per the same §17.13 disclosure rules used elsewhere.
- **Isn't**: a free-form chat product (no presence, typing indicators, reactions, etc.). The transport is PACT's event channel, not a chat protocol. Implementations can render it as chat in their UI, but the wire format stays typed events.

Rationale: PACT is a protocol, not a messaging product. Side-channel as typed events keeps everything hash-chained, signed-rooted, and auditable — the same posture as every other PACT event.

## Composition with shipped v2.0.x / scoped v2.1

| v2.0.3 / v2.1 surface | How Rooms reuse it |
|---|---|
| §17 trust chain + §23 agent identity | Room members ARE `HumanPrincipal` + `agentId` — no new identity model |
| §4.4 fabric manifest | Room manifest is the §4.4 caller-scoped manifest extended to a *set* of fabrics; same shape, same disclosure rules per §17.13 |
| §4.4.3 heartbeat / attention | Room-scoped heartbeat is straightforward (extend the per-fabric heartbeat to multi-fabric scope) |
| §6 event log + §6.4 hash chain + signed root | The Room event log AND the side-channel inherit §6 wholesale |
| §6.5 pending obligations | Cross-fabric obligation queries become first-class (a Room member can ask "all my pending obligations across this Room" — a §4.4-style query at Room scope) |
| §13 Mediator | If a Room opts in to mediation, ONE Mediator can be Room-scoped, mediating across all attached fabrics rather than per-fabric (cleaner than the per-fabric mediator-per-document model) |
| §17.13 disclosure rules | Apply unchanged — Room-scoped visibility filters are the same as fabric-scoped, just over a wider set of resources |
| v2.1 Parley (when shipped) | A Parley can open *with* a Room as predecessor context — `predecessor_room_id` analogous to the OQ4 `predecessor_parley_id` |

The net new normative surface is: the Room object itself, the attach/detach lifecycle, the typed side-channel event shape, and the cross-fabric manifest extension. Everything else cross-references shipped text.

## Naming

The acronym is taken or near-taken in PACT terminology for nearly every candidate:

- ~~Session~~ — taken (§4.4 fabric session-awareness)
- ~~Negotiation~~ — taken (§13 mediated negotiation rounds)
- ~~Fabric~~ — taken (v2.0.3 per-resource workspace)
- ~~Parley~~ — taken (v2.1 ephemeral bilateral)
- **Room** — matches the user-facing "deal room" framing, generic across domains, no PACT-internal collision. Lean choice.
- **Matter** — strong in legal-domain English ("a matter" = a case/engagement) but narrow outside it
- **Engagement** — consulting-flavored; overloaded with §17 trust language
- **Convene** / **Convening** — verb-flavored; reads awkwardly as a noun
- **Bundle** — too generic; loses the participant + side-channel connotation

Lean: **Room**. Knox to ratify or pick alternative.

## Open design questions

These need Knox sign-off before any normative text.

1. **PACT-core vs Tailor-extension.** The D2 precedent says document-composition is Tailor's problem. Is a Room sufficiently distinct (peer container, not composition) to be PACT-core? Or is the right home a separate Tailor extension repo alongside the attached-resource one?

2. **Can a fabric belong to multiple Rooms?** Lean: yes (a draft contract may appear in both the M&A Room and the firm's internal matter Room). Disclosure rules per §17.13 handle the visibility split. Counter-argument: ambiguity in "where does this fabric live."

3. **Side-channel shape — typed events or also free-form text?** Lean: typed events only (the `pact.room.message` body is structured, optionally rendering as text in a UI). Free-form text-as-payload is fine as a typed event with `body.format: "text"`. Avoid "chat-product" framing.

4. **Member-to-fabric propagation.** When an agent joins a Room, do they automatically join every attached fabric? Lean: no — explicit fabric-level join still required (preserves §15.6 onboarding pattern + §17.13 per-fabric disclosure). Room membership is *eligibility*, not *automatic enrollment*.

5. **Closure cascade.** Does closing a Room close the attached fabrics? Lean: no — fabrics outlive Rooms; closing a Room detaches and records outcome, fabrics persist independently. (Mirrors how a deal can close while the underlying contract remains active.)

6. **Mediator scope.** If a Room opts into §13 mediation, can one Mediator span all attached fabrics? Lean: yes, that's the point — Room-scoped mediator is cleaner than per-fabric. Needs §13 amendment to allow Mediator role to be Room-scoped, not just fabric-scoped.

7. **Cross-Room references.** Can a Room reference another Room (e.g., M&A with sub-matters)? Lean: deferred — single level of grouping for v2.2; nested Rooms is a v2.3+ question if the need surfaces.

8. **Authorization-Required tier semantics.** Cross-org Room membership presumably MUST require valid §17 authorization_proof on join — same rule as cross-org fabric messages. Confirm.

## Conformance impact (proposed)

- **Core**: Rooms OPTIONAL. Core implementations may run fabric-only.
- **Extended**: SHOULD support Rooms; MUST enforce cross-fabric §17.13 disclosure rules at Room scope when Rooms are advertised in the §15.1 Implementation Profile.
- **Authorization-Required**: cross-organisation Room membership MUST carry valid §17 authorization_proof at join; cross-Room messages on the side-channel inherit cross-org §17.9.

## Non-goals

- **NOT a composition primitive.** D2=B settled that. Rooms group peer fabrics; they do not introduce weighted parent-child relationships inside a fabric.
- **NOT a chat product.** Side-channel is typed events on the standard PACT event channel. No presence, no typing indicators, no reactions in the wire protocol.
- **NOT cross-server federation.** v2.1+ non-goal (per v2-plan federation_constraints). Room endpoints MUST NOT preclude federation (portable IDs, canonical JSON transcripts), but federation itself is deferred.
- **NOT multi-fabric merge.** Each fabric remains its own merge boundary. Rooms do not introduce cross-fabric atomic transactions.
- **NOT nested Rooms.** Single level of grouping for v2.2 if it lands; nesting is a later question.
- **NOT mandatory.** Rooms are an additive primitive. Single-fabric workflows continue to work unchanged.

## Relationship to existing primitives

- **vs. Fabric** — a Room *contains* fabrics. Fabric stays the unit of negotiation; Room is the workspace above. Same relationship a file has to a folder.
- **vs. Parley** (v2.1) — Parley is ephemeral, bilateral, one-topic. Room is long-lived, multi-party, multi-topic. They compose: a Parley may open *within* a Room (`predecessor_room_id`) carrying the Room's context as starting state.
- **vs. §13 Mediator** — Mediator role becomes Room-scopeable. A Room with mediation has one Mediator across all attached fabrics; without it, fabrics inside remain unmediated unless individually configured.
- **vs. §17 / §23** — Room membership IS §17 HumanPrincipals + §23 agentIds. No new identity primitive.

## Asks for Knox

These determine whether the RFC progresses at all and in what direction:

1. **Distinct from D2?** Read the explicit-distinction section — is the peer-container shape sufficiently different from attached-resources to be PACT-core, or is this a second Tailor extension?
2. **Naming** — Room (lean), Matter, or other?
3. **Target version** — v2.2 (when v2.1 ships), backlogged behind something else, or never (defer to Tailor extension)?
4. **Side-channel** — typed events only (lean), or is even that too much for PACT-core?
5. **GitHub RFC issue** — file now on `TailorAU/pact` with label `rfc` and link this doc, or sit on the design record until v2.1 lands and revisit?

Open for Knox triage. No spec text, no schemas, no issue filed until Knox signs off on direction.

## Implementation notes (deferred)

- Reference algorithm for cross-fabric manifest extension of §4.4: TBD if/when this lands as normative.
- Test vectors: would live under `spec/v2.2/conformance/rooms/`.
- CLI / MCP coverage: T11 follow-up — `pact room open / attach / detach / message / manifest / close` and corresponding MCP tools.
- Mirror PR pattern unchanged (pact-repo canonical → tailor-app via `tools/mirror-spec.ps1`).

---

*This RFC is a design record per AGENTS.md rule 5. No normative text is authored here. If Knox accepts the direction, the normative text lands in `spec/v2.2/SPECIFICATION.md` via a reviewed coordinated PR, never freehand.*
