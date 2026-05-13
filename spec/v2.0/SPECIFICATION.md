# PACT — Protocol for Agent Consensus and Truth — Specification v2.0-draft

> **Status:** Draft (in development)  
> **Author:** Knox Hart + AI  
> **Date:** 13 May 2026  
> **Version:** 2.0-draft (supersedes v1.1; v1.2-draft was collapsed into this version — see [`docs/v2-plan.yaml`](../../docs/v2-plan.yaml))  
> **Vision:** Enable millions of agents to reach consensus on shared resources at machine speed, with humans retaining final authority.

### What's New in v2.0 (draft)

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
    "asserted_at": "2026-05-13T10:30:00Z",
    "signature": "base64url-...",
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
| `challenge_nonce` | string | Yes | Verifier-issued challenge. MUST be either signed by the verifier's key OR carry a `verifier_id` claim — otherwise a proof captured for verifier A can be replayed at verifier B. |
| `asserted_at` | string (ISO 8601) | Yes | When the human authorization was captured. |
| `signature` | string | Yes | Signature over the message payload + `challenge_nonce` + `asserted_at`, per the `type`'s suite. |
| `attestation_chain` | array | No | Ordered intermediate attestations for delegated authorization (§17.11). Empty or absent = direct. |

### 17.7 Verification Flow

On receiving a message bearing `authorization_proof`, a verifying party MUST:

1. **Type dispatch** — select the verification procedure for `type` (§18). Unrecognised `type` → unverifiable.
2. **Principal resolution** — resolve `principal_id` (DID resolution for `did:web` / `did:key` / etc., or the credential registry `/.well-known/pact-credentials.json`; §17.8). Resolution failure → unverifiable.
3. **Signature verification** — verify `signature` against the public key enrolled for `credential_id` under `principal_id`, per the `type`'s suite.
4. **Freshness** — `asserted_at` MUST be within the implementation's allowed clock skew (default ±5 minutes; configurable).
5. **Replay** — `challenge_nonce` MUST match a challenge the verifier (or its server) issued and not yet retired, OR be a verifier-signed nonce / carry a matching `verifier_id`.
6. **Result** — any failure → the verifier SHOULD reject the message and MAY emit `pact.trust.violation` with `payloadJson.kind = "authorization_failed"` and the failing step. Success → the message is treated as human-authorized by `principal_id`.

Verifiers MAY cache a successful resolution for the life of a session to avoid repeated registry / DID lookups; they MUST honour revocation (§17.8) within the cache's max-age hint.

### 17.8 Credential Registry

A PACT server MAY publish `/.well-known/pact-credentials.json`:

```json
{
  "version": "1.0",
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

**Registry rules:**

- An implementation MAY instead (or also) support DID-document resolution for the public keys.
- A credential with `"revoked": true` MUST cause verification to fail.
- Implementations SHOULD support rotation — multiple active credentials per principal.
- The registry MUST be served over HTTPS in production; the server MAY require mTLS or a bearer token to read it.
- A `Cache-Control: max-age` (or equivalent) hint bounds how stale a cached resolution may be; absent a hint, implementations SHOULD re-check at least every 5 minutes.
- **Erasure / tombstone:** a human's withdrawal is effected by **cryptographic erasure** — destroying / revoking the credential keys — leaving a tombstone (`{"id": "...", "tombstoned_at": "...", "credentials": []}`) so prior proofs remain checkable as having-been-valid-then-revoked without the key material persisting (see §17.10).

### 17.9 Conformance

| Conformance Level | Requirement |
|-------------------|-------------|
| **Core** | `authorization_proof` is OPTIONAL — an implementation MAY ignore the field entirely. |
| **Extended** | SHOULD support at least one attestation type from §18 and SHOULD run the §17.7 verification when a proof is present. |
| **Authorization-Required** | MUST require a valid `authorization_proof` on every cross-organisation message; MUST reject any proof whose `principal_id` resolution implies the principal spans more than one human; MUST support the credential registry (or DID resolution) and revocation propagation. No implementation is required to claim this tier at v2.0 launch — it is defined so the protocol's trajectory is clear and so cross-org / regulated deployments have a target. |

Implementations MAY require `authorization_proof` for specific operations regardless of their declared tier (e.g. cross-organisation proposals, high-trust-level operations, financial transactions).

### 17.10 Personal data (GDPR / right-to-be-forgotten)

- **Event-log entries are protocol-integrity records** — retained for as long as the resource's audit trail is retained, and not subject to erasure-on-request, because removing them breaks the event-sourced consistency guarantee. An `authorization_proof` recorded in the event log SHOULD carry only the `principal_id` (a DID — itself rotatable / revocable) and a salted hash of the proof payload, NOT raw biometric data or other PII. Raw biometric material MUST NOT appear in the event log under any circumstance (see §18.3).
- **Credential-registry entries** are personal data and support erasure via cryptographic key destruction + tombstone (§17.8).

### 17.11 Delegation

`attestation_chain` carries an ordered list of intermediate attestations: a chain `[A0, A1, ...]` means principal `A0` authorized the next, and so on, to the message signer. Maximum chain length is **3 hops** (direct + 2 sub-delegations) at v2.0 — a starting point pending implementation feedback; longer chains amplify revocation lag and reduce auditability. Trust-decay rules along the chain (does a revoked `A0` invalidate `A1..n` immediately, or do they stand until their own expiry?) are deferred to the coordinated PR — candidate model: mirror X.509 OCSP / CRL.

### 17.12 Open Questions (deferred to a reviewed PR)

1. **Credential enrollment** — how does an agent prove its association with a specific human principal? (OAuth-based enrollment, in-person verification, web-of-trust attestation.)
2. **Revocation propagation** — immediate (real-time registry checks) vs eventually consistent.
3. **Offline verification** — pre-fetched public keys / signed credential bundles to verify without a registry round-trip.
4. **Delegation trust-decay** — the §17.11 cap is set; the decay model along the chain is not.
5. **Custom attestation types** — pre-registration required, or naming-convention only? (Current lean: naming-convention only — §18.5.)

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

Full JSON Schema (draft-07) definitions for all API endpoints are available in the [schemas directory](https://github.com/TailorAU/pact/tree/main/spec/v2.0/schemas).

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

*PACT Specification v2.0-draft — May 2026.*

*Reference implementation: [Tailor](https://tailor.au) by [TailorAU](https://github.com/TailorAU) — see [Tailor Implementation Notes](./PACT_TAILOR_IMPLEMENTATION.md) for implementation-specific details.*

> **Standalone spec:** [github.com/TailorAU/pact](https://github.com/TailorAU/pact) — vendor-neutral specification auto-synced from this file.
