<p align="center">
  <img src="https://img.shields.io/badge/spec-v0.4--draft-blue" alt="Spec Version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" />
  <img src="https://img.shields.io/github/stars/TailorAU/pact?style=social" alt="Stars" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" />
</p>

# PACT -- Protocol for Agent Consensus and Truth

**The missing protocol for multi-agent document collaboration.**

[Specification](spec/v0.4/SPECIFICATION.md) · [Getting Started](spec/v0.4/GETTING_STARTED.md) · [Examples](examples/) · [Contributing](CONTRIBUTING.md)

---

## The Problem

You have 3 AI agents that need to negotiate a contract. Agent A drafts liability clauses. Agent B enforces budget caps. Agent C checks regulatory compliance.

How do they collaborate on the same document without stepping on each other?

**MCP** gives agents tools. **A2A** gives agents communication. But neither gives agents a **shared document with structured consensus rules**, human oversight, and information barriers.

**PACT does.**

## Where PACT Fits

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agent Ecosystem                    │
├──────────────┬──────────────┬───────────────────────────┤
│     MCP      │     A2A      │          PACT             │
│  Tools/Data  │  Agent Comms │  Document Collaboration   │
│              │              │                           │
│  "Hands"     │  "Voices"    │  "Shared negotiation      │
│              │              │   table"                  │
└──────────────┴──────────────┴───────────────────────────┘
```

| Protocol | Connects agents to... | Example |
|----------|----------------------|---------|
| **MCP**  | Tools and data       | "Read this database" |
| **A2A**  | Other agents         | "Tell Agent B to start" |
| **PACT** | Shared documents     | "Propose a change to section 3, respect Agent B's constraints" |

## How It Works

PACT introduces a simple but powerful loop: **Intent -> Constraint -> Propose -> Consensus.**

```
┌─────────────────────────────────────────────────────────────────┐
│                        PACT Workflow                            │
│                                                                 │
│  Agent A                  Document                  Agent B     │
│  ┌──────┐                ┌────────┐                ┌──────┐    │
│  │Legal │──intent───────>│        │<───constraint───│Budget│    │
│  │      │  "Add currency │sec:    │  "Cap at $2M"  │      │    │
│  │      │   risk clause" │liability                │      │    │
│  │      │                │        │                │      │    │
│  │      │──propose──────>│  ✏️    │                │      │    │
│  │      │                │        │──notify──────> │      │    │
│  │      │                │        │                │      │    │
│  │      │                │        │   No objection │      │    │
│  │      │                │        │<───(silence)────│      │    │
│  │      │                │        │                │      │    │
│  │      │                │ ✅ Auto│                │      │    │
│  │      │                │ merged │                │      │    │
│  └──────┘                └────────┘                └──────┘    │
│                                                                 │
│  Humans can override ANY decision at ANY time.                  │
└─────────────────────────────────────────────────────────────────┘
```

## The Core Primitives

| Primitive | What it does | Why it matters |
|-----------|-------------|----------------|
| **Intent** | "I want to add X to this section" | Catches misalignment before anyone writes |
| **Constraint** | "X must not exceed $2M" | Reveals limits without revealing reasoning |
| **Salience** | Score 0-10: how much you care | Focuses attention on contested sections |
| **Proposal** | Actual edit with TTL | Auto-merges if nobody objects (silence = consent) |
| **Objection** | "This violates my constraint" | Blocks auto-merge, forces renegotiation |
| **Escalation** | "Humans, we need you" | Agents know when to stop and ask |

## Quick Start

### CLI (recommended)

```bash
# Install the standalone PACT CLI
npm install -g @pact-protocol/cli

# Configure your PACT server
pact config --server https://your-pact-server.com --key YOUR_API_KEY

# Join a document as an agent
pact join <documentId> --as "my-agent" --role editor

# Read the document
pact get <documentId>

# Propose a change to a section
pact propose <documentId> \
  --section sec:intro \
  --content "Revised and improved text." \
  --summary "Simplified intro paragraph"

# See what other agents are doing
pact poll <documentId> --since evt_0

# Signal you're done
pact done <documentId> --status aligned --summary "Review complete"
```

### REST API

```bash
# Join a document (no account needed -- just an invite token)
curl -X POST https://your-pact-server.com/api/pact/{docId}/join-token \
  -H "Content-Type: application/json" \
  -d '{"agentName": "my-agent", "token": "INVITE_TOKEN"}'

# Read the document
curl https://your-pact-server.com/api/pact/{docId}/content \
  -H "X-Api-Key: SCOPED_KEY"

# Propose a change (auto-merges after TTL if no objections)
curl -X POST https://your-pact-server.com/api/pact/{docId}/proposals \
  -H "X-Api-Key: SCOPED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sectionId": "sec:intro",
    "newContent": "# Introduction\n\nRevised and improved text.",
    "summary": "Simplified intro paragraph"
  }'
```

### MCP Server (for AI agents)

```bash
# Run the PACT MCP server (for Cursor, LangChain, CrewAI, etc.)
PACT_BASE_URL=https://your-pact-server.com PACT_API_KEY=YOUR_KEY npx @pact-protocol/mcp
```

## Integration Paths

| Path | Best for | Get started |
|------|----------|-------------|
| **CLI** | Shell scripts, CI/CD, prototyping | `npm i -g @pact-protocol/cli` |
| **REST API** | Python/TS agents, custom frameworks | [Getting Started](spec/v0.4/GETTING_STARTED.md) |
| **MCP Tools** | LangChain, CrewAI, AutoGen, Claude, Cursor | `npx @pact-protocol/mcp` |
| **SignalR / WebSocket** | Real-time event-driven agents | [SignalR Events](spec/v0.4/SPECIFICATION.md#signalr) |

## Use Cases

**Contract Negotiation** -- Legal, commercial, and compliance agents negotiate terms. Each declares constraints, proposes edits, and the document converges through structured consensus.

**Multi-Agent Code Review** -- Security, performance, and style agents review a design doc. High-salience sections get the most attention. Disagreements escalate to human architects.

**Policy Drafting** -- Regulatory agents maintain compliance policies across jurisdictions. Information barriers prevent cross-pollination of confidential reasoning.

**Community Consensus** -- Multiple stakeholders collaborate on shared documents. Proposals auto-merge when nobody objects; contested sections get escalated for human review.

## Design Principles

1. **Humans always win.** Any human can override any agent decision, at any time, no exceptions.
2. **Silence is consent.** Proposals auto-merge after TTL unless actively objected to.
3. **Document is always valid Markdown.** No protocol metadata pollutes the document body.
4. **Section-level granularity.** Operations target headings, not character offsets.
5. **Event-sourced truth.** The operation log is the source of truth. The document is a projection.
6. **Transport-agnostic.** REST, CLI, MCP, WebSocket -- use whatever fits your stack.

## What's New in v0.4

- **Information Barriers** -- Classification frameworks, agent clearance levels, dissemination controls
- **Message Register** -- Append-only audit log of all inter-agent communication
- **Graduated Disclosure** -- 4-level framework controlling what agents can see
- **Structured Negotiation** -- Multi-round position exchanges facilitated by a mediator
- **Invite Tokens (BYOK)** -- Zero-trust agent onboarding; no account required

## Tooling

| Package | Description | Install |
|---------|-------------|---------|
| [`@pact-protocol/cli`](cli/) | Standalone CLI for any PACT server | `npm i -g @pact-protocol/cli` |
| [`@pact-protocol/mcp`](mcp/) | MCP server for AI agent frameworks | `npx @pact-protocol/mcp` |

## Specification

| Version | Status | Docs |
|---------|--------|------|
| **v0.4** | Draft | [Specification](spec/v0.4/SPECIFICATION.md) · [Getting Started](spec/v0.4/GETTING_STARTED.md) |
| **v0.3** | Stable | [Specification](spec/v0.3/SPECIFICATION.md) · [Getting Started](spec/v0.3/GETTING_STARTED.md) |

## Implementations

| Implementation | Description | Status | Maintainer |
|---------------|-------------|--------|------------|
| [**Source**](https://source.tailor.au) | Verified knowledge graph -- facts verified through multi-agent consensus | Live | [TailorAU](https://github.com/TailorAU) |
| [**Tailor**](https://tailor.au) | AI document collaboration platform -- reference implementation | Live | [TailorAU](https://github.com/TailorAU) |

Building a PACT implementation? [Open a PR](https://github.com/TailorAU/pact/pulls) to add it here.

## Community

- [**GitHub Issues**](https://github.com/TailorAU/pact/issues) -- Bug reports, feature requests, spec discussions
- [**Contributing Guide**](CONTRIBUTING.md) -- How to contribute to the specification
- [**Code of Conduct**](CODE_OF_CONDUCT.md) -- Community standards
- [**Security Policy**](SECURITY.md) -- Reporting vulnerabilities

## License

**[MIT](LICENSE)** -- Use PACT however you want. Build implementations, fork it, extend it.

PACT is maintained by [TailorAU](https://github.com/TailorAU). The specification is open and vendor-neutral -- anyone can implement it.
