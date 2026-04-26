# PACT — Protocol for Agent Consensus and Truth — Specification v1.2-draft

> **Status:** Draft, not for production.  
> **Author:** Knox Hart + AI  
> **Date:** April 2026  
> **Version:** 1.2-draft (supersedes v1.1 once final)  
> **Vision:** Enable millions of agents to reach consensus on shared resources at machine speed, with humans retaining final authority.

> **What's new in v1.2-draft:**
> - Section 17 — Human Authorization Layer (cryptographic proof of human intent)
> - Section 18 — Attestation Format Reference (`fido2-assertion`, `vc-jwt`, `biometric-hash`, `passphrase-signed`)
> - Open RFCs: [#3 voice-biometric credential type](https://github.com/TailorAU/pact/issues/3), [#4 HumanPrincipal cardinality](https://github.com/TailorAU/pact/issues/4) (resolution baked into §17.8).

### What's New in v1.2-draft

PACT v1.2-draft adds an optional **Human Authorization Layer** for cryptographic proof-of-human-intent on agent-to-agent messages, and a **1-to-many `HumanPrincipal` cardinality** rule (§17.8) closing out RFC #4. All v1.1 behavior is preserved; the authorization extension is OPTIONAL at Core conformance.

### What's New in v1.1

PACT v1.1 generalizes the protocol from document-only to **any resource type** — documents, transactions, knowledge claims, clinical records, or any domain where agents need structured consensus. All v1.0 behavior is preserved; documents are the default resource type. The core primitives (join, intent, constrain, propose, object, escalate, done) are unchanged.

Key additions:
- **Resource Types** (Section 14) — implementations declare what kind of resource agents negotiate over
- **Implementation Profiles** (Section 15) — each PACT server advertises supported resource types and apply semantics
- **Conformance Levels** (Section 15) — Core vs Extended compliance tiers
- **Backward compatibility** — proposals without a `type` field default to `"document"`; all v1.0 endpoints continue to work

### v1.2-draft Additions

- **Human Authorization Layer** (Section 17) — proof-of-human-intent as a PACT trust primitive, enabling agents to cryptographically verify that a message was authorized by a specific human principal
- **Attestation Format Reference** (Section 18) — standard attestation types: FIDO2, VC-JWT, biometric-hash, passphrase-signed

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
| `agent.heartbeat` | Signal liveness (auto-evicted after 5min silence) | Any |

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

### 4.4 Merge Operations (Server-Side)

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
```

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
    { "name": "pact_unlock", "description": "Unlock a section" }
  ]
}
```

### 7.4 Implementation Alignment (informative)

Several schemas in `spec/v1.2/schemas/` describe operations whose route shapes have diverged across implementations. The shapes below are informative — implementations MUST publish their actual route shapes in their Implementation Profile (§15.1). Active alignment work is tracked in [TailorAU/pact#9](https://github.com/TailorAU/pact/issues/9) and is targeted for resolution before v1.3.

**Information barrier and invite endpoints** — schemas exist; canonical route shape pending alignment:

| Operation | Schema | v0.4-lineage spec route | Reference-impl route (Tailor) |
|-----------|--------|-------------------------|-------------------------------|
| Create classification framework | `classification-framework-request.json` | `POST /{docId}/classification/framework` | `POST /classification-frameworks` (org-level, not document-scoped) |
| Classify a section | `classify-section-request.json` | `POST /{docId}/sections/{sectionId}/classify` | `POST /{docId}/classifications` (`sectionId` in body, supports batch) |
| Grant clearance | `clearance-request.json` | `POST /{docId}/clearance` | `POST /{docId}/clearances` (REST plural) |
| Create invite token | `invite-create-request.json` | `POST /{docId}/invites` | `POST /{docId}/invites` (Tailor matches; see [PACT_REQUIREMENTS_FROM_TAILOR §5.4](https://github.com/TailorAU/tailor-app/blob/main/docs/PACT_REQUIREMENTS_FROM_TAILOR.md) for enum-casing alignment) |

**Endpoints in §7.1 without a request schema in `spec/v1.2/schemas/`** — schema authorship deferred to v1.3:

- `POST /api/pact/{documentId}/comments` (Add comment) — payload defined in §9.1
- `POST /api/pact/{documentId}/escalate` (Escalate to human) — payload defined in §9.2
- `POST /api/pact/{documentId}/pre-validate` (Preview resolution against constraints)
- `POST /api/pact/{documentId}/cascade-validate` (Cascade validation result)
- `POST /api/pact/{documentId}/messages/{messageId}/ack` (Acknowledge mediated receipt) — §13.5.1
- `POST /api/pact/{documentId}/proposals/{id}/approve` and `/reject` (small payloads — schema-less by design)
- `POST /api/pact/{documentId}/intents/{id}/object` and `/proposals/{id}/object` (object verb — payload `{ reason }`)

Implementations of these endpoints SHOULD document their request payloads in their Implementation Profile until canonical schemas land in v1.3.

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

### 14.3 Custom Resource Types

Implementations MAY register custom resource types. A custom type MUST define:

1. A unique string identifier (e.g., `"learning-story"`, `"insurance-claim"`)
2. A field schema describing the addressable units within the resource
3. Apply semantics — what the implementation does when consensus is reached
4. One or more terminal state names

Custom types SHOULD be registered in the PACT resource type registry at `github.com/TailorAU/pact`.

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
  "version": "1.1.0",
  "specVersion": "1.1",
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
    "inviteTokens": true
  },
  "endpoints": {
    "rest": "https://api.tailor.au/api/pact",
    "realtime": "wss://api.tailor.au/hubs/pact"
  }
}
```

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

## 17. Human Authorization Layer (v1.2-draft)

> **Status:** Draft — not yet required for conformance. This section defines an optional protocol extension for proof-of-human-intent.

### 17.1 Problem

PACT validates factual claims through agent consensus and civic duty constraints (Sections 10–11). However, PACT does not currently define a mechanism for verifying that an agent is acting with **authorization from its human principal** when communicating with another agent.

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

### 17.4 Protocol Extension

All PACT messages (proposals, intents, constraints, completions, mediated messages) MAY include an `authorization_proof` object:

```json
{
  "sectionId": "sec:intro",
  "newContent": "...",
  "summary": "...",
  "authorization_proof": {
    "type": "fido2-assertion | vc-jwt | biometric-hash | passphrase-signed",
    "credential_id": "cred_abc123",
    "signature": "base64url-encoded-signature",
    "timestamp": "2026-04-08T10:30:00Z",
    "nonce": "random-nonce-from-receiver",
    "human_principal_id": "principal_knox_abc",
    "attestation_chain": ["...optional intermediate attestations..."]
  }
}
```

**Field definitions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Attestation type — one of `fido2-assertion`, `vc-jwt`, `biometric-hash`, `passphrase-signed`, or a custom type using reverse-domain notation (e.g., `com.example.voice-print`) |
| `credential_id` | string | Yes | Identifier of the credential used to produce the signature, as enrolled in the credential registry |
| `signature` | string | Yes | Base64url-encoded cryptographic signature over the message payload + nonce + timestamp |
| `timestamp` | string (ISO 8601) | Yes | When the human authorization was captured |
| `nonce` | string | Yes | Challenge nonce issued by the receiving agent or server, preventing replay attacks |
| `human_principal_id` | string | Yes | Identifier of the human principal who authorized the action |
| `attestation_chain` | array of strings | No | Ordered list of intermediate attestations for delegated authorization (see §17.9) |

### 17.5 Verification Flow

When a receiving agent encounters an `authorization_proof` on an incoming message:

1. **Type selection** — Check `authorization_proof.type` to select the appropriate verification strategy (see Section 18 for supported types)
2. **Principal lookup** — Look up `human_principal_id` in the credential registry (`/.well-known/pact-credentials.json` or via DID resolution)
3. **Signature verification** — Verify `signature` against the enrolled public key for `credential_id`
4. **Timestamp validation** — Confirm `timestamp` is within acceptable clock skew (default: 5 minutes, configurable per implementation)
5. **Nonce validation** — Confirm `nonce` matches the challenge previously issued to the sender (prevents replay attacks)
6. **Result** — If verification fails at any step, the receiving agent SHOULD reject the message and MAY emit a `trust.violation` event (type: `authorization_failed`)

Implementations MAY cache verification results for the duration of a session to avoid repeated lookups against the credential registry.

### 17.6 Credential Registry

Each PACT server MAY publish a credential registry at `/.well-known/pact-credentials.json`:

```json
{
  "version": "1.0",
  "principals": [
    {
      "id": "principal_knox_abc",
      "display_name": "Knox Hart",
      "credentials": [
        {
          "id": "cred_abc123",
          "type": "fido2",
          "public_key": "base64url-encoded-public-key",
          "enrolled_at": "2026-01-01T00:00:00Z",
          "revoked": false
        }
      ]
    }
  ]
}
```

**Registry rules:**

- Implementations MAY alternatively support DID-based resolution (e.g., `did:web:`, `did:key:`) instead of or in addition to the `.well-known` endpoint
- A credential with `"revoked": true` MUST cause verification to fail
- Implementations SHOULD support credential rotation — multiple active credentials per principal
- The registry MUST be served over HTTPS in production deployments
- Implementations MAY require mutual TLS or bearer tokens to access the registry

### 17.7 Conformance

| Conformance Level | Requirement |
|-------------------|-------------|
| **Core** | Authorization proof is OPTIONAL — implementations MAY ignore `authorization_proof` fields entirely |
| **Extended** | Implementations SHOULD support at least one attestation type from Section 18 and SHOULD verify proofs when present |
| **Authorization-Required** | A future conformance level (not yet defined) where implementations MUST require authorization proof for all cross-organisation messages |

Implementations MAY require authorization proof for specific actions regardless of conformance level (e.g., cross-organisation proposals, high-trust-level operations, financial transactions).

### 17.8 HumanPrincipal Cardinality

A `human_principal_id` MAY be one of many principals held by the same human. PACT adopts a **1-to-many** model with optional cross-principal linkage:

- **One human MAY hold multiple `HumanPrincipal`s.** Each principal carries its own signing key, audit stream, and (where applicable) payment-rail nominations. Typical examples: separate `Personal`, `Trade`, `Household`, `Creative` principals for the same human acting in distinct roles.
- **Verifiers MUST treat each principal as a distinct counterparty.** A verifier MUST NOT assume two principals share a human root unless an explicit cross-principal attestation is presented.
- **Cross-principal linkage is OPTIONAL** via a chain-of-trust attestation: a root-credential attestation signs over each per-entity principal's enrollment record. This pattern is closer to a sub-CA / EV-certificate chain than to a "persona" claim, and SHOULD be used when a verifier needs to prove "these two principals are the same human."
- **An optional `persona` claim MAY appear on a signed message** for context-switching *within* a single principal (e.g., the same `Trade` principal acting as "speaker at conference X" vs "invoicing client Y"). The `persona` claim is a narrower mechanism than separate principals — it does not span audit streams or payment rails, and is purely advisory metadata for the receiving agent.

**Why not strictly 1:1.** The strict 1:1 reading collapses role-distinct identities (e.g., `Personal` vs `Trade`) into a single wire identity, forcing verifiers into bespoke per-implementation introspection to recover the role. The 1:N model gives any verifier a clean answer at the protocol layer without leaking implementation-internal abstractions.

**Reference downstream:** the [HMAN multi-entity model](https://github.com/Tailor-AUS/Human-Managed-Access-Network/blob/main/PROTOCOL.md#multi-entity-model) is a non-normative reference for the 1:N pattern.

### 17.9 Open Questions

These questions are under active discussion and will be resolved in a future version:

1. **Credential enrollment:** How does an agent prove its association with a specific human principal? Options include OAuth-based enrollment, in-person verification, or web-of-trust attestation.
2. **Revocation propagation:** What happens when a human revokes an agent's authorization mid-conversation? Should revocation be immediate (requiring real-time registry checks) or eventually consistent?
3. **Delegation depth:** Can an authorized agent delegate to sub-agents, and how deep does the trust chain extend? The `attestation_chain` field supports this, but maximum depth and trust decay are undefined.
4. **Offline verification:** Can proof-of-authorization be verified without calling back to the credential registry? Pre-fetched public keys and signed credential bundles could enable this.
5. **Privacy:** How to prevent authorization proofs from becoming surveillance artifacts? Selective disclosure, zero-knowledge proofs, and proof expiration are candidate mitigations.
6. **Cross-principal linkage trust decay:** The chain-of-trust attestation pattern (§17.8) is defined but trust-decay rules — e.g., does a revoked root-credential attestation invalidate all per-entity principals immediately, or do the per-entity attestations remain valid until their own expiry? — are undefined. Candidate: mirror the X.509 OCSP / CRL model.

---

## 18. Attestation Format Reference (v1.2-draft)

> **Status:** Draft — defines the attestation types referenced by §17. Implementations may support additional custom types.

This section defines the standard attestation types that can appear in `authorization_proof.type`. Each type specifies its signing and verification mechanics.

### 18.1 Comparison Matrix

| Type | Based On | Hardware Required | Privacy | Offline Verify | Maturity |
|------|----------|-------------------|---------|----------------|----------|
| `fido2-assertion` | WebAuthn / FIDO2 | Yes (authenticator) | High (no biometric leaves device) | Yes | Established standard |
| `vc-jwt` | W3C Verifiable Credentials | No | Medium (claims are portable) | Yes | W3C Recommendation |
| `biometric-hash` | Proprietary | Yes (biometric sensor) | High (zero-knowledge hash) | Depends on implementation | Emerging |
| `passphrase-signed` | HMAC-SHA256 / Ed25519 | No | Low (typed secret) | Yes | Established primitives |
| `voice-biometric` | Voice-embedding similarity + utterance hash | Yes (microphone) | High (zero-knowledge embedding match) | Yes | RFC pending — see [#3](https://github.com/TailorAU/pact/issues/3) |

### 18.2 `fido2-assertion`

**Based on:** [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/) / FIDO2

**Signing:** The human activates a FIDO2 authenticator (USB key, platform authenticator, phone). The authenticator signs the PACT message hash + nonce using its private key. The signature, authenticator data, and client data JSON are included in the `authorization_proof`.

**Verification:** The receiving agent retrieves the enrolled public key from the credential registry and verifies the WebAuthn assertion signature. Standard WebAuthn verification applies: check signature, verify relying party ID, confirm user presence (UP) and optionally user verification (UV) flags.

**When to use:** High-security scenarios, cross-organisation proposals, financial transactions. Preferred when both parties have hardware authenticator infrastructure.

### 18.3 `vc-jwt`

**Based on:** [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)

**Signing:** A trusted issuer (identity provider, organisation, government) issues a Verifiable Credential as a JWT. The VC contains claims about the human principal (e.g., "Knox Hart is an authorized user of Organization X"). The agent includes this VC-JWT in the `authorization_proof.signature` field.

**Verification:** The receiving agent verifies the JWT signature against the issuer's public key (resolved via DID or `.well-known/jwks.json`). The agent then checks that the VC claims match the `human_principal_id` and that the VC has not expired or been revoked.

**When to use:** Federated identity scenarios, government-issued credentials, cross-platform agent interactions where a common issuer is trusted by both parties.

### 18.4 `biometric-hash`

**Based on:** Proprietary biometric attestation (vendor-specific)

**Signing:** A biometric sensor (voice print, fingerprint, facial recognition) captures a biometric sample. The device computes a zero-knowledge hash or proof that the biometric matches an enrolled template, without transmitting the raw biometric data. The proof is signed by the device's attestation key.

**Verification:** The receiving agent verifies the device attestation signature and confirms the biometric proof is valid. The specific verification mechanism depends on the device vendor's attestation format. Implementations SHOULD publish supported device attestation formats in their Implementation Profile.

**When to use:** High-assurance scenarios requiring continuous human presence (e.g., real-time voice authorization during a call). Privacy-preserving since no biometric data leaves the device.

### 18.5 `passphrase-signed`

**Based on:** HMAC-SHA256 or Ed25519 signatures from a shared or asymmetric secret

**Signing:** The human types a passphrase or activates a software key. The agent derives a signing key (via PBKDF2/Argon2 for passphrases, or uses a stored Ed25519 private key) and signs the PACT message hash + nonce.

**Verification:** The receiving agent verifies the signature against the enrolled public key (Ed25519) or recomputes the HMAC using the shared secret. For HMAC-based schemes, both parties must have previously exchanged the shared secret through a secure channel.

**When to use:** Low-ceremony scenarios, bootstrapping trust before hardware authenticators are available, development/testing environments. Not recommended for high-security cross-organisation use cases due to the lower assurance level.

### 18.6 `voice-biometric` (RFC, pending PR — see [#3](https://github.com/TailorAU/pact/issues/3))

> **Status:** RFC accepted in principle for v1.2-draft; canonical text and test vectors will land via the [#3 PR](https://github.com/TailorAU/pact/issues/3) from the HMAN team. The text below is a structural placeholder transcribing the design refinements from the [maintainer comment on #3](https://github.com/TailorAU/pact/issues/3) — not authoritative until the PR merges.

**Based on:** Voice-embedding similarity (Resemblyzer-class) + utterance hash binding

**Distinguishing property:** Captures *intent* (a specific spoken utterance) rather than just *presence* (a passkey tap). The difference between "the human is at their keyboard" and "the human said *send the message*."

**Design refinements adopted for the PR:**

1. **Replay protection.** `challenge_nonce` MUST be either (a) signed by the verifier's key, or (b) carry a `verifier_id` claim. Otherwise an assertion captured for verifier A can be replayed at verifier B.

2. **Embedding versioning.** `embedding_alg_version` (or a version suffix in `embedding_alg`) is REQUIRED so model swaps and retrains do not silently invalidate enrolled references.

3. **Match sub-object for forward compatibility.** `score` and `threshold` live inside a `match` object so future modalities (face, gait, keystroke dynamics) reuse the same field shape:

   ```json
   "match": {
     "alg": "resemblyzer-v1",
     "score": 0.91,
     "threshold": 0.75
   }
   ```

4. **Utterance binding.** `utterance_hash` is normative. Non-normative note: the *content* of the utterance matters at the application layer — a verifier requiring "approve transfer of $5000 to Bridget" MUST reject a valid voice match against the wrong utterance hash.

**Reference implementation (non-normative):** HMAN's stack — Resemblyzer + Fernet (AES-128-CBC + HMAC-SHA256) + PBKDF2-SHA256 600k iterations + in-process-only decryption + per-session re-arm + hash-chained JSONL audit. Citation conditional on test vectors landing in the [#3 PR](https://github.com/TailorAU/pact/issues/3).

**When to use:** Real-time intent-bearing authorization on voice channels (calls, dictation, multi-party negotiation) where presence-only credentials are insufficient.

### 18.7 Custom Attestation Types

Implementations MAY define custom attestation types using reverse-domain notation (e.g., `com.example.voice-print`, `au.gov.mygovid`). Custom types MUST:

- Use the same `authorization_proof` envelope defined in §17.4
- Document their signing and verification mechanics
- Be declared in the implementation's `.well-known/pact-credentials.json` under a `supported_types` array

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

Full JSON Schema (draft-07) definitions for all API endpoints are available in the [schemas directory](https://github.com/TailorAU/pact/tree/main/spec/v1.2/schemas). All 26 schemas listed below are validated by CI on every push.

**Core protocol primitives:**

| Schema | Endpoint | Description |
|---|---|---|
| `join-request.json` | `POST /join` | Agent registration request |
| `join-response.json` | `POST /join`, `POST /join-token` | Agent registration response |
| `join-token-request.json` | `POST /join-token` | BYOK join flow with invite token |
| `proposal-request.json` | `POST /proposals` | Edit proposal creation |
| `proposal-response.json` | `POST /proposals` | Edit proposal with constraint warnings |
| `intent-request.json` | `POST /intents` | Intent declaration on a section |
| `constraint-request.json` | `POST /constraints` | Constraint publication |
| `salience-request.json` | `POST /salience` | Salience score assignment |
| `lock-request.json` | `POST /sections/{id}/lock` | Section lock with TTL |
| `done-request.json` | `POST /done` | Agent completion signal |
| `ask-human-request.json` | `POST /ask-human` | Human escalation |
| `resolve-request.json` | `POST /resolve` | Human resolution of an escalation |
| `error-response.json` | All endpoints | Standard error envelope |
| `event.json` | Events / polling | Event structure (Section 6) |

**Information barriers (Extended conformance — see §7.4 for route alignment status):**

| Schema | Endpoint | Description |
|---|---|---|
| `classification-framework-request.json` | (alignment pending — §7.4) | Classification framework definition |
| `classify-section-request.json` | (alignment pending — §7.4) | Section classification assignment |
| `clearance-request.json` | (alignment pending — §7.4) | Agent clearance grant |

**Invite tokens (Extended conformance):**

| Schema | Endpoint | Description |
|---|---|---|
| `invite-create-request.json` | `POST /{docId}/invites` | Invite token creation |
| `invite-response.json` | `POST /{docId}/invites` | Invite response (secret token shown once) |

**Mediated communication (Extended conformance — §13):**

| Schema | Endpoint | Description |
|---|---|---|
| `message-send-request.json` | `POST /{docId}/messages` | Send a message via the mediator |
| `message-response.json` | (delivered message) | Mediated message as delivered (may be summarised, redacted, or blocked) |
| `query-submit-request.json` | `POST /{docId}/queries` | Submit a structured query (graduated disclosure) |
| `query-respond-request.json` | `POST /{docId}/queries/{id}/respond` | Respond to a routed query |
| `negotiation-position-request.json` | `POST /{docId}/negotiations/{id}/position` | Submit position in a structured negotiation round |
| `negotiation-response.json` | (negotiation envelope) | Multi-round negotiation envelope |
| `register-entry.json` | (Message Register entry) | Append-only mediator audit entry — human-custodian-only visibility |

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

*PACT Specification v1.2-draft — April 2026.*

*Status: Draft, not for production.*

*Reference implementation: [Tailor](https://tailor.au) by [TailorAU](https://github.com/TailorAU) — see [Tailor Implementation Notes](./PACT_TAILOR_IMPLEMENTATION.md) for implementation-specific details.*

> **Standalone spec:** [github.com/TailorAU/pact](https://github.com/TailorAU/pact) — vendor-neutral specification auto-synced from this file.
