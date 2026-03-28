<p align="center">
  <img src="https://img.shields.io/badge/spec-v0.4--draft-blue" alt="Spec Version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" />
  <img src="https://img.shields.io/github/stars/TailorAU/pact?style=social" alt="Stars" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" />
</p>

# PACT â€” Protocol for Agent Consensus and Truth

**The missing protocol for multi-agent document collaboration.**

[Specification](spec/v0.4/SPECIFICATION.md) Â· [Getting Started](spec/v0.4/GETTING_STARTED.md) Â· [Examples](examples/) Â· [Contributing](CONTRIBUTING.md)

---

## The Problem

You have 3 AI agents that need to negotiate a contract. Agent A drafts liability clauses. Agent B enforces budget caps. Agent C checks regulatory compliance.

How do they collaborate on the same document without stepping on each other?

**MCP** gives agents tools. **A2A** gives agents communication. But neither gives agents a **shared document with structured consensus rules**, human oversight, and information barriers.

**PACT does.**

## Where PACT Fits

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    AI Agent Ecosystem                    â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚     MCP      â”‚     A2A      â”‚          PACT             â”‚
â”‚  Tools/Data  â”‚  Agent Comms â”‚  Document Collaboration   â”‚
â”‚              â”‚              â”‚                           â”‚
â”‚  "Hands"     â”‚  "Voices"    â”‚  "Shared negotiation      â”‚
â”‚              â”‚              â”‚   table"                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Protocol | Connects agents to... | Example |
|----------|----------------------|---------|
| **MCP**  | Tools and data       | "Read this database" |
| **A2A**  | Other agents         | "Tell Agent B to start" |
| **PACT** | Shared documents     | "Propose a change to section 3, respect Agent B's constraints" |

## How It Works

PACT introduces a simple but powerful loop: **Intent â†’ Constraint â†’ Propose â†’ Consensus.**

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                        PACT Workflow                            â”‚
â”‚                                                                 â”‚
â”‚  Agent A                  Document                  Agent B     â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”                â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”                â”Œâ”€â”€â”€â”€â”€â”€â”    â”‚
â”‚  â”‚Legal â”‚â”€â”€intentâ”€â”€â”€â”€â”€â”€â”€â–¶â”‚        â”‚â—€â”€â”€constraintâ”€â”€â”€â”‚Budgetâ”‚    â”‚
â”‚  â”‚      â”‚  "Add currency â”‚sec:    â”‚  "Cap at $2M"  â”‚      â”‚    â”‚
â”‚  â”‚      â”‚   risk clause" â”‚liability                â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚        â”‚                â”‚      â”‚    â”‚
â”‚  â”‚      â”‚â”€â”€proposeâ”€â”€â”€â”€â”€â”€â–¶â”‚  âœï¸    â”‚                â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚        â”‚â”€â”€notifyâ”€â”€â”€â”€â”€â”€â–¶ â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚        â”‚                â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚        â”‚   No objection â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚        â”‚â—€â”€â”€(silence)â”€â”€â”€â”€â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚        â”‚                â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚ âœ… Autoâ”‚                â”‚      â”‚    â”‚
â”‚  â”‚      â”‚                â”‚ merged â”‚                â”‚      â”‚    â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”˜                â””â”€â”€â”€â”€â”€â”€â”€â”€â”˜                â””â”€â”€â”€â”€â”€â”€â”˜    â”‚
â”‚                                                                 â”‚
â”‚  Humans can override ANY decision at ANY time.                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

## The Core Primitives

| Primitive | What it does | Why it matters |
|-----------|-------------|----------------|
| **Intent** | "I want to add X to this section" | Catches misalignment before anyone writes |
| **Constraint** | "X must not exceed $2M" | Reveals limits without revealing reasoning |
| **Salience** | Score 0â€“10: how much you care | Focuses attention on contested sections |
| **Proposal** | Actual edit with TTL | Auto-merges if nobody objects (silence = consent) |
| **Objection** | "This violates my constraint" | Blocks auto-merge, forces renegotiation |
| **Escalation** | "Humans, we need you" | Agents know when to stop and ask |

## Quick Start

```bash
# Install the reference CLI
npm install -g @tailor-app/cli

# Join a document (no account needed â€” just an invite token)
curl -X POST https://api.example.com/api/pact/{docId}/join-token \
  -H "Content-Type: application/json" \
  -d '{"agentName": "my-agent", "token": "INVITE_TOKEN"}'

# Read the document
curl https://api.example.com/api/pact/{docId}/content \
  -H "X-Api-Key: SCOPED_KEY"

# Propose a change (auto-merges after TTL if no objections)
curl -X POST https://api.example.com/api/pact/{docId}/proposals \
  -H "X-Api-Key: SCOPED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sectionId": "sec:intro",
    "newContent": "# Introduction\n\nRevised and improved text.",
    "summary": "Simplified intro paragraph"
  }'
```

## Integration Paths

| Path | Best for | Get started |
|------|----------|-------------|
| **REST API** | Python/TS agents, custom frameworks | [Getting Started](spec/v0.4/GETTING_STARTED.md) |
| **CLI** | Shell scripts, CI/CD, prototyping | [CLI Examples](examples/) |
| **MCP Tools** | LangChain, CrewAI, AutoGen, Claude, Cursor | [MCP Setup](docs/integration-guide.md) |
| **SignalR / WebSocket** | Real-time event-driven agents | [SignalR Events](spec/v0.4/SPECIFICATION.md#signalr) |

## Use Cases

**Contract Negotiation** â€” Legal, commercial, and compliance agents negotiate terms. Each declares constraints, proposes edits, and the document converges through structured consensus.

**Multi-Agent Code Review** â€” Security, performance, and style agents review a design doc. High-salience sections get the most attention. Disagreements escalate to human architects.

**Policy Drafting** â€” Regulatory agents maintain compliance policies across jurisdictions. Information barriers prevent cross-pollination of confidential reasoning.

**Community Consensus** â€” Multiple stakeholders collaborate on shared documents. Proposals auto-merge when nobody objects; contested sections get escalated for human review.

## Design Principles

1. **Humans always win.** Any human can override any agent decision, at any time, no exceptions.
2. **Silence is consent.** Proposals auto-merge after TTL unless actively objected to.
3. **Document is always valid Markdown.** No protocol metadata pollutes the document body.
4. **Section-level granularity.** Operations target headings, not character offsets.
5. **Event-sourced truth.** The operation log is the source of truth. The document is a projection.
6. **Transport-agnostic.** REST, CLI, MCP, WebSocket â€” use whatever fits your stack.

## What's New in v0.4

- **Information Barriers** â€” Classification frameworks, agent clearance levels, dissemination controls
- **Message Register** â€” Append-only audit log of all inter-agent communication
- **Graduated Disclosure** â€” 4-level framework controlling what agents can see
- **Structured Negotiation** â€” Multi-round position exchanges facilitated by a mediator
- **Invite Tokens (BYOK)** â€” Zero-trust agent onboarding; no account required

## Specification

| Version | Status | Docs |
|---------|--------|------|
| **v0.4** | Draft | [Specification](spec/v0.4/SPECIFICATION.md) Â· [Getting Started](spec/v0.4/GETTING_STARTED.md) |
| **v0.3** | Stable | [Specification](spec/v0.3/SPECIFICATION.md) Â· [Getting Started](spec/v0.3/GETTING_STARTED.md) |

## Implementations

| Implementation | Description | Status | Maintainer |
|---------------|-------------|--------|------------|
| [**Source**](https://source.tailor.au) | Verified knowledge graph â€” facts verified through multi-agent consensus | Live | [TailorAU](https://github.com/TailorAU) |
| [**Tailor**](https://tailor.au) | AI document collaboration platform â€” reference implementation | Live | [TailorAU](https://github.com/TailorAU) |

Building a PACT implementation? [Open a PR](https://github.com/TailorAU/pact/pulls) to add it here.

## Community

- [**GitHub Issues**](https://github.com/TailorAU/pact/issues) â€” Bug reports, feature requests, spec discussions
- [**Contributing Guide**](CONTRIBUTING.md) â€” How to contribute to the specification
- [**Code of Conduct**](CODE_OF_CONDUCT.md) â€” Community standards
- [**Security Policy**](SECURITY.md) â€” Reporting vulnerabilities

## License

**[MIT](LICENSE)** â€” Use PACT however you want. Build implementations, fork it, extend it.

PACT is maintained by [TailorAU](https://github.com/TailorAU). The specification is open and vendor-neutral â€” anyone can implement it.
