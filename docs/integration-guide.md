# PACT Integration Guide

How platforms can integrate PACT to enable structured multi-agent collaboration on shared content.

---

## Overview

PACT provides a standard protocol for AI agents to collaborate on documents. Any platform that has **shared content** and **multiple contributors** (human or AI) can benefit from PACT.

This guide shows how specific platform types could integrate PACT's primitives — proposals, intents, constraints, salience, and consensus — into their existing workflows.

---

## Integration Architecture

```
┌──────────────────────────────────────────────┐
│              Your Platform                    │
│                                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │ Agent A │  │ Agent B │  │ Agent C │      │
│  └────┬────┘  └────┬────┘  └────┬────┘      │
│       │            │            │             │
│       ▼            ▼            ▼             │
│  ┌────────────────────────────────────┐      │
│  │         PACT API Layer             │      │
│  │  (REST / MCP / WebSocket)          │      │
│  │                                    │      │
│  │  Proposals · Intents · Constraints │      │
│  │  Salience · Objections · Escalation│      │
│  └────────────────────────────────────┘      │
│       │                                       │
│       ▼                                       │
│  ┌────────────────────────────────────┐      │
│  │     Shared Document (Markdown)     │      │
│  │     Event-sourced operation log    │      │
│  └────────────────────────────────────┘      │
│       │                                       │
│       ▼                                       │
│  ┌────────────────────────────────────┐      │
│  │     Human Review UI                │      │
│  │     (overrides any agent decision) │      │
│  └────────────────────────────────────┘      │
└──────────────────────────────────────────────┘
```

### Two Integration Approaches

| Approach | Description | Complexity |
|----------|-------------|------------|
| **Client-side** | Your agents call a PACT-compatible server (e.g., Tailor) via REST/MCP | Low — no server changes needed |
| **Server-side** | Your platform implements the PACT specification natively | High — full protocol implementation |

Most platforms should start **client-side** (use an existing PACT server) and move to **server-side** only if they need deep integration.

---

## Platform-Specific Integration Patterns

### Forum / Community Platforms (Reddit, Discourse, etc.)

**Use case:** Multiple AI agents help a community draft shared documents — policies, FAQs, guidelines — with structured consensus instead of chaotic comment threads.

**How it maps:**

| Forum concept | PACT primitive | Behavior |
|---------------|---------------|----------|
| Thread / post | Document | The shared content being collaborated on |
| Reply | Proposal | A suggested edit to a specific section |
| Upvote/downvote | Salience | How much a participant cares about a section |
| Disagreement | Objection | Blocks auto-merge, requires discussion |
| Moderator intervention | Escalation | When agents can't agree, humans decide |
| Flair / category | Constraint | Boundary conditions on what's acceptable |

**Integration flow:**

```
1. Community creates a "collaborative document" thread
2. AI agents join via invite tokens (BYOK — no accounts needed)
3. Each agent reads the document and declares intents
4. Agents publish constraints ("Must comply with community rules")
5. Agents propose edits to specific sections
6. Proposals auto-merge after TTL if no community member objects
7. Contested sections get escalated to moderators
```

**Key benefit:** Transforms unstructured debate into structured consensus. Instead of 200 comments arguing, you get clear proposals, constraints, and merge-or-object decisions.

---

### Chat Platforms (Discord, Slack, Teams)

**Use case:** AI bots in a workspace collaboratively maintain shared documents — meeting notes, runbooks, project plans.

**How it maps:**

| Chat concept | PACT primitive | Behavior |
|-------------|---------------|----------|
| Channel | Document | Each channel's pinned document |
| Bot message | Proposal | Bot suggests a change, channel reacts |
| Emoji reaction | Approve / Object | Thumbs-up approves, thumbs-down objects |
| Thread | Negotiation | Structured back-and-forth on a proposal |
| @mention moderator | Escalation | Bot can't resolve, pings a human |

**Example Discord bot flow:**

```
Bot A: 📝 Proposing change to **#runbook** section "Incident Response":
       > Add step: "Check PagerDuty before restarting services"
       React ✅ to approve, ❌ to object. Auto-merges in 5 minutes.

User:  ❌ (objects)
User:  "We should check Datadog too, not just PagerDuty"

Bot A: 📝 Updated proposal:
       > Add step: "Check PagerDuty and Datadog before restarting"
       React ✅ to approve, ❌ to object.

       (no objections for 5 minutes)

Bot A: ✅ Merged into #runbook.
```

---

### Knowledge Base / Wiki Platforms (Notion, Confluence, GitBook)

**Use case:** AI agents maintain and update documentation, with human reviewers approving changes.

**How it maps:**

| Wiki concept | PACT primitive | Behavior |
|-------------|---------------|----------|
| Page | Document | Content being maintained |
| Page section | Section | PACT's section-level targeting |
| Suggested edit | Proposal | Agent proposes, humans approve |
| Comment | Intent / Constraint | Pre-alignment before editing |
| Page lock | Lock | Prevents concurrent edits (60s max) |
| Review workflow | Approval Policy | Configurable: unanimous, majority, auto-merge |

---

### Code Review Platforms (GitHub, GitLab)

**Use case:** AI agents review PRs and collaboratively suggest improvements to design docs, ADRs, and RFC documents tracked in the repo.

**How it maps:**

| Git concept | PACT primitive | Behavior |
|------------|---------------|----------|
| File in repo | Document | Design docs, ADRs, RFCs |
| PR comment | Proposal | Suggested change to a section |
| Review approval | Approve | Agent approves a proposal |
| Request changes | Objection | Blocks merge, forces revision |
| CODEOWNERS | Salience | Which agents care about which sections |
| CI check | Constraint | Automated boundary enforcement |

---

### Content Management (CMS, Publishing)

**Use case:** AI writing assistants and editorial bots collaborate on articles, with human editors retaining final authority.

**How it maps:**

| CMS concept | PACT primitive | Behavior |
|------------|---------------|----------|
| Article | Document | Content being written |
| Draft revision | Proposal | Suggested edit with diff |
| Editorial guideline | Constraint | "Must be under 2000 words", "No jargon" |
| Editor priority | Salience | Which sections need the most attention |
| Publish approval | Escalation | Final human sign-off before publish |

---

## Implementation Checklist

For platforms implementing PACT server-side:

### Minimum Viable PACT (v0.3 Core)

- [ ] Agent join/leave lifecycle
- [ ] Document content and section tree endpoints
- [ ] Proposal create/list/approve/reject
- [ ] Objection-based merge (silence = consent)
- [ ] Section locking (with TTL)
- [ ] Escalation to human
- [ ] Event history endpoint
- [ ] JSON Schema validation for all request/response bodies

### Full PACT (v0.4)

Everything above, plus:

- [ ] Invite tokens (BYOK zero-trust onboarding)
- [ ] Intent-Constraint-Salience framework
- [ ] Information barriers (classification, clearance, dissemination)
- [ ] Mediated communication (message register, graduated disclosure)
- [ ] Structured negotiation
- [ ] Real-time events (WebSocket/SignalR)
- [ ] MCP tool surface

### Conformance Testing

The PACT specification includes JSON Schema definitions for all API request/response bodies. Use these to validate your implementation:

```bash
# Schemas are in the spec directory
ls spec/v0.4/schemas/
# → propose-request.json, propose-response.json, ...

# Validate with any JSON Schema validator
npx ajv validate -s spec/v0.4/schemas/propose-request.json -d your-test-payload.json
```

---

## Getting Started

1. **Read the specification:** [spec/v0.4/SPECIFICATION.md](../spec/v0.4/SPECIFICATION.md)
2. **Try the examples:** [examples/](../examples/)
3. **Use the reference implementation:** [Tailor](https://tailor.au) (client-side integration)
4. **Build your own:** Implement the API surface defined in the spec (server-side integration)
5. **List your implementation:** Open a PR to add it to the [README](../README.md#implementations)

---

## Questions?

Open an issue at [github.com/TailorAU/pact](https://github.com/TailorAU/pact/issues) with the `integration` label.
