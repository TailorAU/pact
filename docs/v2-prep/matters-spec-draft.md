# §24 Matters — multi-fabric deal-room workspaces (DRAFT for v2.2)

> **Status:** DRAFT — not normative, not for citation. This is the §-text
> candidate for a new section in `spec/v2.2/SPECIFICATION.md`.
>
> **Provenance:** authored under the maintainer authorisation 2026-05-24 ("get
> the matter function LIVE"). The accompanying schemas live at
> `docs/v2-prep/matters-schemas/` with `$id` paths under
> `pact-spec.dev/schemas/v2.2-draft/`; conformance vectors at
> `docs/v2-prep/matters-vectors/`. Reference implementation in
> `reference-server/src/matters.ts`, `cli/src/commands/matter.ts`, and the
> `pact_matter_*` tools in `mcp/src/index.ts`.
>
> **Promotion path:** when v2.1 ships (currently BLOCKED on RFC #14, comment
> window to 2026-05-26) and `spec/v2.2/` is properly opened via the carry-
> forward pattern, this draft folds in as §24 (the next available section
> number after the §19–22 Parley/push/service-account block scoped for v2.1
> and the §23 Agent Identity Lifecycle shipped in v2.0). Schemas move to
> `spec/v2.2/schemas/` and `$id` paths update to `/v2.2/`. Vectors move to
> `spec/v2.2/conformance/matters/`.

## 24.1 Problem statement

A v2.0 **Fabric** scopes a negotiation envelope to a single resource. The
v2.1 **Parley** (RFC #14) adds an ephemeral, bilateral, one-topic mode.
Neither shape addresses the case where a single coordinated engagement
spans multiple peer resources and needs:

- A shared participant set across all those resources
- A typed side-channel for cross-resource coordination
- A cross-resource view of "where am I and what do I owe" that fabric-scoped
  §4.4.2 cannot produce on its own

Canonical examples:

- **M&A**: term sheet + diligence binder + comms thread, two parties
- **Legal engagement**: engagement letter + draft instrument + retainer
  schedule, same client and counsel throughout
- **Procurement**: RFP + N bids + negotiation thread with the winning bidder
  (with §17 information barriers between bidders)

## 24.2 Concept

A **Matter** is a long-lived container that:

- References N peer fabrics by `resourceId` (each fabric remains unchanged
  and independently usable)
- Holds a shared participant set (members are `§17` `HumanPrincipal` +
  `§23` `agentId`)
- Exposes a typed event-channel for cross-resource coordination
  (`pact.matter.message`)
- Surfaces a caller-scoped cross-fabric manifest (§24.7), extending §4.4.2
- Has its own lifecycle (`open → active → closed`) independent of the
  attached fabrics' lifecycles

**Terminology note (per maintainer call 2026-05-24).** The primitive is
"Matter" (capitalised when referring to this primitive, lower-case "matter"
in regular English prose). Same disambiguation pattern v2.0.3 §4.4 used to
introduce "fabric". A Matter is NOT:

- A composition primitive — fabrics inside stay independent; this is not
  D2-rejected attached-resource composition
- A chat product — the side-channel is typed events on the standard PACT
  event channel, NOT a free-form chat protocol
- A federation primitive — federation is a v2.1+ non-goal; Matter endpoints
  MUST NOT preclude federation (portable IDs, canonical JSON transcripts)

## 24.3 Membership model

Each Matter has two member roles:

- **owner** — may add/remove members, attach/detach fabrics, post to the
  side-channel, close the Matter. The opener is the first owner.
- **participant** — may post to the side-channel and read the manifest.

Matter membership is **eligibility, not enrollment** (resolves RFC OQ2). A
member of a Matter still needs to join attached fabrics individually via
the §4.4.5 `_onboard` flow. The Matter manifest (§24.7) surfaces
`caller_is_fabric_member: false` for fabrics the caller has not yet joined,
so the caller can see eligibility without it being silently invoked.

A fabric MAY belong to multiple Matters (resolves RFC OQ1). Disclosure rules
per §17.13 handle the visibility split: a caller who is a member of two
Matters that both attach the same fabric sees that fabric in both manifests.

Cross-org membership: at the **Authorization-Required** conformance tier
(§17.9), adding a cross-org member to a Matter MUST carry a valid §17.6
`authorization_proof` from the inviting principal. Same rule as cross-org
fabric messages, applied at Matter scope.

## 24.4 Lifecycle and endpoints

```
phase: open ──→ active ──→ closed
        │         │           │
        │         │           └─ pact.matter.closed; fabrics detach but persist
        │         └─ first member added OR first fabric attached
        └─ pact.matter.opened
```

| Method | Path | §-ref | Description |
|---|---|---|---|
| POST | `/api/pact/matters` | §24.5 | Open a new Matter (caller becomes owner). |
| GET | `/api/pact/matters` | §24.5 | List Matters (additive — implementation MAY require auth scoping). |
| GET | `/api/pact/matters/{id}` | §24.5 | Get a Matter's caller-visible state. |
| POST | `/api/pact/matters/{id}/members` | §24.6 | Add a member (owner-only). |
| POST | `/api/pact/matters/{id}/fabrics` | §24.6 | Attach a fabric (owner-only). |
| DELETE | `/api/pact/matters/{id}/fabrics/{resourceId}` | §24.6 | Detach a fabric (owner-only; fabric persists). |
| POST | `/api/pact/matters/{id}/messages` | §24.8 | Post a typed side-channel message. |
| GET | `/api/pact/matters/{id}/messages` | §24.8 | List the side-channel. |
| GET | `/api/pact/matters/{id}/manifest` | §24.7 | Caller-scoped cross-fabric manifest. |
| POST | `/api/pact/matters/{id}/close` | §24.9 | Close the Matter (owner-only). |

## 24.5 Opening and reading

`POST /api/pact/matters` opens a Matter. The caller becomes the first
member with role `owner`. The body:

```json
{
  "name": "Project Atlas acquisition",
  "opened_by_display": "Knox"
}
```

The response includes the new `matter_id`, `phase: "open"`, and the
emitted `pact.matter.opened` event id. See `matters-schemas/matter-create-request.json`
and `matters-schemas/matter-create-response.json`.

`GET /api/pact/matters/{id}` is gated by §17.13 caller-scoping: a non-member
MUST receive `403 auth.forbidden`.

## 24.6 Attach / detach and member management

Attaching a fabric is **a link, not a merge** — the fabric's members,
constraints, proposals, and events are NOT affected, and the fabric's own
endpoints continue to work independently. The Matter records only the
attachment metadata (when, by whom).

Detaching is symmetric and explicitly does NOT close the underlying fabric
(resolves RFC OQ3). A detached fabric remains queryable directly via its
own `/api/pact/{fabricId}/...` endpoints.

Member management is owner-only. Adding the same principal twice is
idempotent (`added: false` in the response).

## 24.7 Cross-fabric manifest (§24.7)

`GET /api/pact/matters/{id}/manifest` returns a caller-scoped aggregate
view of the Matter — the "where am I across all attached fabrics" answer
that fabric-scoped §4.4.2 cannot produce alone. Shape:

```json
{
  "matter_id": "mtr_xyz",
  "spec_version": "2.2",
  "phase": "active",
  "caller": { "principal_id": "did:web:knox.example", "role": "owner", ... },
  "counterparties": [ /* §17.13 reduced peers */ ],
  "fabrics": [
    {
      "resourceId": "fab_term_sheet",
      "phase": "negotiating",
      "open_proposals": 1,
      "pending_obligation_count_for_caller": 0,
      "caller_is_fabric_member": true,
      ...
    }
  ],
  "pending_obligations_across_fabrics": [
    { "fabric_id": "fab_diligence", "obligation_id": "obl_...", "kind": "respond", ... }
  ],
  "side_channel": { "message_count": 7, "latest_message_at": "..." },
  "snapshot_at": "..."
}
```

**Cross-fabric obligation aggregation** is the load-bearing feature: it
collects every undischarged §6.5 obligation whose `principal_id` matches the
caller across every attached fabric and surfaces them in one list. This is
how a Matter member answers "what do I owe in this engagement" without
manually walking each fabric.

**§17.13 disclosure rules** apply unchanged: counterparties on different
registrable domains (different DID methods, or different eTLD+1 for
did:web) appear with `cross_org: true` and PII (contact, raw constraints)
elided. Fabric-level details (raw constraints, raw obligations) are NOT
included at Matter scope — the caller queries the individual fabric's
`/manifest` for those.

## 24.8 Side-channel — typed events only

The Matter side-channel is an append-only log of `pact.matter.message`
events. Each entry MUST carry:

- `id` — server-minted message id
- `sender_principal` — principal of the poster (a member of the Matter)
- `posted_at` — ISO 8601 timestamp
- `body.format` — currently `"text"`; future formats reserved
- `body.content` — the textual payload
- `references` (optional) — `{ fabric_id, section_id? }` cross-link to an
  attached fabric and optionally a section within it

The wire format is structured (typed events on the PACT event channel, per
§6). Implementations MAY render this as a chat UI; the protocol does NOT
define presence, typing indicators, reactions, threads, or any other chat-
product surface. Future `body.format` values (`proposal-ref`,
`obligation-ref`, etc.) extend the typed-event vocabulary without changing
the envelope.

A non-member MUST receive `403 auth.forbidden` on both `POST` and `GET`
to the messages endpoint. Disclosure boundary: **Matter membership IS the
disclosure boundary for side-channel content** — within a Matter, every
member sees every message. Cross-org content reduction is not applied
inside the side-channel (unlike §4.4.2 for fabric data) because the side-
channel exists precisely to allow cross-org coordination; reducing it would
defeat its purpose. The cross-org boundary is enforced at the
*membership* layer (§17 proof to join), not at the *content* layer.

## 24.9 Closure

`POST /api/pact/matters/{id}/close` is owner-only. It transitions the
Matter to `phase: "closed"`, emits `pact.matter.closed` carrying the
caller-provided `outcome` string (free-form: `"deal-signed"`,
`"walked-away"`, `"engagement-complete"`, etc.) and the list of
`detached_fabrics` (the resourceIds that were attached at closure).

The attached fabrics are **NOT closed** by Matter closure (resolves RFC
OQ3). They persist and remain queryable directly. The Matter records that
they were attached at the time of closure as an audit trail; their
post-closure lifecycle is independent.

A closed Matter accepts no further mutations: `add member`, `attach`,
`detach`, `message`, and re-`close` all return `409 matter.closed`.
Manifest queries on a closed Matter continue to work — closed Matters are
read-historical, not deleted.

## 24.10 Event types

| Event type | Emitted by | Payload fields |
|---|---|---|
| `pact.matter.opened` | open | `matter_id`, `name`, `opened_by` |
| `pact.matter.member-added` | add member | `matter_id`, `added_principal`, `added_role`, `added_by` |
| `pact.matter.fabric-attached` | attach | `matter_id`, `resourceId`, `attached_by` |
| `pact.matter.fabric-detached` | detach | `matter_id`, `resourceId`, `detached_by` |
| `pact.matter.message` | message | `matter_id`, `message_id`, `sender`, `body`, optional `references` |
| `pact.matter.closed` | close | `matter_id`, `closed_by`, `outcome`, `detached_fabrics[]` |

Matter events have their own per-Matter `sequenceNumber` domain (analogous
to fabric events being per-fabric). Cross-cutting integrity rules (hash
chain per §6.4, retention per §6.3) apply at the Matter event log the same
way they do at the fabric event log.

## 24.11 Conformance impact

- **Core**: Matters OPTIONAL. Core implementations MAY remain fabric-only.
- **Extended**: SHOULD support Matters. MUST honour §17.13 reduction on
  `counterparties` in the manifest when Matters are advertised in the
  §15.1 Implementation Profile.
- **Authorization-Required**: cross-organisation Matter membership MUST
  carry valid §17.6 `authorization_proof` at the `POST /members` boundary.

**Profile flag**: servers advertise support via `capabilities.matters: true`
in the §15.1 Implementation Profile (mirrors the v2.0.3
`capabilities.atomicOnboard` and the planned v2.1 `capabilities.parleys`).

**Runner**: a new conformance-runner `kind: matter` handles Matter-lifecycle
vectors (open → attach → message → manifest → close), following the same
fail-closed discipline as the v2.0.4 voice contract.

## 24.12 Open questions

These have been resolved at the leans documented in the RFC for v0.1 but
remain subject to RFC #18 reviewer feedback:

1. **Multiple Matter membership of one fabric** — implemented as allowed
   (OQ1, lean adopted).
2. **Member-to-fabric propagation** — eligibility-only (OQ2, lean adopted).
3. **Closure cascade** — does not cascade (OQ3, lean adopted).
4. **Mediator scope** — implementation defers Mediator-spans-multiple-
   fabrics to a later iteration; v2.2 keeps Mediators per-fabric.
5. **Cross-Matter references** — explicitly deferred to v2.3+.
6. **Authorization-Required tier semantics** — confirmed; cross-org member
   add requires §17.6 proof.
7. **Prose disambiguation** — Terminology note adopted at top of §24.

## 24.13 Migration from v2.0/v2.1

Additive. Implementations remain v2.0-conformant if they ignore the new
endpoints. The §17.6 `authorization_proof` requirement at cross-org member
add is additive at the Authorization-Required tier only.

---

*Promotion of this draft to `spec/v2.2/SPECIFICATION.md` requires explicit
maintainer sign-off per AGENTS.md rule 3. RFC #18 is the public review
vehicle; this draft will fold into the v2.2 carry-forward when that opens.*
