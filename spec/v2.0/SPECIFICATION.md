# PACT — Protocol for Agent Consensus and Truth — Specification v2.0.3

> **Status:** Stable  
> **Author:** Knox Hart + AI  
> **Date:** 15 May 2026  
> **Version:** 2.0.3 (third patch on the v2.0 line; adds **fabric onboarding & session awareness** — the "cognitive layer" of active session: agents can now atomically join+constrain a fabric, query their scoped manifest of obligations, heartbeat bidirectionally, and acknowledge event ranges. Additive — no breaking changes to v2.0 / v2.0.1 / v2.0.2 clients. See [`CHANGELOG.md`](../../CHANGELOG.md#v203--2026-05-15) for the operations added.)  
> **Vision:** Enable millions of agents to reach consensus on shared resources at machine speed, with humans retaining final authority.

### What's New in v2.0.3

PACT v2.0.3 closes the gap between the *registration* layer (an agent is a member of the fabric per the registry) and the *cognitive* layer (the agent's reasoning context actually knows it's in the fabric and is acting under those constraints). v2.0.2 covered join/leave but left "what fabric am I in, who else is here, what do I owe them, what just happened" implicit. v2.0.3 makes it explicit:

- **Active Session Manifest Operations (§4.4)** — five additive operations: `GET /_status` (fabric snapshot), `GET /manifest` (caller-scoped view), `POST /_heartbeat` (bidirectional liveness + attention flagging), `POST /mark-read` (event-range acknowledgement), `POST /_onboard` (atomic join+constrain).
- **Pending Obligations (§6.5)** — first-class concept: what the protocol expects a specific member to do next, surfaced via `/manifest` and `/_status`.
- **Fabric Onboarding Pattern (§15.6)** — recommended flow that eliminates the half-joined window between membership and constraint declaration.
- **Bidirectional heartbeat (§4.1 update)** — v2.0's one-way ping becomes a two-way liveness signal feeding per-member `last_seen`.
- **Manifest visibility (§17.13 update)** — cross-org disclosure rules apply to the new manifest endpoint; it is not a privacy bypass.

The five new operations and six new events are described in §4.4 and §6.5. Onboarding-flow guidance is in §15.6.

### What's New in v2.0

PACT v2.0 extends v1.1 with first-class concepts for **human-authorized actions**: a `HumanPrincipal` abstraction (Section 17) and an **Attestation Format Reference** (Section 18). All v1.1 behavior is preserved; agent-only deployments do not need to implement Sections 17–18 to remain v2.0 conformant at the Core level.

Current additions in this draft:
- **HumanPrincipal** (Section 17) — **strictly 1:1** mapping between a human and a `HumanPrincipal`. Multi-persona models live above the PACT layer. Resolved per issue [#4](https://github.com/TailorAU/pact/issues/4).
- **Attestation Format Reference** (Section 18) — `fido2-assertion` plus a first-class `voice-biometric` credential type. See issue [#3](https://github.com/TailorAU/pact/issues/3).
- **Backward compatibility** — all v1.1 endpoints, schemas, and resource types continue to work unchanged.

Tracked for v2.0 (normative text lands via coordinated PRs — see [`docs/v2-plan.yaml`](../../docs/v2-plan.yaml)): W3C DID principal identity (`did:web` + `did:key` required), an `Authorization-Required` conformance tier, ephemeral negotiation Sessions with handler-signed Mandates (§19–20), push delivery (§21), service-account authentication (§22), agent identity lifecycle (§23), and a conformance test suite.

> Sections 17 and 18 are stub headings — full normative text (fields, signature suites, lifecycle, revocation) lands via coordinated PRs with HMAN / tailor-app per AGENTS.md.

---

### What's New in v1.1 (recap)

PACT v1.1 generalizes the protocol from document-only to **any resource type** — documents, transactions, knowledge claims, clinical records, or any domain where agents need structured consensus. All v1.0 behavior is preserved; documents are the default resource type. The core primitives (join, intent, constrain, propose, object, escalate, done) are unchanged.

Key additions:
- **Resource Types** (Section 14) — implementations declare what kind of resource agents negotiate over
- **Implementation Profiles** (Section 15) — each PACT server advertises supported resource types and apply semantics
- **Conformance Levels** (Section 15) — Core vs Extended compliance tiers
- **Backward compatibility** — proposals without a `type` field default to `"document"`; all v1.0 endpoints continue to work


---

## Quick Start

New to PACT? See **[PACT Getting Started](./PACT_GETTING_STARTED.md)** for a 5-minute walkthrough: authenticate, join a document, and make your first proposal.

**60-second overview:**

```bash
# Join a document (BYOK — invite token, no account needed)
POST /api/pact/{docId}/join-token
  { "agentName": "my-agent", "token": "INVITE_TOKEN" }
  → { registrationId, apiKey, contextMode }

# Read the document
GET /api/pact/{docId}/content → { content, version }

# See section structure
GET /api/pact/{docId}/sections → [{ sectionId, heading, level }]

# Propose a change
POST /api/pact/{docId}/proposals
  { "sectionId": "sec:intro", "newContent": "...", "summary": "..." }
```

---

## 1. Problem Statement

Multi-agent collaboration is moving from human-to-human to **agent-to-agent** at massive scale — not only on documents, but on transactions, knowledge claims, clinical records, and any shared resource requiring structured agreement. Today, no standard protocol exists for agents to:

| Capability | Human Layer | Agent Layer |
|---|---|---|
| Propose changes | Track changes / approvals | **No standard** |
| Declare constraints | Legal/compliance review | **No standard** |
| Approve/reject proposals | Review workflows | **No standard** |
| Real-time coordination | WebSocket / SSE | **No standard** |
| Conflict resolution | Human decides | **No standard** |
| Field-level addressing | Internal refs | **No standard** |

The protocol that defines how agents reach consensus on shared resources becomes the infrastructure layer for every multi-agent framework (LangChain, CrewAI, AutoGen, OpenAI Swarms, etc.).

---

## 2. Design Principles

1. **Resource content format is defined by the resource type.** For documents, the canonical content is renderable Markdown. For transactions, it may be a structured JSON record. For knowledge claims, a fact with evidence. Protocol metadata always lives in the event layer, not in the resource body.

2. **Two layers, one resource.** The Agent Layer (structured operations at machine speed) and the Human Layer (rendered view with natural-language interaction) are projections of the same underlying state.

3. **Agents submit operations, not raw edits.** Agents never directly mutate the resource. They submit typed operations (propose, approve, reject, lock, apply) through the protocol. The server validates and applies them.

4. **Humans always win.** Any human can override any agent decision at any time. Agent autonomy is governed by trust levels, and human escalation is always available.

5. **Event-sourced truth.** The operation log is the source of truth for collaboration state. The resource content is a projection that can be rebuilt from events.

6. **Field-level granularity.** Operations target addressable fields within a resource (document sections, transaction fields, claim attributes), not raw offsets. This keeps the protocol coarse enough for LLMs to reason about.

> **v1.0 note:** In PACT v1.0, "resource" was called "document" and "field" was called "section". These terms are interchangeable for the `document` resource type. All v1.0 endpoints remain valid.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│                    HUMAN LAYER                        │
│  Web UI: rendered Markdown, comment panel, approve/   │
│  reject buttons. Full visibility into Message          │
│  Register. Can inject directives and overrides.        │
├──────────────────────────────────────────────────────┤
│                    MEDIATOR (optional)                 │
│  Routes inter-agent communication. Enforces barriers   │
│  at the routing layer. Summarises, redacts, blocks.    │
│  Maintains the Message Register. (Section 13)          │
│  In unmediated mode, agents interact directly below.   │
├──────────────────────────────────────────────────────┤
│                    PACT API                            │
│  REST + WebSocket endpoints for protocol operations.  │
│  Validates against TrustLevel, enforces locks,         │
│  resolves conflicts, writes events.                   │
├──────────────────────────────────────────────────────┤
│                    AGENT LAYER                         │
│  CLI tools, MCP Server, Direct REST                   │
├──────────────────────────────────────────────────────┤
│                    EVENT STORE + MESSAGE REGISTER      │
│  Append-only event log with protocol events.          │
│  Message Register records all mediated communications. │
│  Source of truth for all collaboration state.          │
├──────────────────────────────────────────────────────┤
│                    DOCUMENT                            │
│  Canonical Markdown content. Always valid, always      │
│  renderable. Updated by server when proposals merge.   │
└──────────────────────────────────────────────────────┘
```

### 3.1 Document Model

A PACT document consists of:

| Component | Description |
|---|---|
| **Content** | Canonical Markdown (`.md`). The current accepted state of the document. |
| **Sections** | Server-parsed section tree from Markdown headings. Each section has a stable `sectionId`. |
| **Operation Log** | Ordered events recording every protocol operation. |
| **Active Proposals** | Pending edit proposals from agents, not yet merged or rejected. |
| **Locks** | Temporary exclusive claims on sections (with TTL). |
| **Agent Registry** | Agents that have joined this document with their roles and trust levels. |

### 3.2 Section Addressing

Sections are identified by a stable `sectionId` derived from heading hierarchy:

```markdown
# Introduction           → sec:introduction
## Background            → sec:introduction/background
## Goals                 → sec:introduction/goals
# Budget                 → sec:budget
## Line Items            → sec:budget/line-items
### Personnel            → sec:budget/line-items/personnel
```

If headings change, the server maintains a mapping from old to new `sectionId` values. Agents always reference sections by ID, never by character offset.

For content outside headings (preamble, top-level paragraphs), a synthetic `sec:_root` section captures everything before the first heading.

---

## 4. Protocol Operations

### 4.1 Agent Lifecycle

| Operation | Description | TrustLevel Required |
|---|---|---|
| `agent.join` | Register as a participant on a document | Observer+ |
| `agent.leave` | Unregister from a document | Any |
| `agent.heartbeat` | Bidirectional liveness signal (v2.0.3+ — feeds per-member `last_seen` in the §4.4 manifest; auto-evicted after 5min silence) | Any |
| `agent.onboard` | (v2.0.3+) Atomic join + constraint declaration — see §4.4 and §15.6 | Observer+ |

**Heartbeat — bidirectional (v2.0.3+).** Through v2.0.2, `agent.heartbeat` was a one-way client→server ping: the agent told the server "I'm still here." v2.0.3 makes the heartbeat **bidirectional**: the server's response carries the fabric's current liveness view (per-member `last_seen` timestamps, the latest event id, and a count of pending obligations for the caller) so the agent immediately knows whether its counterparties are still present. The full request/response shape, the optional `attention_required` flag, and the emitted events (`pact.agent.heartbeat-received`, `pact.agent.attention-required`) are defined in §4.4 under `POST /fabric/{id}/_heartbeat`. The legacy v2.0.2 one-way semantics remain valid (the response body is additive); v2.0.2 clients that ignore the body see no behavioural change.

### 4.2 Read Operations

| Operation | Description | TrustLevel Required |
|---|---|---|
| `document.get` | Get current canonical Markdown content | Observer+ |
| `document.sections` | Get section tree with IDs | Observer+ |
| `proposals.list` | List active proposals | Observer+ |
| `events.subscribe` | Subscribe to real-time event stream | Observer+ |
| `events.history` | Get historical events for a section or document | Observer+ |

### 4.3 Write Operations

| Operation | Description | TrustLevel Required |
|---|---|---|
| `proposal.create` | Propose an edit to a section | Suggester+ |
| `proposal.approve` | Approve another agent's proposal | Collaborator+ |
| `proposal.reject` | Reject a proposal with reason | Collaborator+ |
| `proposal.object` | Object to a proposal (objection-based flow) | Collaborator+ |
| `proposal.withdraw` | Withdraw your own proposal | Suggester+ |
| `intent.declare` | Declare a goal for a section before drafting text | Suggester+ |
| `intent.object` | Object to another agent's declared intent | Collaborator+ |
| `constraint.publish` | Publish a boundary condition on a section | Suggester+ |
| `constraint.withdraw` | Withdraw a previously published constraint | Suggester+ |
| `salience.set` | Set how much you care about a section (0-10) | Observer+ |
| `comment.add` | Add a comment on a section | Suggester+ |
| `comment.resolve` | Mark a comment as resolved | Collaborator+ |
| `section.lock` | Claim exclusive edit on a section (TTL max 60s) | Collaborator+ |
| `section.unlock` | Release a section lock | Collaborator+ |
| `escalate.human` | Flag something for human review | Any |

### 4.4 Active Session Manifest Operations (v2.0.3+)

Through v2.0.2, PACT defined how an agent *registers* with a fabric (§4.1 `agent.join`) but said nothing about how an agent should *know it is in* a fabric — i.e. how its reasoning context comes to hold "I am acting in fabric F with counterparties X and Y, under constraints C, with these pending obligations." v2.0.3 adds five operations that surface this cognitive-layer state and let the agent acknowledge what it has seen.

**Terminology.** "Fabric" is the v2.0.3 term for *a single resource's coordination context* — the set of agents joined to one PACT resource (document, transaction, claim, etc.), plus the constraints, intents, obligations, and events that bind them. The fabric ID equals the resource ID (`{documentId}` in v1.x / v2.0 URL paths); the operations below use `{fabricId}` as a synonym to make the cognitive-layer intent explicit. Either ID form MUST be accepted as the path parameter; this is a naming choice, not a new identifier.

**Convention — `_`-prefixed vs non-prefixed paths.** Per the §15.5 introspection convention, paths beginning with `_` (`/_status`, `/_heartbeat`, `/_onboard`) are **introspection / control-plane** — they read or assert session state without producing a substantive negotiation event. Non-prefixed paths (`/manifest`, `/mark-read`) are **first-class operations** with their own event types and are subject to the usual idempotency and trust-level rules.

| Operation | Method + Path | Purpose | Tier (§15.5) |
|---|---|---|---|
| Fabric status | `GET /api/pact/{fabricId}/_status` | Server's whole-fabric snapshot: members, phase, latest event id, last activity per member. Cross-org disclosure rules of §17.13 apply. | basic |
| Caller manifest | `GET /api/pact/{fabricId}/manifest` | The caller-scoped view: what *this caller* needs to know about the fabric it is in — its constraints, its pending obligations, its visible counterparties. | basic |
| Heartbeat | `POST /api/pact/{fabricId}/_heartbeat` | Bidirectional liveness: agent declares it is present and aware; server returns the fabric's liveness view. Optional `attention_required: true` to flag active presence to counterparties. | basic |
| Mark-read | `POST /api/pact/{fabricId}/mark-read` | Caller acknowledges receipt of an event range `[from_event_id, to_event_id]` so counterparties see "seen" not just "delivered." | basic |
| Atomic onboard | `POST /api/pact/{fabricId}/_onboard` | Atomic join + constraint declaration in a single transaction. Either both commit or neither. See §15.6 for the onboarding flow. | full |

**Verifier ID binding (§17.6).** All five operations are PACT messages and MAY carry an `authorization_proof` envelope. When present, the envelope's `verifier_id` MUST equal the receiving server's DID per §17.7 step 5. At the `Authorization-Required` tier (§17.9), cross-organisation calls to `_onboard` MUST carry a valid `authorization_proof`; the four other operations follow the same rule as their underlying-event counterparts (read endpoints inherit the surrounding read-access rules; `mark-read` is treated as a substantive event and MUST carry proof on cross-org calls).

**Schema references.** Request and response schemas land in `spec/v2.0/schemas/`: `fabric-status.json`, `fabric-manifest.json`, `heartbeat-request.json`, `heartbeat-response.json`, `mark-read-request.json`, `mark-read-response.json`, `onboard-request.json`, `onboard-response.json`, and the shared `pending-obligation.json`. See Appendix A.2.

#### 4.4.1 `GET /api/pact/{fabricId}/_status` — fabric snapshot

Returns a whole-fabric snapshot intended for orchestration tooling, monitoring dashboards, and an agent's "where am I" probe at session start.

**Request.** No body. Optional query parameters:

| Param | Type | Default | Meaning |
|---|---|---|---|
| `include` | csv | `members,phase,latest_event,obligations,activity` | Subset of fields to include. Tools polling for liveness only can pass `include=activity,latest_event` to keep responses small. |

**Response** (matches `fabric-status.json`):

```json
{
  "fabric_id": "doc_xyz",
  "spec_version": "2.0.3",
  "phase": "negotiating",
  "latest_event_id": "evt_5a2c",
  "latest_sequence_number": 412,
  "members": [
    {
      "agent_id": "urn:pact:agent:k-1",
      "agent_name": "Agent-Legal",
      "principal_id": "did:web:knox.example",
      "trust_level": "Collaborator",
      "joined_at": "2026-05-15T18:02:11Z",
      "last_seen": "2026-05-15T18:14:33Z",
      "last_heartbeat_seq": 410,
      "attention_required": false
    }
  ],
  "pending_obligations": [
    { "id": "obl_001", "member_id": "urn:pact:agent:b-1", "kind": "vote", "due_by": "2026-05-15T18:20:00Z", "created_at": "2026-05-15T18:15:00Z", "event_ref": "evt_5a2c" }
  ],
  "open_proposals": 2,
  "open_intents": 1,
  "snapshot_at": "2026-05-15T18:14:40Z"
}
```

The `phase` enum is `forming | negotiating | converged | escalated | closed`. The `members` array is filtered by §17.13 cross-org disclosure rules (see §17.13 "Manifest visibility"); fields the caller is not entitled to see are omitted, not nulled.

**Idempotency.** Pure read; no state change; no event emitted. Safe to retry.

**Errors.** `auth.unauthorized` (401), `agent.not_joined` (403 — non-members get a 403, not a 404, unless the implementation prefers fabric-existence hiding), `document.not_found` (404), `rate.limited` (429).

#### 4.4.2 `GET /api/pact/{fabricId}/manifest` — caller-scoped manifest

Returns the **caller-scoped** view of the fabric — what *this caller* needs to know to act. Where `_status` is global ("here is the whole fabric"), `manifest` is local ("here is what concerns you").

**Request.** No body. The caller is identified by the credentials on the request (per §15.1 endpoints). Optional query parameter `as_of_event_id` returns the manifest as it would have appeared after the given event was processed (for replay debugging).

**Response** (matches `fabric-manifest.json`):

```json
{
  "fabric_id": "doc_xyz",
  "spec_version": "2.0.3",
  "caller": {
    "agent_id": "urn:pact:agent:b-1",
    "agent_name": "Agent-Finance",
    "trust_level": "Collaborator",
    "clearance_level": "Confidential",
    "context_mode": "section-scoped",
    "allowed_sections": ["sec:budget", "sec:risk"]
  },
  "constraints_on_caller": [
    { "constraint_id": "con_42", "section_id": "sec:risk", "boundary": "Must not name specific instruments", "published_by_self": true }
  ],
  "pending_obligations": [
    { "id": "obl_001", "member_id": "urn:pact:agent:b-1", "kind": "vote", "event_ref": "evt_5a2c", "due_by": "2026-05-15T18:20:00Z", "created_at": "2026-05-15T18:15:00Z" }
  ],
  "counterparties": [
    {
      "agent_id": "urn:pact:agent:k-1",
      "agent_name": "Agent-Legal",
      "principal_id": "did:web:knox.example",
      "trust_level": "Collaborator",
      "last_seen": "2026-05-15T18:14:33Z",
      "disclosure_level": "summary"
    }
  ],
  "unread_event_id_from": "evt_5a08",
  "unread_event_id_to": "evt_5a2c",
  "snapshot_at": "2026-05-15T18:14:40Z"
}
```

**Cross-org disclosure (§17.13).** The `counterparties[].principal_id`, `counterparties[].agent_name`, and any other PII fields are subject to the trust model of §17.13's "Manifest visibility" subsection. Counterparties whose disclosure level (per §10.3) is "Constraint" or "Category" are returned with `disclosure_level` set accordingly and PII fields elided. The manifest is NOT a privacy bypass: a caller receives only what they are entitled to see under the normal cross-org and clearance rules.

**Idempotency.** Pure read; no state change; no event emitted.

**Errors.** As §4.4.1. Additionally `auth.forbidden` (403) if the caller is a registered member but the implementation determines the manifest cannot be served (e.g. cleared-out-only mode during a major incident).

#### 4.4.3 `POST /api/pact/{fabricId}/_heartbeat` — bidirectional liveness

The agent declares it is still alive and aware of the fabric. The server records the heartbeat, updates the caller's `last_seen`, and returns the fabric's liveness view.

**Request body** (matches `heartbeat-request.json`):

```json
{
  "client_heartbeat_id": "uuid (caller-chosen; echoed back; idempotency key)",
  "attention_required": false,
  "client_observed_event_id": "evt_5a2c"
}
```

| Field | Required | Description |
|---|---|---|
| `client_heartbeat_id` | Yes | UUID chosen by the caller. The server treats `(member_id, client_heartbeat_id)` as the idempotency key — a duplicate POST within the implementation's idempotency window MUST return the cached prior response and MUST NOT emit a second event. The window SHOULD be at least 60 seconds. |
| `attention_required` | No (default `false`) | When `true`, the caller is signalling "I am actively present and want my counterparty to know it" (e.g. about to send a substantive message). Server MAY emit a `pact.agent.attention-required` event so counterparties can prioritise. |
| `client_observed_event_id` | No | The latest event the caller has processed locally. Implementations MAY use this to surface drift (the caller is behind the server) in the response. |

**Response body** (matches `heartbeat-response.json`):

```json
{
  "fabric_id": "doc_xyz",
  "client_heartbeat_id": "...",
  "server_received_at": "2026-05-15T18:14:33Z",
  "latest_event_id": "evt_5a2c",
  "latest_sequence_number": 412,
  "caller_last_seen": "2026-05-15T18:14:33Z",
  "members_liveness": [
    { "agent_id": "urn:pact:agent:k-1", "last_seen": "2026-05-15T18:14:00Z", "attention_required": false }
  ],
  "pending_obligation_count": 1
}
```

**Verifier ID binding.** When a heartbeat carries an `authorization_proof` (rare; usually heartbeats are bearer-authenticated), the envelope's `verifier_id` MUST equal the server's DID (§17.7).

**Idempotency.** Idempotent over `(member_id, client_heartbeat_id)`. Duplicate within window → cached response, no event.

**Event emitted.** `pact.agent.heartbeat-received` on the first POST of a given `(member_id, client_heartbeat_id)`. Additionally `pact.agent.attention-required` when `attention_required: true`.

**Errors.** `auth.unauthorized`, `agent.not_joined`, `rate.limited` (heartbeat is a common rate-limit target — implementations SHOULD set a generous floor, e.g. 1 Hz per member, and document the rate in their Implementation Profile).

#### 4.4.4 `POST /api/pact/{fabricId}/mark-read` — acknowledge event range

The caller acknowledges that it has received and processed events in the range `[from_event_id, to_event_id]`. Counterparties polling `_status` or `manifest` can see "Agent B has seen up to event evt_5a2c," which is stronger than "the event was delivered to Agent B's transport."

**Request body** (matches `mark-read-request.json`):

```json
{
  "from_event_id": "evt_5a08",
  "to_event_id": "evt_5a2c",
  "from_sequence_number": 400,
  "to_sequence_number": 412
}
```

Either the `_event_id` pair OR the `_sequence_number` pair is sufficient; if both are provided they MUST be consistent (the server MAY reject otherwise). The range is inclusive on both ends.

**Response body** (matches `mark-read-response.json`):

```json
{
  "fabric_id": "doc_xyz",
  "caller_member_id": "urn:pact:agent:b-1",
  "marked_from_sequence_number": 400,
  "marked_to_sequence_number": 412,
  "acknowledged_at": "2026-05-15T18:14:33Z",
  "event_id": "evt_ack_001"
}
```

**Idempotency.** Re-posting the same range is a no-op — the server returns the original `event_id`. Posting a partially-overlapping range advances the caller's read cursor to the new high-water mark and MUST emit only one `pact.agent.mark-read` event (with the union of the prior cursor and the new range).

**Event emitted.** `pact.agent.mark-read`. The event's `payloadJson` carries `{ caller_member_id, marked_from_sequence_number, marked_to_sequence_number }`. Like all v2.0.2+ events, it is chained via `prev_hash` per §6.4.

**Errors.** `auth.unauthorized`, `agent.not_joined`, `mark-read.invalid_range` (the range is malformed or references events outside the fabric — implementations SHOULD define this code under their custom namespace per Appendix A.1).

#### 4.4.5 `POST /api/pact/{fabricId}/_onboard` — atomic join + constrain

The atomic onboarding operation. Bundles the v2.0.2 `agent.join` call with an explicit constraints declaration into a single transaction. **Either both commit, or neither.** Constraint rejection rolls back any partial join state — no half-joined member exists at any observable point. This is the operation that establishes the negotiation envelope *before* any substantive message; see §15.6 for the recommended onboarding flow and why it beats join-then-constrain.

**Request body** (matches `onboard-request.json`):

```json
{
  "agentName": "Agent-Finance",
  "role": "reviewer",
  "contextMode": "section-scoped",
  "protocolVersion": "2.0",
  "orgId": "bridget-co",
  "constraints": [
    { "sectionId": "sec:risk", "boundary": "Must not name specific instruments", "category": "regulatory" },
    { "sectionId": "sec:budget", "boundary": "Must not commit beyond Q3 forecast", "category": "commercial" }
  ],
  "invite_token": "...",
  "authorization_proof": { "...": "§17.6 envelope" }
}
```

The request is the union of `join-request.json` (or `join-token-request.json` for BYOK) and one or more `constraint-request.json` items. All fields of `join-request.json` carry their existing semantics. `constraints` is an array (may be empty for "join only, no constraints declared up front" — the operation is still atomic, just trivially so).

**Atomicity contract (normative).** The server MUST treat the request as a single transaction:

1. Validate the join half (token, identity, capacity).
2. Validate each constraint item against the resource's constraint-acceptance rules (e.g. section exists, boundary is non-empty, caller's clearance permits publishing a constraint on this section).
3. If **any** validation step fails, the server MUST NOT create a registration, MUST NOT publish any constraint, and MUST NOT emit any event. The response is a single `onboard-response` with the failing reason.
4. If all validations pass, the server creates the registration, publishes all constraints, and emits **one** `pact.fabric.onboarded` event whose `payloadJson` references both the new `registrationId` and the `constraintIds` of the published constraints. The individual `pact.constraint.published` events for the bundled constraints MUST be emitted in the same transaction and MUST carry a `correlationId` linking them to the `pact.fabric.onboarded` event.
5. `pact.fabric.onboarded` replaces the bare `pact.agent.joined` event when the onboarding path is taken: implementations MUST NOT emit both `pact.agent.joined` and `pact.fabric.onboarded` for the same registration. Implementations that internally trigger the join logic from `_onboard` MUST suppress the `pact.agent.joined` event in favour of `pact.fabric.onboarded`.

**Response body** (matches `onboard-response.json`) — success case:

```json
{
  "status": "onboarded",
  "fabric_id": "doc_xyz",
  "registration": { "...": "join-response.json shape" },
  "constraints": [
    { "constraint_id": "con_42", "sectionId": "sec:risk", "boundary": "Must not name specific instruments" }
  ],
  "onboarded_event_id": "evt_onb_001",
  "onboarded_at": "2026-05-15T18:02:11Z"
}
```

Rejection case:

```json
{
  "status": "rejected",
  "rejection_reason": "constraint.incompatible",
  "rejected_constraint_index": 1,
  "errors": [
    { "code": "constraint.incompatible", "description": "Constraint on sec:budget conflicts with existing fabric constraint con_18.", "metadata": { "conflicting_constraint_id": "con_18" } }
  ]
}
```

**Verifier ID binding.** Cross-organisation `_onboard` calls at the `Authorization-Required` tier MUST carry a valid `authorization_proof`. The envelope's `verifier_id` MUST equal the server's DID per §17.7 step 5. Inside-org and Core-tier calls follow the existing §17.9 rules.

**Idempotency.** Onboarding is idempotent over the v2.0.2 invite-token / BYOK mechanism it inherits: a duplicate POST with the same single-use token returns the cached registration. A retry that arrives after a previous `_onboard` failed (no registration created) MUST be allowed to succeed — failure does not consume the token.

**Event emitted.** `pact.fabric.onboarded` (one event per successful onboard, even with N bundled constraints). The constraint publications themselves emit their normal `pact.constraint.published` events, each carrying `correlationId = onboarded_event_id`.

**Errors.** `auth.unauthorized`, `agent.already_joined` (409 — onboarding does not replace existing membership; if the caller is already joined and wants to add constraints, they SHOULD use the regular `POST /constraints` endpoint), `constraint.incompatible`, `constraint.invalid`, `invite_token.invalid` / `invite_token.consumed`.

### 4.5 Merge Operations (Server-Side)

These are triggered automatically by the server, not directly by agents:

| Operation | Description | Trigger |
|---|---|---|
| `proposal.merge` | Apply a proposal to the canonical document | Sufficient approvals per policy |
| `conflict.detected` | Two proposals target the same section | Server detects overlap |
| `conflict.resolved` | Conflict resolved (by policy, agent vote, or human) | Resolution action taken |

---

## 5. Proposal Lifecycle

```
                    ┌──────────┐
       create       │          │   withdraw
  ────────────────► │ PENDING  │ ──────────────► WITHDRAWN
                    │          │
                    └────┬─────┘
                         │
              ┌──────────┼──────────┬──────────┐
              │          │          │          │
              ▼          ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
         │APPROVED│ │REJECTED│ │CONFLICT│ │OBJECTED│
         └───┬────┘ └────────┘ └───┬────┘ └────────┘
             │                     │          │
             ▼                     ▼          ▼
        ┌────────┐           ┌──────────┐  Renegotiate
        │ MERGED │           │ RESOLVED │  or escalate
        └────────┘           └──────────┘
             ▲
             │
     TTL expires, no
     objections (auto)
```

### Approval Policy

The number of approvals required before auto-merge is configurable per document:

| Policy | Description |
|---|---|
| `auto` | Merge immediately on creation (for Autonomous trust agents) |
| `single` | One approval from a Collaborator+ agent |
| `majority` | >50% of registered agents approve |
| `unanimous` | All registered agents approve |
| `human-only` | Only a human can approve (agents can only propose) |
| `objection-based` | Auto-merge after TTL unless an agent objects (silence = consent) |

#### Self-approval

By default, the agent that authored a proposal **cannot** count as an approver of it: under `single` / `majority` / `unanimous`, an approval is only counted if the approving agent's `agentId` differs from the proposal author's. This is to keep "one operator running many agents on the same resource" from rubber-stamping its own work.

Resources MAY set a per-resource boolean **`allowSelfApproval`** (default `false`). When `true`, an author's approval of their own proposal counts normally — appropriate for low-stakes resources, or where the operator deliberately wants self-approval and accepts the reduced check.

**Recommendation for multi-agent-under-one-operator deployments** (the common cloud / managed-service case — see issue [#13](https://github.com/TailorAU/pact/issues/13) Q1): rather than flipping `allowSelfApproval`, use the **`objection-based`** policy. It has no approval step at all — proposals auto-merge after TTL unless an agent objects — so the self-approval question simply does not arise. For new agent-to-agent flows that aren't long-lived collaborations, ephemeral **Sessions** (§19–20, when finalised) sidestep it entirely (Sessions have no merge/approve step; outcomes are reported back to each handler).

### Conflict Detection

A conflict is detected when:
- Two pending proposals target the same `sectionId`
- A proposal targets a section that has been modified since the proposal was created (stale base)

Conflict resolution strategies (configurable):
- `first-wins` — earliest proposal by timestamp wins
- `vote` — agents vote on competing proposals
- `human-escalate` — always escalate conflicts to human
- `merge-both` — attempt to merge both changes (LLM-assisted)

---

## 6. Event Schema

### 6.1 Event Structure

Every PACT operation produces an event. Implementations MUST store events with at least these fields:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique event identifier |
| `epochMs` | int64 | Unix timestamp in milliseconds |
| `actorId` | string? | Actor identifier (user or agent) |
| `actorDisplay` | string | Human-readable actor name |
| `actorKind` | enum | `Individual`, `AiAgent`, `GovernanceGroup`, `System` |
| `eventType` | string | Dot-delimited event type (e.g., `pact.proposal.created`) |
| `entityType` | string | `pact-document` |
| `entityId` | UUID | Document identifier |
| `correlationId` | UUID? | Links related events (e.g., create → approve → merge) |
| `inResponseTo` | UUID? | Direct reply chain |
| `sequenceNumber` | int64 | Per-document monotonic counter |
| `sectionId` | string? | Target section (nullable, max 256 chars) |
| `payloadJson` | string | JSON payload with operation-specific data |

### 6.2 Event Types

```
pact.agent.joined              // Agent registered on document
pact.agent.left                // Agent unregistered
pact.proposal.created          // Edit proposal submitted
pact.proposal.approved         // Proposal approved by agent/human
pact.proposal.rejected         // Proposal rejected with reason
pact.proposal.withdrawn        // Proposal withdrawn by author
pact.proposal.merged           // Proposal applied to document (System actor)
pact.proposal.conflict         // Conflict detected (System actor)
pact.proposal.conflict-resolved // Conflict resolved
pact.proposal.objected         // Agent objected to a proposal
pact.proposal.auto-merged      // Proposal auto-merged after TTL with no objections
pact.section.locked            // Section locked by agent
pact.section.unlocked          // Section released
pact.comment.added             // Agent comment on section
pact.comment.resolved          // Comment marked resolved
pact.escalation.human          // Escalated to human review
pact.document.snapshot         // Periodic content snapshot for replay
pact.intent.declared           // Agent declared intent on a section
pact.intent.accepted           // Intent accepted (no objections within TTL)
pact.intent.objected           // Agent objected to an intent
pact.constraint.published      // Agent published a constraint on a section
pact.constraint.withdrawn      // Agent withdrew a constraint
pact.salience.set              // Agent set salience score for a section

// v2.0.3 — Fabric onboarding & session awareness (§4.4, §6.5)
pact.fabric.onboarded           // Atomic join+constrain completed via POST /_onboard (§4.4.5); replaces pact.agent.joined on that path
pact.agent.heartbeat-received   // Bidirectional heartbeat recorded; updates the member's last_seen in the manifest (§4.4.3)
pact.agent.attention-required   // Agent flagged attention_required=true on a heartbeat — counterparties SHOULD prioritise (§4.4.3)
pact.agent.mark-read            // Agent acknowledged a closed event range (§4.4.4)
pact.obligation.created         // Server registered a pending obligation against a member (§6.5)
pact.obligation.discharged      // The targeted member fulfilled (or the obligation otherwise resolved) — see §6.5 for the resolution kinds
```

### 6.3 Event-log retention

The event log is the source of truth for collaboration state (Design Principle 5); the resource is a projection. Removing events breaks the consistency guarantee, so PACT does not define an "events can be deleted on request" mechanism. Instead it defines a **declared retention policy**.

**Requirements.**

- An implementation MUST publish its event-log retention policy in its `/.well-known/pact.json` implementation profile (§15), as a `retentionPolicy` object: `{ "minimumDays": <int>, "indefinite": <bool>, "tombstoneAfter": <int|null> }`. `indefinite: true` means "retained for as long as the resource exists"; `minimumDays` gives a floor when `indefinite` is `false`.
- The spec sets a **RECOMMENDED minimum of 365 days** for resources that carry authorization-relevant content (anything where `authorization_proof` may appear). Regulated domains will commonly need longer (financial: 7 years; clinical: longer still); implementations SHOULD honour the longer of the spec recommendation and any applicable regulatory requirement.
- Personal-data handling within retained events is governed by §17.10. Events SHOULD carry only the `principal_id` (a rotatable / revocable DID) and a salted hash of any proof payload, NOT raw biometric or PII data. Whether the cryptographic-erasure lever in §17.8 (registry tombstone) is sufficient to satisfy a specific jurisdiction's right of erasure for the event log itself is a per-deployment legal question — see §17.10's legal-evaluation requirement.
- An implementation that retains events for less than the recommended minimum SHOULD prominently surface this in its profile (`retentionPolicy.minimumDays < 365` is visible to clients and conformance verifiers).

**Audit-trail consequence.** Cross-org disputes, regulatory audits, and post-incident forensics all depend on the event log. An aggressively short retention policy makes the implementation cheaper to run and cheaper to attack — both of those consequences are the operator's call, but they MUST be a declared call, not an undocumented one.

### 6.4 Event-log integrity (hash-chained + signed root)

Retention (§6.3) tells you how long the event log is kept. Integrity tells you whether you can trust that what's kept is what actually happened. v2.0.2 adds a normative integrity requirement that closes the silent-tampering attack: a compromised server can no longer rewrite or delete past events without that mutation being externally detectable.

**Per-event chaining (REQUIRED at Extended and Authorization-Required; RECOMMENDED at Core).** Every event in the operation log MUST carry an additional `prev_hash` field — a base64url-encoded SHA-256 hash of the *canonical JSON encoding* (RFC 8785) of the immediately preceding event in the same resource's log. The first event (sequenceNumber 0 or 1) uses the literal string `"GENESIS"` as its `prev_hash`. Implementations MUST reject any incoming event whose `prev_hash` does not match the recomputed hash of the prior event.

```json
{
  "id": "evt_abc123",
  "epochMs": 1747276800000,
  "sequenceNumber": 42,
  "eventType": "pact.proposal.merged",
  "entityType": "pact-document",
  "entityId": "doc_xyz",
  "payloadJson": "...",
  "prev_hash": "base64url-sha256(canonical(event 41))"
}
```

**Daily signed root (REQUIRED at Extended and Authorization-Required).** Every 24 hours (or on operator-defined cadence — at minimum once daily), the server MUST emit a `pact.log.root` system event:

```json
{
  "eventType": "pact.log.root",
  "epochMs": ...,
  "payloadJson": "{\"resource_id\":\"doc_xyz\",\"window_start_seq\":1,\"window_end_seq\":42,\"window_end_hash\":\"base64url-...\",\"signature\":\"base64url-...\",\"signing_key\":\"did:web:server.example#log-signing\"}"
}
```

The `signature` is an Ed25519 (or whitelisted alg per §17.6) signature over the canonical encoding of `{resource_id, window_start_seq, window_end_seq, window_end_hash}`. The `signing_key` is advertised in the Implementation Profile (§15.1) as `endpoints.logSigningKey`. The signed root commits the server to "this is what the chain looks like as of this moment"; any later mutation that doesn't replay through new chained events will produce a `prev_hash` mismatch detectable by any consumer with the prior root.

**External transparency anchor (RECOMMENDED at Authorization-Required).** A server claiming `Authorization-Required` SHOULD periodically publish its signed roots to an external append-only log (Certificate Transparency, a public Git-signed-tag repository, a Tor onion-service mirror, etc.). The protocol does not pin a specific anchor mechanism; the requirement is that an external party SHOULD be able to compare the server's claimed history against a copy the server cannot retroactively edit.

**Verification.** A consumer polling for events SHOULD validate each event's `prev_hash` against the prior event's recomputed hash. Implementations MAY cache by `window_end_hash` and only re-validate on each new signed root. A consumer that detects a hash-chain break MUST treat the server as compromised and stop accepting new events from it until reconciled.

**Migration from v2.0 / v2.0.1.** Events emitted before v2.0.2's chaining requirement land in the log without `prev_hash`. Implementations upgrading SHOULD treat the first v2.0.2 event as `prev_hash: "GENESIS-v202"` to mark the transition, and SHOULD emit a `pact.log.root` over the prior history at upgrade time so the legacy events are committed to a signed window even if they're not individually chained.

### 6.5 Pending Obligations (v2.0.3+)

Through v2.0.2, "what does the protocol expect from each member next?" was an inferential question — clients had to scan open proposals, intent TTLs, escalation states, and salience thresholds to compute it. v2.0.3 lifts this into a first-class concept: a **pending obligation** is a thing the protocol expects a specific member to do next. Each obligation is registered as an event in the log and surfaced through §4.4 `_status` and `manifest`.

**Shape** (matches `pending-obligation.json`):

```json
{
  "id": "obl_001",
  "fabric_id": "doc_xyz",
  "member_id": "urn:pact:agent:b-1",
  "kind": "vote",
  "event_ref": "evt_5a2c",
  "created_at": "2026-05-15T18:15:00Z",
  "due_by": "2026-05-15T18:20:00Z",
  "discharged_at": null,
  "discharge_kind": null,
  "discharge_event_ref": null
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Obligation identifier, server-minted. Stable across the obligation's lifecycle. |
| `fabric_id` | string | Yes | The fabric / resource the obligation belongs to. |
| `member_id` | string | Yes | The `agentId` (or registration ID, per implementation convention) expected to act. Exactly one member per obligation; multi-member expectations are modelled as N obligations. |
| `kind` | enum | Yes | `vote` \| `respond` \| `sign` \| `ack` — what kind of action discharges the obligation. See below. |
| `event_ref` | string | Yes | The event that **created** the obligation (e.g. the `pact.proposal.created` event for which a vote is owed). The event is the obligation's source-of-truth context. |
| `created_at` | ISO 8601 | Yes | When the obligation was registered. |
| `due_by` | ISO 8601 | No | Optional deadline. After this, the obligation MAY be flagged in the manifest as `overdue: true` (the implementation chooses whether to auto-escalate). Absent → no implicit deadline. |
| `discharged_at` | ISO 8601 | No | When the obligation was resolved. `null` while pending. |
| `discharge_kind` | enum | No | How it was discharged: `fulfilled` (the member acted), `superseded` (a later event made it moot — e.g. the proposal was withdrawn), `timed_out` (the `due_by` passed and the implementation auto-resolved), `escalated` (the obligation was rolled up into a `pact.escalation.human` event). |
| `discharge_event_ref` | string | No | The event that discharged the obligation. |

**Obligation kinds.**

| Kind | Created when | Discharged when |
|---|---|---|
| `vote` | A proposal targets a section the member has non-zero salience on (or the approval policy requires the member's vote). | The member emits `proposal.approve`, `proposal.reject`, or `proposal.object`. Also discharged when the proposal is withdrawn (`discharge_kind = "superseded"`). |
| `respond` | A `query.submit` (§13.5.2) or `escalate.human` targets this member. | The member emits the matching response event. |
| `sign` | A commit / merge requires the member's signature (e.g. an `authorization_proof`-bearing merge). | The member's signature lands in the event log. |
| `ack` | A counterparty's substantive event (proposal, escalation, mediated message) was delivered to this member and the implementation requires acknowledgement before further state advances. | The member calls `POST /mark-read` covering the source event, or otherwise acts on it. |

**Event semantics.** Two new event types:

- **`pact.obligation.created`** — emitted whenever the server registers a new pending obligation. The event's `payloadJson` carries the full `pending-obligation.json` shape with `discharged_at = null`. `correlationId` MUST point to the creating event (the proposal, query, escalation, etc.) so a consumer can trace `creating event → obligation → discharge event` as a single chain. The `actorKind` for this event is `System`.
- **`pact.obligation.discharged`** — emitted when an obligation resolves. The event's `payloadJson` carries the obligation's final state with `discharged_at`, `discharge_kind`, and `discharge_event_ref` populated. `correlationId` MUST equal the `pact.obligation.created` event's `id`. `inResponseTo` MAY point to the discharging event for ergonomics.

**Surfacing in operations.** Both `GET /_status` and `GET /manifest` (§4.4) include a `pending_obligations` array using the `pending-obligation.json` shape. `_status` includes all pending obligations across the fabric (filtered by cross-org disclosure — a counterparty's obligation visibility follows §17.13 rules); `manifest` includes only the caller's own pending obligations plus a `counterparties[].pending_obligation_count` summary.

**Conformance.** Pending obligations are RECOMMENDED at Core and SHOULD be emitted at Extended and Authorization-Required. An implementation that does not emit obligation events MUST omit the `pending_obligations` field from `_status` and `manifest` rather than returning a stub empty array (so consumers can detect non-support).

**Backward compatibility.** v2.0.2 clients that ignore the new event types and the manifest endpoint see no behavioural change — the existing proposal / intent / escalation lifecycle continues to work without obligation events, and the inferential model of v2.0.2 remains valid.

---

## 7. API Surface

### 7.1 REST Endpoints

All implementations MUST expose these endpoints (or equivalent):

```
POST   /api/pact/{documentId}/join                    // Agent joins document
DELETE /api/pact/{documentId}/leave                   // Agent leaves document
GET    /api/pact/{documentId}/content                 // Get canonical Markdown
GET    /api/pact/{documentId}/sections                // Get section tree
GET    /api/pact/{documentId}/agents                  // List active agents
POST   /api/pact/{documentId}/proposals               // Create proposal
GET    /api/pact/{documentId}/proposals               // List active proposals
POST   /api/pact/{documentId}/proposals/{id}/approve  // Approve proposal
POST   /api/pact/{documentId}/proposals/{id}/reject   // Reject proposal
DELETE /api/pact/{documentId}/proposals/{id}           // Withdraw proposal
POST   /api/pact/{documentId}/sections/{sectionId}/lock    // Lock section
DELETE /api/pact/{documentId}/sections/{sectionId}/lock    // Unlock section
POST   /api/pact/{documentId}/comments                // Add comment
POST   /api/pact/{documentId}/escalate                // Escalate to human
GET    /api/pact/{documentId}/events                  // Event history (paginated)
POST   /api/pact/{documentId}/intents                 // Declare intent on a section
GET    /api/pact/{documentId}/intents                 // List intents
POST   /api/pact/{documentId}/intents/{id}/object     // Object to an intent
POST   /api/pact/{documentId}/constraints             // Publish a constraint
GET    /api/pact/{documentId}/constraints             // List constraints
DELETE /api/pact/{documentId}/constraints/{id}         // Withdraw a constraint
POST   /api/pact/{documentId}/salience                // Set salience score
GET    /api/pact/{documentId}/salience                // Get salience heat map
POST   /api/pact/{documentId}/proposals/{id}/object   // Object to a proposal

// Fabric onboarding & session awareness (v2.0.3 — §4.4)
GET    /api/pact/{documentId}/_status                  // Whole-fabric snapshot
GET    /api/pact/{documentId}/manifest                 // Caller-scoped view (constraints, obligations, counterparties)
POST   /api/pact/{documentId}/_heartbeat               // Bidirectional liveness + attention flag
POST   /api/pact/{documentId}/mark-read                // Acknowledge an event range
POST   /api/pact/{documentId}/_onboard                 // Atomic join + constraint declaration

// PACT Live Endpoints (v0.3)
GET    /api/pact/{documentId}/poll                    // Poll events with cursor-based pagination
POST   /api/pact/{documentId}/ask-human               // Submit question to human custodian
GET    /api/pact/{documentId}/human-responses          // List human queries/responses
POST   /api/pact/{documentId}/human-responses/{queryId}/respond  // Respond to human query
POST   /api/pact/{documentId}/done                    // Declare agent completion
GET    /api/pact/{documentId}/completions             // List agent completions
POST   /api/pact/{documentId}/resolve                 // Submit human resolution
GET    /api/pact/{documentId}/escalation-briefing/{escalationId}  // Get escalation constraint briefing
POST   /api/pact/{documentId}/pre-validate            // Preview resolution against constraints
GET    /api/pact/{documentId}/cascade-status           // Get cascade validation status
POST   /api/pact/{documentId}/cascade-validate         // Submit cascade validation result
```

### 7.2 Real-Time Events

Implementations SHOULD provide a real-time event channel (WebSocket, SignalR, SSE, or equivalent) with per-document subscription:

```
// Server → Client events
OnProposalCreated(documentId, proposalId, agentId, sectionId, summary)
OnProposalApproved(documentId, proposalId, approverId)
OnProposalRejected(documentId, proposalId, rejecterId, reason)
OnProposalMerged(documentId, proposalId, newVersion)
OnConflictDetected(documentId, conflictId, proposalIds[])
OnSectionLocked(documentId, sectionId, agentId, expiresAt)
OnSectionUnlocked(documentId, sectionId)
OnEscalation(documentId, sectionId, agentId, message)
OnDocumentUpdated(documentId, newVersion, changedSections[])
OnIntentDeclared(documentId, intentId, agentId, sectionId, goal)
OnIntentObjected(documentId, intentId, objecterId, reason)
OnConstraintPublished(documentId, constraintId, agentId, sectionId, boundary)
OnSalienceChanged(documentId, agentId, sectionId, score)
OnProposalObjected(documentId, proposalId, objecterId, reason)
OnAutoMergeScheduled(documentId, proposalId, mergeAt)

// PACT Live events (v0.3)
OnHumanAsked(documentId, queryId, agentId, agentName, question, sectionId, timeoutAt)
OnHumanResponded(documentId, queryId, responderId, agentId, agentName)
OnAgentCompleted(documentId, completionId, agentId, agentName, status, summary)
OnHumanResolved(documentId, resolutionId, sectionId, decision, isOverride)
OnCascadeValidated(documentId, resolutionId, agentRegistrationId, result, cascadeStatus)

// Fabric onboarding & session awareness events (v2.0.3 §4.4 / §6.5)
OnFabricOnboarded(documentId, principalId, agentId, role, correlationId)
OnHeartbeatReceived(documentId, principalId, agentId, attentionRequired, observedAt)
OnAttentionRequired(documentId, principalId, agentId, reason, observedAt)
OnMarkRead(documentId, principalId, fromEventId, toEventId, observedAt)
OnObligationCreated(documentId, obligationId, memberId, kind, eventRef, dueBy)
OnObligationDischarged(documentId, obligationId, memberId, kind, dischargedAt)
```

### 7.3 MCP Tools

Implementations MAY expose PACT operations as MCP (Model Context Protocol) tools for LLM-native integration:

```json
{
  "tools": [
    { "name": "pact_join", "description": "Register as a PACT agent on a document" },
    { "name": "pact_leave", "description": "Unregister from a document" },
    { "name": "pact_agents", "description": "List active agents on a document" },
    { "name": "pact_done", "description": "Signal agent completion" },
    { "name": "pact_get", "description": "Get document content as Markdown" },
    { "name": "pact_sections", "description": "Get document section tree" },
    { "name": "pact_propose", "description": "Propose an edit to a document section" },
    { "name": "pact_proposals", "description": "List proposals (filter by section/status)" },
    { "name": "pact_approve", "description": "Approve a pending proposal" },
    { "name": "pact_reject", "description": "Reject a pending proposal" },
    { "name": "pact_object", "description": "Object to a pending proposal (soft dissent)" },
    { "name": "pact_escalate", "description": "Escalate to human review" },
    { "name": "pact_ask_human", "description": "Ask a question requiring human judgement" },
    { "name": "pact_intent_declare", "description": "Declare an intent (goal) on a section" },
    { "name": "pact_intents", "description": "List intents on a document" },
    { "name": "pact_constraint_publish", "description": "Publish a boundary constraint on a section" },
    { "name": "pact_constraints", "description": "List constraints on a document" },
    { "name": "pact_salience_set", "description": "Set salience score (0-10) for a section" },
    { "name": "pact_salience_map", "description": "Get salience heat map for a document" },
    { "name": "pact_poll", "description": "Poll for events since a cursor" },
    { "name": "pact_lock", "description": "Lock a section for editing" },
    { "name": "pact_unlock", "description": "Unlock a section" },

    // Fabric onboarding & session awareness (v2.0.3 §4.4 / §15.6)
    { "name": "pact_onboard", "description": "Atomically onboard into a fabric — declare constraints up-front; either admitted with constraints recorded or rejected with no membership created" },
    { "name": "pact_status", "description": "Snapshot a fabric (phase, members, latest event id, pending obligations) — or, if no id given, return a local-state summary of every fabric this agent is in" },
    { "name": "pact_manifest", "description": "Fetch the caller-scoped active-session manifest for a fabric and cache it for pact_session_announce" },
    { "name": "pact_transcript", "description": "Fetch the event log for a fabric since an optional event id; optionally ack the printed range via /mark-read" },
    { "name": "pact_heartbeat", "description": "Fire a one-shot heartbeat to signal liveness on a fabric; optionally mark attention_required" },
    { "name": "pact_mark_read", "description": "Acknowledge a transcript event range on the server (standalone alternative to the pact_transcript mark_read flag)" },
    { "name": "pact_session_announce", "description": "COGNITIVE-LAYER HOOK — returns a 'you are in N fabrics with M obligations' payload for the calling LLM to prepend to its working context. Offline by default; use refresh_manifests=true for live data" }
  ]
}
```

---

## 8. Multi-Format Document Support

### 8.1 Supported Formats

PACT supports multiple document formats. The server parses each format into a unified section tree with stable `sectionId` values:

| Format | MIME Type | Section Parser | Storage |
|--------|-----------|----------------|---------|
| Markdown | `text/markdown` | ATX headings (`#`, `##`) | Raw `.md` file |
| HTML | `text/html` | `<h1>`–`<h6>` tags | Raw `.html` file |
| DOCX | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Word heading styles (Heading1–6) | Binary `.docx` + text projection |
| PDF | `application/pdf` | Via DOCX conversion | Binary `.pdf` + text projection |

All formats produce the same `sec:slug/child-slug` section IDs. Agents interact with any format using the same commands and API endpoints.

### 8.2 Section Parsing Rules

```
# Heading 1              → Level 1 section
## Heading 2             → Level 2 section (child of nearest L1)
### Heading 3            → Level 3 section (child of nearest L2)

Content between headings belongs to the section above it.
Content before the first heading belongs to sec:_root.

---                      → Horizontal rules are visual only, not section boundaries
> Blockquotes            → Part of the enclosing section
- List items             → Part of the enclosing section
```

### 8.3 Proposal Diff Format

When an agent proposes an edit, the proposal contains:

```json
{
  "sectionId": "sec:budget/line-items",
  "baseVersion": 47,
  "newContent": "## Line Items\n\nThe projected cost is $450,000.\n\n- Personnel: $300,000\n- Infrastructure: $100,000\n- Contingency: $50,000\n",
  "summary": "Reduced total budget by $50k, added line item breakdown",
  "reasoning": "Per compliance review, budget must include itemized breakdown"
}
```

The server computes the diff between current section content and `newContent`. Both the diff and the full new content are stored.

---

## 9. Human Layer Integration

### 9.1 Web UI

Implementations SHOULD provide a human-facing UI with:

- **Document view:** Rendered Markdown with section highlighting
- **Activity sidebar:** Timeline of agent proposals, approvals, comments
- **Proposal review:** Inline diff view for each proposal, with Approve/Reject buttons
- **Conflict panel:** Side-by-side competing proposals with resolution options
- **Agent dashboard:** List of active agents, their roles, trust levels, activity stats

### 9.2 Human Overrides

At any point, a human can:

- **Approve/reject any proposal** (overrides agent votes)
- **Edit the document directly** (creates a `pact.proposal.merged` event with `ActorKind = Individual`)
- **Change an agent's trust level** (upgrades/downgrades autonomy)
- **Remove an agent** (force `agent.leave`)
- **Change approval policy** (e.g., switch from `majority` to `human-only`)
- **Lock the entire document** (freeze all agent activity)

### 9.3 Activity Summary

Instead of showing every protocol event, the human view shows summaries:

> **12 agents** active on this document.  
> **3 proposals** pending your review.  
> **1 conflict** between Agent-Legal and Agent-Finance on §Budget.  
> **47 changes** merged in the last hour.  
> Last human review: 2 hours ago.

---

## 10. Intent-Constraint-Salience Protocol

### 10.1 Design Rationale

The propose → vote model forces agents to produce finished text before discovering alignment. This creates unnecessary latency: an agent writes 500 words, submits a proposal, waits for N approvals, and only then discovers another agent disagrees with the *goal*, not the wording.

Intent-Constraint-Salience (ICS) introduces three lightweight primitives that **minimize latency to alignment**:

| Primitive | What it captures | Why it's fast |
|---|---|---|
| **Intent** | *What* an agent wants to achieve on a section | Align on goals before writing text |
| **Constraint** | Boundary conditions — what must or must not happen | Share limits without revealing confidential reasoning |
| **Salience** | How much an agent cares about a section (0-10) | Route attention to real disagreements, skip busywork |

Plus **objection-based merge**: proposals auto-merge after a configurable TTL unless someone actively objects. This replaces the "everyone must approve" model where silence creates deadlock.

### 10.2 Intent Lifecycle

An intent declares a goal on a section *before* text is written.

```
                    ┌───────────┐
      declare       │           │   supersede (new intent on same section)
  ─────────────────►│ PROPOSED  │ ──────────────────────────► SUPERSEDED
                    │           │
                    └─────┬─────┘
                          │
               ┌──────────┴──────────┐
               │                     │
               ▼                     ▼
         ┌──────────┐         ┌──────────┐
         │ ACCEPTED │         │ OBJECTED │
         └──────────┘         └──────────┘
              │                     │
              ▼                     ▼
        Agent drafts           Renegotiate
        proposal text          or escalate
```

- **Proposed** — Intent declared, awaiting alignment from other agents
- **Accepted** — No objections within TTL; the agent proceeds to draft text
- **Objected** — At least one agent objects to the goal itself
- **Superseded** — Replaced by a newer intent on the same section by the same author

### 10.3 Constraint Model

Constraints express boundary conditions without revealing confidential reasoning:

| What a constraint says | What it does NOT say |
|---|---|
| "Liability cap must not exceed $2M" | *Why* (e.g. insurance policy terms) |
| "Must reference hedging policy" | *Which* hedging policy or its contents |
| "Must not name specific instruments" | *Why* naming them is problematic |

This enables agents with confidential context (legal, compliance, commercial) to participate in alignment without exposing sensitive information.

**Graduated Disclosure Levels:**

| Level | What is shared | When |
|---|---|---|
| 1. Constraint | Boundary only — "must not exceed $2M" | Default |
| 2. Category | Category tag — "regulatory" | On request |
| 3. Reasoning | Full rationale (confidential) | Escalation only |
| 4. Human | Human reviewer sees everything | Manual override |

### 10.4 Salience Scoring

Each agent assigns a salience score (0–10) to each section:

| Score | Meaning | Effect |
|---|---|---|
| 0 | Don't care | Agent is excluded from voting on this section |
| 1–3 | Low interest | Agent receives notifications but auto-consents |
| 4–6 | Moderate interest | Agent reviews proposals within standard TTL |
| 7–9 | High interest | Agent is prioritized as reviewer/drafter |
| 10 | Critical | Agent MUST review; proposals cannot auto-merge without explicit action |

**Routing logic:** When intents align and constraints are compatible, the agent with the highest salience score on a section is invited to draft the proposal text. Ties are broken by registration order.

**Heat map:** The salience map provides a document-wide view of which agents care about which sections, enabling the system to identify:
- Sections with concentrated interest → potential conflict zones
- Sections with no interest → safe for auto-merge
- Agent pairs with overlapping high salience → coordination needed

### 10.5 Objection-Based Merge

The traditional `propose → approve → merge` model is replaced with:

```
Agent A: proposal.create(section, content, ttl=60)
         ┌──────────────────────────────────────┐
         │  TTL window (60 seconds by default)   │
         │                                        │
         │  Any agent can: proposal.object(id,    │
         │    reason="Violates constraint X")     │
         │                                        │
         └──────────────────────────────────────┘
                    │                    │
            No objections          Objection raised
                    │                    │
                    ▼                    ▼
              AUTO-MERGED            OBJECTED
            (silence = consent)    (must renegotiate)
```

**Key rules:**
- Default TTL is 60 seconds; configurable per document or per proposal
- Agents with salience = 0 on the target section are excluded from the TTL window
- Agents with salience = 10 (critical) **must** explicitly approve or object; auto-merge is blocked
- If no agents have salience > 0 on a section, the proposal merges immediately
- The `ObjectionBased` approval policy enables this flow

### 10.6 Example Flow

Two agents collaborate on a contract's risk section:

```
Agent-Legal:     intent.declare(sec:risk, "Need currency risk language")
                 salience.set(sec:risk, 8)
                 constraint.publish(sec:risk, "Must reference hedging policy")

Agent-Finance:   salience.set(sec:risk, 6)
                 constraint.publish(sec:risk, "Must not name specific instruments")

System:          Constraints compatible ✓
                 Highest salience: Agent-Legal (8)
                 → Agent-Legal invited to draft

Agent-Legal:     proposal.create(sec:risk, newContent, ttl=60)

                 [60 seconds pass, no objections from Agent-Finance]

System:          proposal.auto-merged ✓
```

If Agent-Finance had objected:

```
Agent-Finance:   proposal.object(proposalId, "Names instrument XYZ — violates my constraint")

System:          proposal.status → Objected
                 → Both agents see the objection reason
                 → Agent-Legal revises and creates a new proposal
```

### 10.7 Salience abstention timeout (v2.0.2+)

Salience scores have the right shape as coordination signals but can be misused as authority constraints — an agent that sets salience=10 (critical) on a section and then abstains can indefinitely block auto-merge. v2.0.2 introduces an explicit abstention rule:

- An agent that declares `salience >= 7` on a section MUST respond to any proposal targeting that section within `abstention_ttl` (default: 4× the proposal's normal TTL, configurable per resource). A response is any of: `proposal.approve`, `proposal.object`, or `proposal.review-noted` (a new no-op event indicating "I saw it; no objection, no approval").
- An agent that has not responded by `abstention_ttl` is **auto-demoted to salience=5** on that section for the remainder of the proposal's lifecycle. The auto-demotion is recorded as a `pact.salience.auto-demoted` event with the original score, the new score, and the proposal that triggered the demotion. After the proposal concludes, the agent's declared salience returns to its pre-demotion value.
- Salience=10 agents that auto-demote three times consecutively on the same resource SHOULD trigger a `pact.escalation.human` event (operator review of whether the agent is functioning correctly).

This is non-breaking: in the cooperative case nothing changes. The rule only fires when an agent is asserting high authority without exercising it — which is the abuse case salience-as-constraint was conflating.

---

## 11. Trust Levels

| Level | Can do |
|---|---|
| `Observer` | Read content, sections, events. Set salience. |
| `Suggester` | All Observer permissions + propose, declare intent, publish constraints. |
| `Collaborator` | All Suggester permissions + approve, reject, object, lock sections. |
| `Autonomous` | All Collaborator permissions + proposals auto-merge (bypass approval policy). |

Trust levels are assigned by the document owner or an administrator.

---

## 12. Success Metrics

| Metric | Target |
|---|---|
| Agent can propose an edit | < 100ms API response |
| Proposal broadcast to other agents | < 500ms via real-time channel |
| Conflict detected and flagged | < 1s after second proposal |
| Human can see agent activity summary | Real-time in web UI |
| 100 agents on one document | No degradation |
| 1000 proposals per document | Queryable in < 200ms |
| Document always renderable | No invalid Markdown state, ever |

---

## 13. Mediated Communication

### 13.1 Design Rationale

In Sections 1–12, agents communicate by *observing each other's side effects*: reading proposals, polling events, inspecting intents and constraints. The information barrier system (classification, clearance, filtering) is applied defensively at every endpoint — content is filtered after retrieval, proposals are blocked after submission, cross-pollination is caught at merge time.

This works, but it treats agent isolation as a secondary concern bolted onto a peer-to-peer model. Mediated Communication inverts the model: **agents never observe each other directly.** All inter-agent information flows through a Mediator — a trusted intermediary that controls what is shared, summarised, redacted, or blocked.

The analogy is a courtroom register: parties submit documents to the clerk, not to each other. The judge (human) sees everything. The clerk enforces procedural rules. No party can address another party directly.

### 13.2 The Mediator Role

The **Mediator** is a protocol-level role, not a specific product. Any compliant implementation can serve as the Mediator. In the reference implementation, Tailor fills this role.

The Mediator:

| Responsibility | Description |
|---|---|
| **Message routing** | Receives all inter-agent messages; decides what reaches each recipient |
| **Content gating** | Enforces classification and clearance at the routing layer, not per-endpoint |
| **Summarisation** | May condense or abstract messages before forwarding (e.g. "Agent-Legal has a constraint on §Risk" without revealing the constraint text) |
| **Redaction** | Strips classified content from messages crossing clearance boundaries |
| **Negotiation facilitation** | Structures multi-round exchanges between agents on contested sections |
| **Audit logging** | Every mediation decision is recorded in the event store |
| **Human transparency** | The human custodian can inspect the full unmediated register at any time |

A Mediator implementation MAY be:
- **Rules-based** — pure routing and filtering using classification metadata
- **LLM-powered** — capable of summarising, paraphrasing, and abstracting content across clearance boundaries
- **Hybrid** — rules for hard barriers, LLM for summarisation

### 13.3 Communication Model

Agents interact with the Mediator, never with each other:

```
┌─────────────────────────────────────────────────────────┐
│                     HUMAN LAYER                          │
│   Full visibility into the Message Register.             │
│   Can inject directives, override routing, respond       │
│   to escalations.                                        │
├─────────────────────────────────────────────────────────┤
│                     MEDIATOR                             │
│   Routes messages between agents.                        │
│   Enforces classification, summarises, redacts.          │
│   Maintains the Message Register (append-only).          │
│   Facilitates structured negotiation rounds.             │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Agent A  │ Agent B  │ Agent C  │ Agent D  │  ...        │
│ (Public) │ (Conf.)  │ (HC)     │ (Public) │             │
└──────────┴──────────┴──────────┴──────────┴─────────────┘

  Agent A ──message──→ Mediator ──(filtered)──→ Agent B
  Agent B ──response──→ Mediator ──(summarised)──→ Agent A
  Human   ──directive──→ Mediator ──(broadcast)──→ All agents
```

Agents cannot:
- Address another agent directly
- Read another agent's raw messages without mediation
- Discover which agents exist (unless the Mediator reveals this)
- Infer another agent's clearance level from message content

### 13.4 Message Register

The Message Register is an append-only log of all mediated communications, distinct from the event store (which records protocol operations). Every entry records both the original message and what was actually delivered.

| Field | Type | Description |
|---|---|---|
| `messageId` | UUID | Unique identifier |
| `epochMs` | int64 | Timestamp |
| `senderId` | UUID | Agent registration ID of the sender |
| `recipientId` | UUID? | Target agent (null = broadcast) |
| `sectionId` | string? | Section context (if applicable) |
| `originalContent` | string | What the sender wrote (stored, never forwarded raw) |
| `deliveredContent` | string? | What the recipient received (after mediation) |
| `mediationAction` | enum | `forwarded`, `summarised`, `redacted`, `blocked`, `held` |
| `mediationReason` | string? | Why this action was taken (e.g. "clearance mismatch") |
| `classificationLevel` | string? | Classification of the original content |

The human custodian can read the full register including `originalContent` for all messages. Agents can only read their own sent messages and messages delivered to them.

### 13.5 Mediated Primitives

#### 13.5.1 Messages

Point-to-point or broadcast communication between agents, routed through the Mediator.

| Operation | Description |
|---|---|
| `message.send` | Agent submits a message targeting another agent or all agents |
| `message.inbox` | Agent polls for messages routed to them |
| `message.ack` | Agent acknowledges receipt of a message |

The Mediator decides for each message:
1. Does the sender have clearance to discuss this section/topic?
2. Does the recipient have clearance to receive this content?
3. Should the content be forwarded verbatim, summarised, or blocked?

#### 13.5.2 Queries

Structured question-and-answer exchanges, where the Mediator controls disclosure.

| Operation | Description |
|---|---|
| `query.submit` | Agent asks a question about another agent's intent, constraint, or position |
| `query.route` | Mediator forwards the question (possibly rephrased) to the target agent |
| `query.respond` | Target agent responds; Mediator filters the response before delivery |
| `query.answer` | Sender receives the mediated response |

Queries support the graduated disclosure model from Section 10.3:
- Level 1: Mediator answers from metadata alone ("Agent-Legal has a constraint on §Risk")
- Level 2: Mediator forwards a summary ("The constraint relates to regulatory compliance")
- Level 3: Mediator forwards the full text (requires matching clearance)
- Level 4: Escalate to human (human decides what to share)

#### 13.5.3 Negotiation Rounds

Structured multi-round exchanges on contested sections, facilitated by the Mediator.

| Operation | Description |
|---|---|
| `negotiation.open` | Mediator opens a negotiation on a section (triggered by conflicting intents or proposals) |
| `negotiation.position` | Agent submits their position for the current round |
| `negotiation.synthesis` | Mediator synthesises positions and presents a summary to all parties |
| `negotiation.close` | Negotiation concludes (agreement, escalation, or timeout) |

Negotiation flow:

```
Mediator:       negotiation.open(sec:risk, [Agent-Legal, Agent-Finance])
                "Conflicting intents detected on §Risk"

Round 1:
  Agent-Legal:    negotiation.position("Need currency risk language per regulatory requirement")
  Agent-Finance:  negotiation.position("Must not name specific hedging instruments")

Mediator:       negotiation.synthesis
                → To Agent-Legal:   "Agent-Finance has an instrument-naming constraint"
                → To Agent-Finance: "Agent-Legal requires currency risk coverage"
                → To Human:         [full positions visible]

Round 2:
  Agent-Legal:    negotiation.position("Will reference policy by number, not instrument names")
  Agent-Finance:  negotiation.position("Acceptable if no instrument ticker symbols appear")

Mediator:       negotiation.close(outcome=aligned)
                → Agent-Legal invited to draft proposal (highest salience)
```

Each round, the Mediator:
- Receives raw positions from each agent
- Strips or summarises content that crosses clearance boundaries
- Presents a synthesis that helps agents converge without leaking classified detail
- Records everything in the Message Register

### 13.6 Mediator API Endpoints

Implementations supporting Mediated Communication MUST expose:

```
POST   /api/pact/{documentId}/messages                    // Send a message
GET    /api/pact/{documentId}/messages/inbox               // Poll inbox
POST   /api/pact/{documentId}/messages/{messageId}/ack     // Acknowledge receipt
POST   /api/pact/{documentId}/queries                      // Submit a query
GET    /api/pact/{documentId}/queries/pending               // Queries awaiting your response
POST   /api/pact/{documentId}/queries/{queryId}/respond     // Respond to a routed query
GET    /api/pact/{documentId}/queries/{queryId}/answer      // Get mediated answer
GET    /api/pact/{documentId}/negotiations                  // List active negotiations
POST   /api/pact/{documentId}/negotiations/{id}/position    // Submit position for current round
GET    /api/pact/{documentId}/negotiations/{id}/synthesis    // Get latest synthesis
GET    /api/pact/{documentId}/register                      // Message Register (human/custodian only)
```

### 13.7 Real-Time Events

```
OnMessageDelivered(documentId, messageId, senderId, recipientId, mediationAction)
OnQueryRouted(documentId, queryId, fromAgentId, toAgentId, disclosureLevel)
OnQueryAnswered(documentId, queryId, mediationAction)
OnNegotiationOpened(documentId, negotiationId, sectionId, participantIds[])
OnNegotiationRound(documentId, negotiationId, roundNumber)
OnNegotiationSynthesis(documentId, negotiationId, roundNumber)
OnNegotiationClosed(documentId, negotiationId, outcome)
```

### 13.8 Interaction with Information Barriers

Mediated Communication supersedes the per-endpoint clearance filtering from Sections 4–10 for implementations that support it. When a Mediator is present:

| Concern | Without Mediator (Sections 4–10) | With Mediator (Section 13) |
|---|---|---|
| Content filtering | Per-query section redaction | Mediator gates all content before delivery |
| Cross-pollination | Blocked at proposal creation/merge | Impossible — agents don't write directly to document |
| Classified events | Filtered from event stream | Agents only see events the Mediator forwards |
| Inter-agent discovery | Agents see each other in agent list | Mediator controls agent visibility |
| Constraint disclosure | Graduated levels per constraint | Mediator enforces disclosure per query |

Implementations MAY support both modes:
- **Unmediated mode** (Sections 4–10): agents interact directly with the PACT API; information barriers are enforced per-endpoint
- **Mediated mode** (Section 13): agents interact through the Mediator; information barriers are enforced at the routing layer

A document's mediation mode is set at creation time or by the human custodian.

### 13.9 MCP Tools (Mediated)

```json
{
  "tools": [
    { "name": "pact_message_send", "description": "Send a mediated message to another agent or broadcast" },
    { "name": "pact_message_inbox", "description": "Poll for messages delivered to this agent" },
    { "name": "pact_message_ack", "description": "Acknowledge receipt of a message" },
    { "name": "pact_query_submit", "description": "Ask a question about another agent's position" },
    { "name": "pact_query_respond", "description": "Respond to a routed query" },
    { "name": "pact_query_answer", "description": "Get the mediated answer to a submitted query" },
    { "name": "pact_negotiation_position", "description": "Submit position in an active negotiation round" },
    { "name": "pact_negotiation_synthesis", "description": "Get the Mediator's synthesis for the current round" },
    { "name": "pact_register", "description": "Read the Message Register (custodian only)" }
  ]
}
```

---

## 14. Resource Types (v1.1)

### 14.1 Overview

PACT v1.1 introduces **resource types** — a registry of well-known resource categories that implementations can support. Each resource type defines:

| Property | Description | Example (document) | Example (transaction) |
|---|---|---|---|
| **Type identifier** | Unique string | `"document"` | `"transaction"` |
| **Field schema** | What addressable fields the resource has | Markdown sections (`sec:intro`) | Transaction fields (`txn:amount`, `txn:recipient`) |
| **Proposal payload** | What a proposal contains | `{ newContent, summary }` | `{ amount, recipient, method, reference }` |
| **Apply semantics** | What happens when consensus is reached | Text merged into section | Payment settled |
| **Terminal state** | What "done" means | `Merged` | `Settled` |
| **Content format** | How the resource body is represented | Markdown | JSON record |

### 14.2 Built-in Resource Types

| Type | Field Addressing | Proposal Payload | Terminal State | Content Format |
|---|---|---|---|---|
| `document` | `sec:{slug}` (heading-derived) | `{ sectionId, newContent, summary, reasoning }` | `Merged` | Markdown |
| `transaction` | `txn:{field}` (structured) | `{ amount, recipient, method, reference }` | `Settled` | JSON |
| `fact` | `claim:{id}` | `{ claim, evidence, tier, sources }` | `Verified` | JSON |
| `record` | `rec:{field}` (structured) | `{ field, value, justification }` | `Finalized` | JSON |

The `document` type is the default. Proposals without an explicit `type` field are treated as `document` proposals.

### 14.3 The resource-type registry

The PACT **resource-type registry** is a machine-readable index of well-known resource types, both built-in (§14.2) and community-registered. It lives at [`spec/v2.0/resource-types.yaml`](./resource-types.yaml) in the canonical repository and is the source of truth implementations consult when negotiating resource-type compatibility.

Each registry entry carries:

| Field | Description |
|---|---|
| `type` | Unique string identifier (e.g., `"document"`, `"learning-story"`). Built-ins use bare identifiers; custom types SHOULD use reverse-domain notation (`com.example.case-file`). |
| `field_schema` | How addressable fields within the resource are named (e.g. `sec:{slug}` for documents, `txn:{field}` for transactions). |
| `proposal_payload` | The shape of a proposal against this resource type (a JSON Schema reference, or a structural description). |
| `apply_semantics` | What the implementation does when consensus is reached. |
| `terminal_states` | One or more named terminal states (e.g. `Merged`, `Settled`, `Verified`). |
| `content_format` | How the resource body is represented (Markdown, JSON, etc.). |
| `maintainer` | The contact / organisation registering the type. |
| `status` | `built-in` \| `registered` \| `proposed` \| `deprecated`. |

To register a custom resource type, open a PR against `spec/v2.0/resource-types.yaml` with the entry filled out. A custom type MUST define a unique identifier, a field schema, apply semantics, and at least one terminal state. Implementations that support a custom type MUST declare it in their `/.well-known/pact.json` profile (§15).

### 14.4 Backward Compatibility

All v1.0 behavior is preserved:

- Proposals without a `type` field default to `"document"`
- All existing API endpoints (`/api/pact/{documentId}/...`) continue to work for document resources
- The `sectionId` field in proposals is an alias for `fieldId` when the resource type is `document`
- Implementations that only support documents are fully v1.1 conformant (see Conformance Levels below)

### 14.5 Protocol Primitives Across Resource Types

The core primitives work identically regardless of resource type:

| Primitive | Document | Transaction | Fact |
|---|---|---|---|
| `join` | Join a document | Join a transaction | Join a topic |
| `intent` | "I want to add risk language" | "I want to authorize this payment" | "I want to verify this claim" |
| `constraint` | "Liability cap ≤ $2M" | "Daily limit $10K" | "Must cite primary source" |
| `propose` | New section content | Payment authorization | Evidence-backed claim |
| `silence = consent` | Auto-merge after TTL | Auto-authorize after TTL | Auto-verify after TTL |
| `object` | "Violates my constraint" | "Exceeds limit" | "Contradicts existing fact" |
| `escalate` | Human reviews text | Human reviews payment | Human reviews evidence |

---

## 15. Implementation Profiles and Conformance (v1.1)

### 15.1 Implementation Profile

Each PACT server SHOULD publish an **Implementation Profile** describing its capabilities. The profile is a JSON document at `/.well-known/pact.json` (borrowing from A2A's Agent Card pattern):

```json
{
  "name": "Tailor",
  "version": "2.0.0",
  "specVersion": "2.0",
  "conformanceLevel": "extended",
  "resourceTypes": [
    {
      "type": "document",
      "fieldSchema": "sec:{slug}",
      "contentFormat": "text/markdown",
      "terminalStates": ["Merged"],
      "applySemantics": "Text replacement within Markdown section"
    }
  ],
  "capabilities": {
    "mediatedCommunication": true,
    "informationBarriers": true,
    "structuredNegotiation": true,
    "inviteTokens": true,
    "authorizationProof": true,
    "agentIdentityTransfer": true
  },
  "retentionPolicy": {
    "minimumDays": 365,
    "indefinite": false,
    "tombstoneAfter": null
  },
  "endpoints": {
    "rest": "https://api.tailor.au/api/pact",
    "realtime": "wss://api.tailor.au/hubs/pact",
    "credentialsRegistry": "https://api.tailor.au/.well-known/pact-credentials.json"
  }
}
```

**Required and recommended fields.**

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Implementation name. |
| `version` | Yes | Implementation version (independent of `specVersion`). |
| `specVersion` | Yes | PACT spec version this profile targets (e.g. `"2.0"`). |
| `conformanceLevel` | Yes | One of `core` / `extended` / `authorization-required`. |
| `resourceTypes` | Yes | Resource types this server supports (must intersect with the v2.0 registry, §14.3). |
| `retentionPolicy` | **Yes (v2.0+)** | Event-log retention policy per §6.3: `{ minimumDays: int, indefinite: bool, tombstoneAfter: int\|null }`. |
| `capabilities` | SHOULD | Boolean capability flags. v2.0 well-known flags: `mediatedCommunication`, `informationBarriers`, `structuredNegotiation`, `inviteTokens`, `authorizationProof`, `agentIdentityTransfer`, `didDocumentPinning`, `recoverySingleChannel`, `atomicOnboard` (v2.0.3), `manifest` (v2.0.3), `sessionAwareness` (v2.0.3), `pushDelivery` (when v2.1 lands), `sessions` (v2.1). |
| `endpoints` | SHOULD | At minimum `rest`. SHOULD include `realtime` for SignalR/WebSocket and `credentialsRegistry` for §17.8. |

### 15.2 Conformance Levels

| Level | Requirements | Target Audience |
|---|---|---|
| **Core** | `join`, `leave`, `intent`, `constrain`, `propose`, `object`, `escalate`, `done`, `poll`, event sourcing, silence-based auto-apply | Any PACT implementation |
| **Extended** | Core + information barriers (classification, clearance, graduated disclosure), mediated communication, structured negotiation, invite tokens | Enterprise, regulated, multi-organisation |

An implementation declares its conformance level in the Implementation Profile. Implementations MUST support all primitives in their declared level.

### 15.3 Multi-Implementation Interoperability

PACT is designed for independent implementations, not shared backend code. Multiple products can implement PACT for different resource types:

```
┌─────────────────────────────────────────────┐
│            PACT Spec (v1.1)                 │
│  Resource-agnostic consensus primitives     │
├──────────────┬──────────────┬───────────────┤
│  Tailor      │  Source      │  Baink        │
│  (documents) │  (facts)     │  (transactions)│
│  Own DB      │  Own DB      │  Own DB       │
│  Own API     │  Own API     │  Own API      │
│  Conformance:│  Conformance:│  Conformance: │
│  Extended    │  Core        │  Core         │
└──────────────┴──────────────┴───────────────┘
```

Each implementation:
- Has its own database, API routes, and domain logic
- Implements the PACT primitives natively for its resource type
- Publishes a conformance profile
- Does NOT share code with other implementations (federation, not monolith)

### 15.4 Cross-organisation boundary (v2.0.2+)

The `Authorization-Required` tier (§17.9) and several other normative rules (§17.4's CT monitoring SHOULD, §17.13's trust-floor framing) reference "cross-organisation messages." v2.0 left "organisation" implicit; v2.0.2 defines it deterministically so the rules trigger consistently:

A message from agent A to agent B is **cross-organisation** if any of the following holds:

- A's `principal_id` and B's `principal_id` use different DID methods (e.g. one is `did:web:`, the other `did:key:`).
- Both DIDs use `did:web` but their domain components differ at the registrable-domain level (per [Mozilla's Public Suffix List](https://publicsuffix.org/)) — `did:web:org-a.example` and `did:web:org-b.example` are cross-org; `did:web:org.example` and `did:web:api.org.example` are intra-org (same eTLD+1).
- Either DID is unresolvable against the receiving server's federated registry (the message arrived from a counterparty whose registry the server does not directly mirror).
- An explicit `cross_org_assertion` field on the message says so. The sender MAY assert cross-org status even when the heuristics above don't trigger; the receiver MUST honour it (more checks, not fewer).

A message is **intra-organisation** only if none of the above is true. Implementations SHOULD log their cross-org / intra-org determination on every message bearing `authorization_proof`; the determination is itself an audit-trail artifact and MUST be preserved in the event log when the resource policy requires it (e.g. for Authorization-Required tier deployments under regulated audit).

Implementations MAY refuse to act on a message they classify as cross-org without an `authorization_proof` envelope, even at Core conformance — they simply MUST document that refusal in their Implementation Profile.

### 15.5 `pact_introspect_tier` — behavioural conformance probe (v2.0.2+)

Conformance levels declared in `/.well-known/pact.json` are self-asserted. A server can claim `Authorization-Required` without enforcing the four checks of §17.9. To make conformance partially probeable, v2.0.2 defines a small surface a verifier can use to **behaviourally check** that an advertised tier is actually being honoured.

**Operation:** `POST /api/pact/_probe/tier`

```json
{
  "probe_id": "string (caller-chosen unique id; echoed back)",
  "advertised_tier": "authorization-required",
  "checks": [
    "tombstoned_principal_rejected",
    "revoked_credential_rejected",
    "did_web_ct_check",
    "alg_whitelist_enforced",
    "verifier_id_equality_enforced"
  ]
}
```

The server MUST respond with a `tier_probe_report`:

```json
{
  "probe_id": "...",
  "server_advertised_tier": "authorization-required",
  "report_generated_at": "ISO 8601",
  "report_signature": "base64url-... (over canonical JSON of this report minus the signature field)",
  "signing_key": "did:web:server.example#tier-probe",
  "check_results": [
    { "check": "tombstoned_principal_rejected", "outcome": "pass", "evidence": "rejected probe-proof against tombstoned principal probe_tombstoned_001 at step 2" },
    { "check": "revoked_credential_rejected", "outcome": "pass", "evidence": "..." },
    { "check": "did_web_ct_check", "outcome": "not_implemented", "evidence": "server runs Authorization-Required tier without CT monitoring — see §17.4" },
    { "check": "alg_whitelist_enforced", "outcome": "pass", "evidence": "rejected proof with alg=HS256 at step 3" },
    { "check": "verifier_id_equality_enforced", "outcome": "pass", "evidence": "rejected proof with verifier_id mismatch at step 5" }
  ]
}
```

**Probe semantics.** For each requested check, the server runs a canonical test against itself (using pre-registered probe principals / probe credentials in the registry — implementations MAY designate specific principal IDs as probe-only) and reports the outcome. Outcomes are `pass` / `fail` / `not_implemented` (the server doesn't claim to enforce this check) / `unsupported` (the check name isn't recognised).

**What this probe IS and ISN'T:**

- It IS: a partial behavioural check that the most-load-bearing tier requirements are actually wired up. Catches conformance laundering for the small subset of checks that are runnable from a single API call.
- It IS NOT: a complete audit. Many tier requirements (e.g. event-log hash-chaining, registry append-only log integrity, did:web Document pinning over time) require multi-call sequences or external observation. Those are addressed by §6.4 signed roots and §17.8 mutation logs, not by this probe.

**Conformance:** OPTIONAL at Core; SHOULD at Extended; **MUST at Authorization-Required**. Implementations claiming Authorization-Required without exposing `_probe/tier` are accepted by tooling but flagged as non-introspectable; consumers SHOULD prefer probeable counterparties for cross-org trust.

The reference CLI exposes this as `pact tier-introspect <server-url> [--checks <list>]`; the MCP exposes `pact_tier_introspect`.

### 15.6 Fabric Onboarding Pattern (v2.0.3+)

§4.4.5 defines the `POST /_onboard` operation; this section documents the *flow* it is designed for and explains why the atomic onboarding path is preferred over the legacy join-then-constrain sequence.

**Recommended flow.**

```
┌──────────────┐                                         ┌──────────────┐
│  Initiator A │                                         │   Invitee B  │
└──────┬───────┘                                         └──────┬───────┘
       │ 1. Opens a fabric on its server                       │
       │    (POST /api/pact resource, configures policy)        │
       │                                                        │
       │ 2. Sends an invitation out-of-band                     │
       │    (email, signed message, signed link).               │
       │    Invitation carries: { fabricId, invite_token,       │
       │      counterparty_did, suggested_constraints? }        │
       │ ───────────────────────────────────────────────────────│
       │                                                        │
       │                                          3. Constructs │
       │                                             its own    │
       │                                             constraints│
       │                                                        │
       │                4. POST /_onboard (§4.4.5)              │
       │                ◄────────────────────────────────────── │
       │                   { agentName, constraints[],          │
       │                     invite_token, authorization_proof }│
       │                                                        │
       │ 5. Atomic check                                        │
       │    - validate join half                                │
       │    - validate each constraint                          │
       │    - if either fails → reject (no partial state)       │
       │    - else → register + publish constraints + emit      │
       │      one pact.fabric.onboarded event                   │
       │                                                        │
       │ 6. Both sides observe the fabric.onboarded event;       │
       │    B's manifest now reflects the negotiation envelope. │
       │                                                        │
       │ 7. Substantive messages may now flow.                  │
       ▼                                                        ▼
```

**Why atomic onboard beats join-then-constrain.**

The pre-v2.0.3 path was:

```
B → POST /join          (creates registration, emits pact.agent.joined)
B → POST /constraints   (publishes constraint #1)
B → POST /constraints   (publishes constraint #2)
...
B is now ready to negotiate.
```

This sequence has a **half-joined window** between step 1 and the last `POST /constraints`. During that window:

- **Counterparties believe B is a full member.** A may send messages, target proposals, or include B in vote tallies — even though B has not yet declared the constraints it intends to negotiate under.
- **B's reasoning context is split.** B "knows it's joined" because its `join` returned `200 OK`, but its constraints exist only in B's local intent — not yet in the fabric. If B crashes between step 1 and step 2, recovery is ambiguous (is the registration valid? are the unpublished constraints abandoned?).
- **Constraint-rejection has bad blast radius.** If B's third constraint is rejected for incompatibility, B is left as a partial member whose declared envelope doesn't match what it intended. Rolling back from the failed constraint to "as if B never joined" is a manual cleanup.
- **The event log is misleading.** `pact.agent.joined` appears before the constraints, suggesting B accepted whatever envelope existed at join time. The constraints arrive seconds (or longer) later as separate events with their own correlation gaps.

`_onboard` collapses this to one transaction: either B is a member with constraints `[c1, c2, c3]` declared, or B never joined at all. There is no observable point at which B is a member but its constraints have not yet been declared, and the event log records a single `pact.fabric.onboarded` event that names both the registration and the constraints, with the bundled `pact.constraint.published` events carrying matching `correlationId`s (§4.4.5 step 4).

**When to use legacy join.** The legacy `POST /join` remains valid for cases that don't fit the onboarding flow:

- An agent joining as a pure observer with no constraints to declare ever.
- An agent whose constraints emerge dynamically during negotiation and were genuinely not known at join time.
- Compatibility with v2.0.2 / v2.0.1 / v2.0 / v1.x clients.

**Implementer guidance.** Servers SHOULD advertise `_onboard` availability via the `capabilities.atomicOnboard: true` flag in the Implementation Profile (§15.1). Clients SHOULD prefer `_onboard` when they have constraints to declare and the server advertises support; SHOULD fall back to join + N `POST /constraints` only when the server's profile lacks the flag (or when the server returns `404` / `405` on `_onboard`).

**Cross-organisation onboarding.** At the `Authorization-Required` tier (§17.9), a cross-org `_onboard` call MUST carry a valid `authorization_proof`. The verifier checks the proof against the same envelope rules as any other cross-org message (§17.7); a failure rejects the entire onboarding, just as it would reject any substantive message. This is the natural place to bind onboarding to human intent: the proof witnesses "the human Bridget authorized her agent to join fabric F with these constraints" rather than the legacy split-witness pattern (one proof for joining, separate proofs for each later constraint).

---

## 16. Open Questions

1. **Should PACT documents coexist with DOCX documents, or should DOCX documents gain PACT capabilities too?** Initial recommendation: PACT is Markdown-only, DOCX keeps existing review workflows. Convergence later.

2. **How do we handle images and attachments in Markdown?** Options: inline base64 (bad for size), reference to uploaded supporting documents, or external URLs.

3. **Should agents be able to propose structural changes (add/remove sections)?** Or only content changes within existing sections? Structural changes complicate section addressing.

4. **What is the maximum document size?** Markdown is lightweight, but a document with 10,000 proposals in its history needs efficient querying.

5. **Should the protocol support sub-documents (includes/transclusion)?** A large report could be composed of many files managed as a single logical document.

6. **Should Mediated mode be mandatory or optional?** Unmediated mode (Sections 4–10) is simpler and lower-latency for trusted, single-organisation deployments. Mediated mode (Section 13) is stronger for cross-organisation, multi-clearance scenarios. Should implementations be required to support both? (The Conformance Levels in Section 15 answer this: Mediated Communication is Extended-level, not required for Core.)

9. **Should the protocol define cross-implementation federation?** When Tailor (documents) and Baink (transactions) both implement PACT, should agents on Tailor be able to reference a Baink transaction as context for a document proposal? Or is each implementation fully independent?

7. **Should the Mediator be LLM-powered?** A rules-based Mediator is deterministic and auditable. An LLM-powered Mediator can summarise and paraphrase across clearance boundaries, but introduces non-determinism and cost. Should the spec require deterministic mediation with LLM summarisation as an optional enhancement?

8. **How does the Mediator handle agent liveness during negotiation?** If Agent B goes silent during a negotiation round, should the Mediator auto-close the negotiation, escalate to the human, or continue with remaining agents?

---

## 17. Human Authorization Layer (v2.0)

> **Status:** v2.0 normative. At Core conformance the `authorization_proof` field is OPTIONAL (implementations MAY ignore it); at Extended it SHOULD be verified when present; at `Authorization-Required` (§17.9) it MUST be required on cross-organisation messages.
>
> *Coordination note:* the cryptographic detail deferred below — exact signature suites per attestation type, the full `voice-biometric` mechanics and test vectors (HMAN's [#3](https://github.com/TailorAU/pact/issues/3) PR is authoritative there), delegation trust-decay rules — lands via a reviewed PR. This section's structural and decision-bearing content (1:1 cardinality, DID identity, the envelope, the verification flow, the conformance tiers) is final for v2.0. Synced from the canonical mirror (`tailor-app` `docs/architecture/PACT_SPECIFICATION.md`) via coordination PR [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616).

### 17.1 Problem

PACT (Sections 1–16) coordinates agents on shared resources, but does not define a mechanism for verifying that an agent is acting with **authorization from its human principal** when communicating with another agent.

**Scenario:** Knox's agent sends a message to Bridget's agent. Bridget's agent needs cryptographic proof that Knox — not a rogue agent, prompt injection, or man-in-the-middle — authorized this specific action. Without such proof, any agent could impersonate any human's intent.

### 17.2 Trust Chain

The authorization trust chain flows from human intent to cryptographic verification:

```
Human Intent → Captured & Signed at Source Device → Transmitted with PACT Message → Verified Cryptographically at Destination Agent
```

Each link in the chain is independently verifiable. The chain breaks if any link is missing or forged.

### 17.3 Two-Layer Architecture

| Layer | Responsibility | Examples |
|-------|---------------|---------|
| **Hardware / Biometric** | Capture human intent, produce signed attestation | Earbuds with voice biometrics, phone with Face ID, typed passphrase, WebAuthn security key |
| **Software / PACT** | Carry the trust chain between agents, verify authorization at destination | `authorization_proof` field on PACT messages, agent credential registry |

The hardware layer captures and signs; PACT carries and verifies. Two separate concerns, one integrated protocol. PACT does not define the hardware attestation mechanism — it defines the envelope and verification protocol that any attestation format can plug into.

### 17.4 HumanPrincipal — strictly 1:1

A **HumanPrincipal** is the protocol-level abstraction for actions a human has authorized. A HumanPrincipal is **strictly 1:1 with a single human**: each human maps to exactly one `principal_id` at the PACT layer. There is no protocol mechanism for one principal to represent multiple humans, nor for a verifier to be asked to treat two principals as "the same human."

The `principal_id` is a [W3C Decentralized Identifier](https://www.w3.org/TR/did-core/). Implementations MUST support the `did:web` and `did:key` methods, and MAY support additional methods (`did:ion`, `did:ethr`, etc.). A verifier that does not recognise a presented method MUST treat the proof as unverifiable (reject; §17.7).

**Security note on `did:web`:** a `did:web` DID resolves to an HTTPS GET on a domain. A DNS hijack, certificate compromise, or domain takeover compromises every authorization signed under that domain — for HumanPrincipals carrying cross-organisation authorization, this is a significant operator-of-record threat. Implementations SHOULD treat `did:key` (offline / hardware-bound) as the default for high-stakes principals, and reserve `did:web` for federation-friendly cases where the domain's operational security is itself part of the trust posture. Implementations operating under the `Authorization-Required` tier (§17.9) SHOULD additionally require certificate-transparency monitoring for `did:web` principals they accept.

**DID Document pinning (REQUIRED for v2.0.2+; closes the historical-rewrite attack).** When a verifier first accepts a proof from a `principal_id`, it MUST record the DID Document it resolved against — at minimum the `id`, `verificationMethod` set, and `controller` value(s). For all subsequent proofs from the same `principal_id`, the verifier MUST check that the resolved DID Document either matches the pinned state exactly OR chains to it via a signed rotation event recorded in the credential registry's mutation log (§17.8). A DID Document that has "moved" without a corresponding signed rotation is evidence of compromise (domain takeover, DNS hijack, registry tampering) and MUST cause verification to fail (reject; §17.7 step 2). This rule is mandatory at the `Authorization-Required` tier and RECOMMENDED at Extended; implementations operating Core MAY skip pinning but SHOULD document that decision in their `/.well-known/pact.json` profile as `capabilities.didDocumentPinning: false`.

### 17.5 The `persona` claim (above the PACT layer)

Some deployments give one human several operating "personas" (e.g. `Personal`, `Trade`, `Household`). **PACT does not model these.** An implementation MAY attach an advisory `persona` claim to a signed message; it is purely informational metadata for the receiving agent. A verifier:

- MUST roll every persona up to the single `principal_id` it accompanies — distinct personas are NOT distinct principals;
- MUST NOT use the `persona` value in any access-control, trust, or identity decision;
- MAY surface it to a human operator for context.

Entity / role disambiguation is the implementation's responsibility, not the protocol's. (Reference downstream: the [HMAN multi-entity model](https://github.com/Tailor-AUS/Human-Managed-Access-Network/blob/main/PROTOCOL.md#multi-entity-model) sits above PACT in exactly this way — it is a non-normative reference, not a protocol mechanism.)

### 17.6 The `authorization_proof` envelope

Any PACT message (proposal, intent, constraint, completion, mediated message, session mandate) MAY include an `authorization_proof` object:

```json
{
  "sectionId": "sec:intro",
  "newContent": "...",
  "summary": "...",
  "authorization_proof": {
    "type": "fido2-assertion",
    "principal_id": "did:web:knox.example",
    "credential_id": "cred_abc123",
    "challenge_nonce": "base64url-...",
    "verifier_id": "did:web:bridget.example",
    "asserted_at": "2026-05-13T10:30:00Z",
    "signature": "base64url-...",
    "alg": "webauthn-es256",
    "alg_version": "2",
    "attestation_chain": []
  }
}
```

**Field definitions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Attestation type — `fido2-assertion`, `voice-biometric`, or a custom type in reverse-domain notation (§18.5). |
| `principal_id` | string (DID) | Yes | The HumanPrincipal that authorized this action. |
| `credential_id` | string | Yes | Identifier of the enrolled credential that produced the signature. |
| `challenge_nonce` | string | Yes | Verifier-issued challenge. MUST be either signed by the verifier's key (asserted via `verifier_signed_nonce: true`) OR accompanied by a `verifier_id` field. See replay-protection rules below. |
| `verifier_id` | string (DID) | Conditional | Identifier of the verifier the challenge was issued for. REQUIRED when `verifier_signed_nonce` is not `true`. The receiving verifier MUST reject the proof if `verifier_id` does not equal its own identity (the receiver's `principal_id` or registered verifier DID) — see §17.7 step 5. |
| `verifier_signed_nonce` | bool | No | Annotation asserting that `challenge_nonce` is itself signed by the verifier's key. When `true`, `verifier_id` is not required. Verifiers MUST still cryptographically validate the nonce signature; this field is the producer's hint, not a check. |
| `asserted_at` | string (ISO 8601) | Yes | When the human authorization was captured. |
| `signature` | string | Yes | Signature over the message payload + `challenge_nonce` + `asserted_at`, per the `type`'s suite. |
| `alg` | string | Yes (v2.0.2+) | Signature/match algorithm identifier. **Normative whitelist for `fido2-assertion`**: `webauthn-es256` (ECDSA P-256 + SHA-256), `webauthn-es384` (P-384 + SHA-384), `webauthn-eddsa` (Ed25519). For `voice-biometric`: `resemblyzer-v1` (HMAN's #3 PR pins the normative set). Custom attestation types declare their own algs in reverse-domain notation (`com.example.alg-name`). **Anything outside this whitelist MUST be rejected at §17.7 step 3** — HMAC-based or symmetric-key algs are explicitly disallowed for `fido2-assertion`. |
| `alg_version` | string | Yes | Version of `alg`. Model swaps / retrains / suite revisions MUST NOT silently invalidate enrolled references. |
| `attestation_chain` | array | No | Ordered intermediate attestations for delegated authorization (§17.11). Empty or absent = direct. v2.0 item shape is implementation-defined and verifiers that cannot verify the chain MUST reject — see §17.11. |

### 17.7 Verification Flow

On receiving a message bearing `authorization_proof`, a verifying party MUST:

1. **Type dispatch** — select the verification procedure for `type` (§18). Unrecognised `type` → unverifiable.
2. **Principal resolution** — resolve `principal_id` (DID resolution for `did:web` / `did:key` / etc., or the credential registry `/.well-known/pact-credentials.json`; §17.8). Resolution failure → unverifiable.
3. **Signature verification** — verify `signature` against the public key enrolled for `credential_id` under `principal_id`, per the `type`'s suite.
4. **Freshness** — `asserted_at` MUST be within the implementation's allowed clock skew (default ±5 minutes; configurable).
5. **Replay** — `challenge_nonce` MUST satisfy ONE of: (a) match a challenge the verifier (or its server) issued and has not yet retired, OR (b) carry a cryptographically valid verifier-signature over the nonce body (the verifier's own key, asserted by `verifier_signed_nonce: true`), OR (c) be accompanied by a `verifier_id` field whose value **exactly equals** the receiving verifier's identity (DID). **Presence of `verifier_id` alone is not sufficient — the value MUST equal the receiver's DID; a proof with `verifier_id: did:web:other.example` MUST be rejected by `did:web:this.example`.** This is the difference between schema-validity (the v2.0.1 `if/then` enforces presence) and replay-protection-validity (a runtime equality check, mandatory here).
6. **Result** — any failure → the verifier SHOULD reject the message and MAY emit `pact.trust.violation` with `payloadJson.kind = "authorization_failed"` and the failing step. Success → the message is treated as human-authorized by `principal_id`.

Verifiers MAY cache a successful resolution for the life of a session to avoid repeated registry / DID lookups; they MUST honour revocation (§17.8) within the cache's max-age hint.

### 17.8 Credential Registry

A PACT server publishing principal credentials does so at `/.well-known/pact-credentials.json`. Two surfaces are required: a **snapshot** (the current registry state) and a **mutation log** (an append-only record of every change to the snapshot, ever). The snapshot answers "who's enrolled right now?"; the log answers "who has the registry ever claimed was enrolled, and when did each claim change?" Without the log, tombstones and revocations are honour-system: the server could remove a tombstone tomorrow and no verifier could tell.

**Snapshot:**

```json
{
  "version": "2.0",
  "snapshot_root": "base64url-sha256-hash",
  "snapshot_signature": "base64url-sig-over-snapshot_root-using-the-servers-key",
  "log_uri": "https://api.tailor.au/.well-known/pact-credentials.log",
  "principals": [
    {
      "id": "did:web:knox.example",
      "display_name": "Knox Hart",
      "credentials": [
        { "id": "cred_abc123", "type": "fido2-assertion", "public_key": "base64url-...", "enrolled_at": "2026-01-01T00:00:00Z", "revoked": false }
      ]
    }
  ]
}
```

**Mutation log (append-only, hash-chained):**

```jsonl
{"seq":1,"epochMs":1735689600000,"op":"enroll","principal_id":"did:web:knox.example","credential_id":"cred_abc123","public_key":"base64url-...","prev_hash":"GENESIS"}
{"seq":2,"epochMs":1746230400000,"op":"revoke","principal_id":"did:web:knox.example","credential_id":"cred_abc123","reason":"key-rotation","prev_hash":"base64url-sha256(entry-1-canonical)"}
{"seq":3,"epochMs":1746230401000,"op":"enroll","principal_id":"did:web:knox.example","credential_id":"cred_def456","public_key":"base64url-...","prev_hash":"base64url-sha256(entry-2-canonical)"}
{"seq":4,"epochMs":1747276800000,"op":"tombstone","principal_id":"did:other-human.example","reason":"withdrawal","prev_hash":"base64url-sha256(entry-3-canonical)"}
```

Each entry's `prev_hash` is the SHA-256 of the *canonical* JSON encoding (RFC 8785) of the previous entry, base64url-encoded. The first entry (`seq: 1`) uses the literal string `"GENESIS"`. The `snapshot_root` in `/.well-known/pact-credentials.json` is the hash of the most recent log entry; the `snapshot_signature` is signed by the server's registry-signing key (advertised in the Implementation Profile, §15.1).

**Registry rules:**

- An implementation MAY instead (or also) support DID-document resolution for the public keys.
- A credential with `"revoked": true` MUST cause verification to fail.
- Implementations SHOULD support rotation — multiple active credentials per principal.
- The registry (snapshot + log) MUST be served over HTTPS in production; the server MAY require mTLS or a bearer token to read either surface.
- A `Cache-Control: max-age` (or equivalent) hint bounds how stale a cached resolution may be; absent a hint, implementations SHOULD re-check at least every 5 minutes.
- **Append-only mutation log (REQUIRED at Extended and Authorization-Required; RECOMMENDED at Core).** Every `enroll`, `revoke`, `rotate`, `tombstone`, or `untombstone` MUST be appended as a new log entry; entries MUST NOT be edited or deleted in place. Verifiers checking a registry state MAY fetch the log and validate the hash chain back to GENESIS; a verifier that detects a chain break or a snapshot whose `snapshot_root` doesn't match the log tip MUST treat the registry as compromised and reject all proofs resolving against it until the discrepancy is resolved. This closes the tombstone-then-resurrect attack: the resurrection is itself a logged event, visible to every cache-respecting verifier.
- **Erasure / tombstone (honest reframe — see §17.10 for what this does and doesn't guarantee):** a human's withdrawal is recorded as a `tombstone` log entry. The server SHOULD destroy the credential's private key material at this point; the registry SHOULD remove the public_key from future snapshots; the tombstone log entry remains forever (this is the protocol-integrity property). Prior proofs remain checkable as having-been-valid-then-revoked. The cryptographic-erasure property — that the destroyed key is actually unreachable — is an operational claim by the registry operator, not a protocol guarantee (§17.10).

### 17.9 Conformance

| Conformance Level | Requirement |
|-------------------|-------------|
| **Core** | `authorization_proof` is OPTIONAL — an implementation MAY ignore the field entirely. |
| **Extended** | SHOULD support at least one attestation type from §18 and SHOULD run the §17.7 verification when a proof is present. |
| **Authorization-Required** | MUST require a valid `authorization_proof` on every cross-organisation message; MUST support the credential registry (or DID resolution) and revocation propagation; MUST enforce all of the following operational checks (each a deterministic registry query, no inference): (a) reject if the `principal_id` resolves to a registry entry with `tombstoned_at` set (§17.8); (b) reject if `credentials[id == credential_id].revoked` is `true`; (c) reject if any entry in `attestation_chain` references a revoked or tombstoned credential at any hop; (d) for `did:web` principals, reject if the resolved DID Document was served by a certificate not visible in Certificate Transparency logs at the time of `asserted_at` (the §17.4 `did:web` security note). No implementation is required to claim this tier at v2.0 launch — it is defined so the protocol's trajectory is clear and so cross-org / regulated deployments have a target. |

Implementations MAY require `authorization_proof` for specific operations regardless of their declared tier (e.g. cross-organisation proposals, high-trust-level operations, financial transactions).

### 17.10 Personal data (GDPR / right-to-be-forgotten)

PACT's design separates two classes of personal data with different erasure stories. Whether either treatment satisfies any specific jurisdiction's data-protection law is **not** a protocol determination — see the legal-evaluation requirement at the end of this section.

- **Event-log entries are protocol-integrity records.** Removing past events breaks the event-sourced consistency guarantee that PACT relies on (Design Principle 5). An `authorization_proof` recorded in the event log SHOULD carry only the `principal_id` (a DID — itself rotatable / revocable) and a salted hash of the proof payload, NOT raw biometric data or other PII. Raw biometric material MUST NOT appear in the event log under any circumstance (see §18.3). The intent is that the personal-data exposure of a retained event is a single rotatable identifier plus an opaque hash.
- **Credential-registry entries** are personal data. The registry serves them via the snapshot + append-only log of §17.8. Erasure of a principal is recorded as a `tombstone` log entry, and the server SHOULD at that point destroy the credential's private key material and remove the `public_key` from future snapshots. **The term "cryptographic erasure" is widely used for this pattern but is, strictly, an OPERATIONAL claim, not a cryptographic guarantee.** Whether the destroyed key is actually unreachable depends on: (a) whether the key was hardware-bound (`did:key` backed by an HSM or platform authenticator approximates real unrecoverability; software keys do not), (b) whether the registry operator's backup / disaster-recovery policy retains key material that survives the "destruction," (c) whether the keys can be compelled (subpoena, regulator demand, internal access). A PACT verifier accepting a tombstone is trusting the registry operator's word that the key is gone; the append-only log makes that word visible and auditable, but does not make it cryptographically true. Implementations claiming the `Authorization-Required` tier (§17.9) SHOULD document, in their Implementation Profile, (i) whether their credential storage is hardware-bound, (ii) their backup-of-private-key-material policy, and (iii) the legal regime under which key disclosure could be compelled. Without those disclosures, the protective claim of cryptographic erasure is incomplete.

**Legal evaluation (REQUIRED).** Whether the above treatment satisfies a specific jurisdiction's right-of-erasure law (notably GDPR Art. 17 in the EU, but also similar provisions elsewhere) is a per-deployment legal question that the protocol cannot answer. Implementations MUST evaluate compatibility with applicable law and document, in their `/.well-known/pact.json` profile or accompanying compliance posture, any exemption claimed (e.g. Art. 17(3) public-interest, legal-obligation, or freedom-of-expression bases). Implementations operating in EU jurisdictions SHOULD obtain external legal review of their event-log retention before claiming the `Authorization-Required` tier.

### 17.11 Delegation (deferred to v2.1)

The `authorization_proof` envelope carries an `attestation_chain` field — ordered intermediate attestations for the case where principal `A0` authorizes a sub-agent who in turn authorizes the message signer. The intent for v2.0 is a maximum chain length of **3 hops** (direct + 2 sub-delegations); longer chains amplify revocation lag and reduce auditability.

**The canonical shape of an `attestation_chain` item, the trust-decay rules along the chain (does a revoked `A0` invalidate `A1..n` immediately, or do they stand until their own expiry?), and the verification algorithm for chained proofs are all DEFERRED TO v2.1.** For v2.0, implementations that need delegation MAY use the field with implementation-defined item shapes coordinated out-of-band with their counterparties; v2.0 verifiers MUST treat any non-empty `attestation_chain` they cannot themselves verify as `unverifiable` (reject) rather than silently passing the proof through. Implementations that do not support delegation MUST reject any proof where `attestation_chain.length > 0`.

### 17.12 Open Questions (deferred to a reviewed PR)

1. **Credential enrollment** — how does an agent prove its association with a specific human principal? (OAuth-based enrollment, in-person verification, web-of-trust attestation.)
2. **Revocation propagation** — immediate (real-time registry checks) vs eventually consistent.
3. **Offline verification** — pre-fetched public keys / signed credential bundles to verify without a registry round-trip.
4. **Delegation trust-decay** — the §17.11 cap is set; the decay model along the chain is not.
5. **Custom attestation types** — pre-registration required, or naming-convention only? (Current lean: naming-convention only — §18.5.)

### 17.13 Trust model (what PACT actually guarantees)

PACT v2.0.2's security properties depend on more than the protocol. A complete trust posture is the conjunction of (i) what the protocol normatively requires, (ii) what the implementer actually delivers, and (iii) what an external party can verify. The protocol is honest about which is which.

**What PACT v2.0.2 normatively requires of a conformant implementation:**

- Type dispatch, principal resolution, freshness, replay-binding equality, and signature verification per §17.7 against the alg whitelist of §17.6.
- An append-only credential-registry mutation log with hash chaining (§17.8).
- Event-log hash chaining + signed root (§6.4, when an implementation claims Extended or higher).
- DID Document pinning (§17.4) at Extended and Authorization-Required.
- Per the `Authorization-Required` tier, the four concrete checks of §17.9.

**What PACT v2.0.2 cannot guarantee through normative requirements alone:**

- That a server *actually performs* the checks it advertises in its profile. The conformance model is self-certifying (§15.5 `pact_introspect_tier` lets verifiers probe a small number of these behaviourally; the full set is not probeable). A server claiming `conformanceLevel: "authorization-required"` may or may not enforce all four checks; a verifier accepting proofs from that server is trusting the claim.
- That "cryptographic erasure" of a tombstoned credential's private key material is actually irreversible (§17.10 — operational, not cryptographic).
- That a `did:web` principal has not been silently rebound by a domain takeover the verifier cannot independently detect. The DID Document pinning rule (§17.4) catches changes the verifier observes post-pinning but cannot retroactively detect a takeover that happened before first observation.
- That an attestation chain (§17.11) accepted by a delegation-supporting implementation actually walks back to a valid principal — v2.0 leaves chain semantics implementation-defined.
- That a multi-channel notification of `recovery-initiated` (§23.4) actually reached the operator-of-record. The notification channel is implementation-defined.

**What a verifier should therefore assume:**

- The trust floor in any PACT interaction is the *weakest implementation in the trust graph*, not the strongest. A federation of three impls — two at `Authorization-Required` and one at `Core` — operates at Core-level trust against any principal whose authoritative registry is on the Core impl.
- "Conformance" is not a single binary. It's a stack: (i) the protocol's normative requirements, (ii) the implementer's declared profile, (iii) what an external probe / audit can independently verify. Cross-org consumers SHOULD probe (§15.5) before extending trust, not rely on the declared tier alone.
- For high-stakes operations, prefer hardware-bound principals (`did:key` via FIDO2/HSM) over `did:web`; require Authorization-Required from counterparties and verify it via probe; and treat the credential-registry mutation log as part of the audit surface, not just the snapshot.

This section is non-normative framing. It does not impose new requirements; it makes the existing trust model explicit so implementers and consumers calibrate accordingly.

**Manifest visibility (v2.0.3+).** The §4.4 active-session-manifest endpoints (`/_status` and `/manifest`) make existing fabric state easier to *read* — they do NOT relax the disclosure rules under which that state is shared. The manifest is **not** a privacy bypass. A server MUST apply the same cross-organisation, clearance, and graduated-disclosure (§10.3) rules to manifest responses as it does to the underlying per-endpoint reads:

- A counterparty's `principal_id`, `agent_name`, contact metadata, and other PII fields are returned in `_status.members[]` and `manifest.counterparties[]` only to the extent §17 already permits the caller to learn them. Where a counterparty's disclosure level (per §10.3) is "Constraint" or "Category," the field MUST be elided (key omitted), NOT set to `null` or an empty string — omission preserves the distinction between "field not present" and "field present and explicitly empty."
- Pending obligations (§6.5) belonging to a counterparty are surfaced in `_status.pending_obligations[]` filtered by the same rules; the caller sees only obligations whose existence it would already be entitled to learn from observing the underlying events. A summary count (`counterparties[].pending_obligation_count`) MAY be returned even when individual obligation entries are elided, but implementations SHOULD weigh whether the count itself leaks too much (e.g. a counterparty's overload signal) for the deployment's threat model.
- Last-seen timestamps (`members[].last_seen`, `counterparties[].last_seen`) are coarse-grained liveness signals and are RECOMMENDED to be served at second-precision or coarser — not millisecond — to avoid being weaponised as a timing side channel against the counterparty's local workflow.
- A caller that is itself **not a member** of the fabric MUST NOT receive a manifest. `/manifest` responds `403 auth.forbidden`; `/_status` responds `403 agent.not_joined` (or `404` if the implementation prefers fabric-existence hiding) — never a partially-redacted snapshot.
- The atomicity guarantee of `_onboard` (§4.4.5) is independent of manifest visibility: a rejected onboard does not leak through the manifest because no membership ever existed.

In short: manifest endpoints are *aggregators of state the caller would already be entitled to compute by other means*, not new disclosure surfaces. If a counterparty's name is hidden from the caller via the §10.3 graduated-disclosure rules, it stays hidden in the manifest.

---

## 18. Attestation Format Reference (v2.0)

> **Status:** v2.0 normative. Defines the credential types a PACT verifier MAY accept as proof of a HumanPrincipal's authorization. v2.0 defines **two** first-class types; implementations MAY support additional custom types (§18.5).

### 18.1 Common envelope

Every attestation, whatever its `type`, uses the `authorization_proof` envelope of §17.6 and additionally carries:

| Field | Required | Description |
|---|---|---|
| `alg` | Yes | Algorithm identifier for this attestation's signature / match (e.g. `"webauthn-es256"`, `"resemblyzer-v1"`). |
| `alg_version` | Yes | Version of `alg` — model swaps / retrains MUST NOT silently invalidate enrolled references. |

`challenge_nonce` replay protection (§17.6) is mandatory for all types.

| Type | Based On | Hardware Required | Privacy | Offline Verify | Maturity |
|------|----------|-------------------|---------|----------------|----------|
| `fido2-assertion` | WebAuthn / FIDO2 | Yes (authenticator) | High (no biometric leaves device) | Yes | Established standard |
| `voice-biometric` | speaker-verification embedding + utterance-hash binding | Yes (microphone) | High (zero-knowledge embedding match; audio never leaves device) | Yes | RFC ([#3](https://github.com/TailorAU/pact/issues/3)) — crypto detail + test vectors land via HMAN's PR |

### 18.2 `fido2-assertion`

**Based on:** [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/) / FIDO2.

The human activates a FIDO2 authenticator (security key, platform authenticator, phone). The authenticator signs over the PACT message hash + `challenge_nonce`. The proof carries the WebAuthn `authenticatorData`, `clientDataJSON`, and `signature`.

**Verification:** standard WebAuthn assertion verification — verify the signature against the enrolled public key for `credential_id`; verify the relying-party ID; confirm the User Presence (UP) flag, and the User Verification (UV) flag if the operation requires it.

**Use when:** high-security and cross-organisation actions; financial transactions. Preferred when both parties have hardware-authenticator infrastructure.

### 18.3 `voice-biometric`

> **Authoritative spec:** HMAN's [#3](https://github.com/TailorAU/pact/issues/3) PR. The text below is the structural contract v2.0 commits to; the cryptographic detail and test vectors land via that PR.

**Based on:** speaker-verification embedding similarity + utterance-hash binding.

**Distinguishing property:** captures *intent* (the human spoke a specific challenge utterance), not just *presence* (a passkey tap).

**Envelope additions:**

```json
"match": { "alg": "resemblyzer-v1", "alg_version": "1.0", "score": 0.91, "threshold": 0.75 },
"utterance_hash": "base64url-...",
"verifier_id": "did:web:bridget.example"
```

- `match` — the speaker-verification result. The `match` sub-object shape is reused by any future biometric modality (face, gait, keystroke dynamics).
- `utterance_hash` — **normative**. A hash of the spoken utterance, binding the assertion to *what was said*. Non-normative note: a verifier requiring "approve transfer of $5000 to Bridget" MUST reject a valid voice match against the wrong `utterance_hash`.
- `challenge_nonce` MUST be verifier-signed OR `verifier_id` MUST be present (replay protection across verifiers).

**Hard constraint:** raw audio MUST NOT leave the verifying device. Only the embedding score (inside `match`), the `utterance_hash`, and the signed assertion cross the wire. No raw biometric data enters the event log (§17.10).

**Reference embedding algorithm:** `resemblyzer-v1` (non-normative; HMAN's #3 PR pins the normative set and the versioning policy, plus the signature suite, key wrapping, threshold-selection guidance, and test vectors).

**Use when:** real-time intent-bearing authorization on voice channels (calls, dictation, multi-party negotiation) where presence-only credentials are insufficient.

### 18.4 Combining types

A high-stakes operation MAY require two attestation types presented together (e.g. `fido2-assertion` for possession + `voice-biometric` for intent). When required, both proofs MUST verify independently and MUST carry the same `principal_id`.

### 18.5 Custom Attestation Types

Implementations MAY define custom attestation types using reverse-domain notation (e.g., `com.example.voice-print`, `au.gov.mygovid`). A custom type MUST:

- use the `authorization_proof` envelope defined in §17.6 plus the common fields of §18.1;
- document its signing and verification mechanics;
- be declared in the implementation's `.well-known/pact-credentials.json` under a `supported_types` array.

Whether custom types additionally require pre-registration in a central registry is deferred to a reviewed PR (current lean: naming-convention only).

> *Note:* `vc-jwt`, `biometric-hash`, and `passphrase-signed` (which appeared in the v1.2-draft attestation list) are **not** v2.0 first-class types — an implementation that needs them carries them as custom types under this section.

### 18.6 Deferred to HMAN's #3 PR

- `voice-biometric` normative crypto: signature suite, key wrapping, the normative set of embedding algorithms + versioning policy, threshold-selection guidance, full replay-protection requirements.
- Test vectors for `voice-biometric` (and `fido2-assertion`) — go in `spec/v2.0/conformance/extended/attestation/`.
- The HMAN reference-stack citation (Resemblyzer + Fernet + PBKDF2 + per-session re-arm + hash-chained audit), conditional on the test vectors landing.

---

> **Sections 19–22 (reserved for v2.1).** §19–20 — ephemeral negotiation Sessions + the Mandate primitive (RFC [#14](https://github.com/TailorAU/pact/issues/14)); §21 — push delivery (signed event webhooks); §22 — service-account authentication. v2.0 ships without these; they will land in a follow-on minor release (`spec/v2.1/`) once RFC #14 converges and T4 / T5 are designed. Design records: `docs/v2-plan.yaml` (tracks T3, T4, T5).

## 23. Agent Identity Lifecycle (v2.0)

> **Status:** v2.0 normative. Resolves issue [#13](https://github.com/TailorAU/pact/issues/13) Q7 (agent identity persistence + operator transfer).

### 23.1 What an `agentId` is

When an agent joins a resource (`agent.join`, §4.1) it is assigned an `agentId` — a **server-side principal** that persists across sessions, machines, and CLI invocations. The `agentId` is distinct from the **HumanPrincipal** (§17.4) that operates the agent: the HumanPrincipal answers "which human authorized this," the `agentId` answers "which agent identity is doing the work."

`agentId` is a URN of the form `urn:pact:agent:{opaque}` (or a DID, where the server supports it). The format is **portable** — designed so a future PACT federation (v2.1+) can resolve an `agentId` across servers — even though a v2.0 server treats it as server-local. Implementations MUST NOT mint an `agentId` that is only meaningful within a single document or session.

### 23.2 The agent ↔ operator binding

Every `agentId` has an **operator-of-record**: the HumanPrincipal currently responsible for the agent. The binding is recorded in the event log (`pact.agent.joined` carries it; `pact.agent.transferred` / `pact.agent.recovered` update it) and is independent of the agent's `agentId` — i.e., the operator can change without the `agentId` changing. This is the property AloomU's sovereignty posture requires: "operator-of-record can change without losing agent identity continuity."

### 23.3 Cooperative operator transfer

When an operator hands an agent over voluntarily (succession, role rotation, off-boarding):

1. The **outgoing operator** signs a transfer attestation: `{ agentId, from: <outgoing principal_id>, to: <incoming principal_id>, effective_at, reason }`, signed with the outgoing principal's key (§17.6 envelope semantics).
2. The **incoming operator** countersigns the same attestation.
3. The server validates both signatures, rotates the binding, and emits `pact.agent.transferred` (and, if the agent's own signing key rotates, `pact.agent.identity-rotated`). The `agentId` is unchanged.

A transfer with only one valid signature MUST be rejected.

### 23.4 Hostile / non-cooperative transfer (recovery)

When the outgoing operator cannot or will not co-sign (fired, deceased, unreachable, adversarial), one of two recovery paths applies. An implementation that runs sovereignty-posture deployments SHOULD support at least one; both are OPTIONAL at every conformance tier.

- **M-of-N recovery.** The `agentId` was enrolled with a recovery quorum — a governance group of N principals, M of whom must co-sign a recovery attestation `{ agentId, to: <incoming principal_id>, effective_at, reason }`. On a valid M-of-N signature set the server rotates the binding and emits `pact.agent.recovered`. The `agentId` is unchanged. Quorum size (M, N) is implementation-defined; the spec sets no minimum but RECOMMENDS M ≥ 2.
  - **Quorum enrollment is implementation-defined for v2.0.** Implementations supporting M-of-N recovery MUST document, in their `/.well-known/pact.json` profile or accompanying impl notes, (a) the enrollment endpoint and authentication requirements, (b) the canonical attestation format for the enrollment record, and (c) who is authorized to initiate enrollment for a given `agentId`. v2.1 will normalize an `agent.enroll-quorum` operation; until then, cross-implementation interop on recovery is not guaranteed.
- **Abandoned-agent reset.** Where no recovery quorum was enrolled, an administrator MAY mint a **new** `agentId` for a successor agent and emit `pact.agent.abandoned` against the old one, carrying an attestation of why (the old operator is unreachable / off-boarded / etc.). The old `agentId`'s history is preserved and remains citable; it is simply marked abandoned and accepts no further operations.
  - **Who counts as an "administrator" is implementation-defined for v2.0.** At minimum, the administrator's action MUST itself carry a valid `authorization_proof` (§17.6), and the implementation SHOULD document the principal(s) authorized to perform abandoned-agent reset (typically a small, named operations group rather than any holder of an admin token).

Both recovery paths take effect only after a **time-locked dispute window** (implementation-configurable; default 72 hours) during which the current operator-of-record, if reachable, can veto. The window is announced via `pact.agent.recovery-initiated` (carrying `effective_at`).

### 23.5 Event types

```
pact.agent.transferred         // Cooperative operator transfer completed (binding rotated, agentId unchanged)
pact.agent.identity-rotated     // Agent's own signing key rotated (may accompany a transfer)
pact.agent.recovery-initiated   // M-of-N recovery or abandoned-agent reset started; dispute window open
pact.agent.recovery-disputed    // Operator-of-record (or proxy) lodged a dispute during the window; recovery suspended for human resolution
pact.agent.recovered            // M-of-N recovery completed (binding rotated, agentId unchanged)
pact.agent.abandoned            // Abandoned-agent reset completed (old agentId frozen; successor has a new agentId)
```

### 23.5b Multi-channel notification and dispute (v2.0.2+; closes the dispute-window-starvation attack)

The 72-hour default dispute window (§23.4) is only as safe as the operator-of-record's ability to actually receive `pact.agent.recovery-initiated` in time. v2.0 left the notification channel implementation-defined; an attacker who has captured M-of-N quorum keys and can also DoS / spoof / hijack a single notification channel can ride the window out unopposed. v2.0.2 strengthens this:

- An implementation supporting M-of-N recovery MUST emit the `pact.agent.recovery-initiated` event to **at least two distinct notification channels** from the agent's enrolled `notificationChannels` list (registered at agent join time or rotated via cooperative transfer). Channels SHOULD include heterogeneous transports — e.g. one IP-network webhook AND one out-of-band channel (email, SMS, push to a hardware authenticator, a signed entry on a public log). Implementations using only one channel MUST advertise this limitation in their Implementation Profile (§15.1) as `capabilities.recoverySingleChannel: true` so consumers can downweight the implementation's recovery-safety claim.
- The recovery-initiated event MUST include an `external_anchor_uri` field — a URL on an append-only log (§17.8 mutation-log style, or an external transparency log) where the event is also published. A consumer that observes the recovery on the anchor but not on its primary channel SHOULD treat the primary channel as compromised.
- The operator-of-record (or any quorum member who did NOT co-sign the recovery, or any human with administrative oversight as defined by the implementation) MAY emit a `pact.agent.recovery-disputed` event during the window. A valid dispute event suspends the recovery pending human resolution (the implementation MUST emit `pact.escalation.human` referencing the agentId and the dispute, and MUST NOT auto-complete the recovery until a human-resolution event clears it).
- The dispute event itself MUST carry an `authorization_proof` from the disputing principal. A dispute from a principal not authorized to dispute (per the implementation's documented rules — typically the current operator-of-record OR any non-co-signing quorum member) MUST be rejected with `pact.trust.violation`.
- Default behaviour when the dispute window expires without a dispute event: the recovery proceeds. Implementations MAY require an additional explicit "no-dispute" confirmation step at the `Authorization-Required` tier.

### 23.6 Conformance

| Level | Requirement |
|---|---|
| **Core** | `agentId` MUST persist across sessions and be server-portable in form (§23.1). Cooperative transfer (§23.3) is OPTIONAL. |
| **Extended** | SHOULD support cooperative operator transfer (§23.3). Implementations supporting recovery (§23.4) SHOULD provide multi-channel notification (§23.5b). |
| **Authorization-Required** | The transfer / recovery attestations are themselves `authorization_proof`-bearing (§17.6); a recovery quorum's signatures MUST each verify as valid HumanPrincipal proofs. Implementations supporting recovery MUST provide multi-channel notification + external anchor URI + dispute support (§23.5b). |

M-of-N recovery and abandoned-agent reset (§23.4) are OPTIONAL at every tier but RECOMMENDED for deployments that commit to operator-independent identity continuity.

### 23.7 Open Questions (deferred to a reviewed PR)

1. **Cross-server portability** — `agentId` is portable in *form*; the *resolution protocol* (how server B resolves an `agentId` minted on server A) is v2.1 federation work.
2. **Trust decay for transferred identities** — does an agent's reputation / trust level carry across a hostile recovery, or reset?
3. **Recovery quorum minimum** — spec-fixed minimum M, or implementation-defined? (Current: implementation-defined, RECOMMEND M ≥ 2.)

---

## Appendix A: API Schemas (Unmediated + Mediated)

### A.1 Error Response Format

All PACT API error responses MUST follow this structure:

```json
{
  "errors": [
    {
      "code": "section.locked",
      "description": "Section is locked by another agent.",
      "metadata": { "lockedBy": "agent-xyz", "expiresAt": "2026-03-02T12:00:00Z" }
    }
  ]
}
```

The `errors` array contains one or more error objects. Each error has a machine-readable `code` and a human-readable `description`. The optional `metadata` field carries structured context (e.g., who holds the lock, retry-after seconds).

#### Standard Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `auth.unauthorized` | 401 | Missing or invalid API key / bearer token |
| `auth.forbidden` | 403 | Insufficient trust level for this operation |
| `agent.not_joined` | 403 | Agent has not joined this document |
| `agent.already_joined` | 409 | Agent is already registered on this document |
| `section.not_found` | 404 | Section ID does not exist in the document |
| `section.locked` | 409 | Section is locked by another agent |
| `proposal.not_found` | 404 | Proposal ID does not exist |
| `proposal.conflict` | 409 | Conflicting proposal on the same section |
| `proposal.invalid_status` | 400 | Cannot perform action on proposal in its current status |
| `document.not_found` | 404 | Document does not exist |
| `document.locked` | 423 | Entire document is frozen |
| `rate.limited` | 429 | Rate limit exceeded |

Implementations MAY define additional error codes under custom namespaces (e.g., `classification.access_denied`). All custom codes MUST use the dot-delimited format.

### A.2 Request/Response Schemas

Full JSON Schema (2020-12) definitions for all API endpoints are available in the [schemas directory](https://github.com/TailorAU/pact/tree/main/spec/v2.0/schemas). Older spec versions (v0.3 / v0.4 / v1.0 / v1.1) use draft-07; v2.0 schemas were bumped to draft 2020-12 on 2026-05-13.

| Schema | Endpoint | Description |
|---|---|---|
| `join-request.json` | `POST /join` | Agent registration request |
| `join-response.json` | `POST /join` | Agent registration response |
| `proposal-request.json` | `POST /proposals` | Edit proposal creation |
| `proposal-response.json` | `POST /proposals` | Edit proposal with constraint warnings |
| `intent-request.json` | `POST /intents` | Intent declaration |
| `constraint-request.json` | `POST /constraints` | Constraint publication |
| `salience-request.json` | `POST /salience` | Salience score assignment |
| `lock-request.json` | `POST /sections/{id}/lock` | Section lock with TTL |
| `done-request.json` | `POST /done` | Agent completion signal |
| `ask-human-request.json` | `POST /ask-human` | Human escalation |
| `error-response.json` | All endpoints | Standard error envelope |
| `event.json` | Events / polling | Event structure (Section 6) |
| `authorization-proof.json` | Any message | Proof-of-human-intent envelope (Section 17.6) |
| `principal-registry.json` | `/.well-known/pact-credentials.json` | Credential registry structure (Section 17.8) |
| `agent-identity.json` | Transfer / recovery | Agent identity lifecycle — transfer & recovery attestations, recovery-quorum enrollment (Section 23) |
| `fabric-status.json` | `GET /_status` | Fabric-wide snapshot (v2.0.3 — §4.4.1) |
| `fabric-manifest.json` | `GET /manifest` | Caller-scoped manifest of constraints, obligations, counterparties (v2.0.3 — §4.4.2) |
| `heartbeat-request.json` | `POST /_heartbeat` | Bidirectional heartbeat request (v2.0.3 — §4.4.3) |
| `heartbeat-response.json` | `POST /_heartbeat` | Bidirectional heartbeat response (v2.0.3 — §4.4.3) |
| `mark-read-request.json` | `POST /mark-read` | Event-range acknowledgement request (v2.0.3 — §4.4.4) |
| `mark-read-response.json` | `POST /mark-read` | Event-range acknowledgement response (v2.0.3 — §4.4.4) |
| `onboard-request.json` | `POST /_onboard` | Atomic join + constrain request (v2.0.3 — §4.4.5) |
| `onboard-response.json` | `POST /_onboard` | Atomic join + constrain response (v2.0.3 — §4.4.5) |
| `pending-obligation.json` | `/_status`, `/manifest` | Shared pending-obligation shape (v2.0.3 — §6.5) |

> **Note:** `authorization-proof.json` carries the §18.1 common fields and the `voice-biometric` additions inline (`match`, `utterance_hash`, `verifier_id`); the full normative `voice-biometric` schema — signature suite, embedding-algorithm versioning — lands via HMAN's [#3](https://github.com/TailorAU/pact/issues/3) PR (§18.6).

### A.3 Pagination

List endpoints (proposals, agents, events, intents, constraints) support cursor-based pagination.

**Request parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `cursor` | string? | `null` | Opaque cursor from a previous response. Omit for the first page. |
| `limit` | integer? | 50 | Maximum items to return (1–200). |

**Response envelope:**

```json
{
  "items": [ ... ],
  "nextCursor": "eyJzIjoxMjM0fQ==",
  "hasMore": true
}
```

| Field | Type | Description |
|---|---|---|
| `items` | array | The requested resources. |
| `nextCursor` | string? | Pass as `cursor` in the next request. `null` when no more pages. |
| `hasMore` | boolean | `true` if additional pages exist. |

Implementations MUST return items in a stable, deterministic order (typically by creation time ascending).

---

*PACT Specification v2.0.3 — released 15 May 2026 (third patch on the v2.0 line; v2.0 was 14 May 2026, v2.0.1 and v2.0.2 also 15 May 2026 earlier in the day; v2.0.3 adds fabric onboarding & session awareness — see "What's New in v2.0.3" at the top).*

*Reference implementation: [Tailor](https://tailor.au) by [TailorAU](https://github.com/TailorAU) — see [Tailor Implementation Notes](./PACT_TAILOR_IMPLEMENTATION.md) for implementation-specific details.*

> **Standalone spec:** [github.com/TailorAU/pact](https://github.com/TailorAU/pact) — vendor-neutral specification. Synced manually with this file via coordinated PRs (most recently [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616)).
