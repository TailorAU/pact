<p align="center">
  <img src="https://img.shields.io/badge/spec-v2.0-blue" alt="Spec Version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" />
  <img src="https://img.shields.io/github/stars/TailorAU/pact?style=social" alt="Stars" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" />
</p>

# PACT — Protocol for Agent Consensus and Truth

**The open protocol for multi-agent consensus — documents, transactions, knowledge, and beyond.**

[Specification](spec/v2.0/SPECIFICATION.md) · [Getting Started](spec/v2.0/GETTING_STARTED.md) · [Conformance](spec/v2.0/conformance/) · [Examples](examples/) · [Contributing](CONTRIBUTING.md)

---

## The Problem

You have 3 AI agents that need to negotiate a contract. Agent A drafts liability clauses. Agent B enforces budget caps. Agent C checks regulatory compliance.

How do they collaborate on the same document without stepping on each other? Now imagine the same problem for payments, knowledge verification, clinical records, or any shared resource.

**MCP** gives agents tools. **A2A** gives agents communication. But neither gives agents **structured consensus rules**, human oversight, and information barriers over a shared resource.

**PACT does.**

## Where PACT Fits

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agent Ecosystem                    │
├──────────────┬──────────────┬───────────────────────────┤
│     MCP      │     A2A      │          PACT             │
│  Tools/Data  │  Agent Comms │  Consensus Protocol       │
│              │              │                           │
│  "Hands"     │  "Voices"    │  "Shared negotiation      │
│              │              │   table"                  │
└──────────────┴──────────────┴───────────────────────────┘
```

| Protocol | Connects agents to... | Example |
|----------|----------------------|---------|
| **MCP**  | Tools and data       | "Read this database" |
| **A2A**  | Other agents         | "Tell Agent B to start" |
| **PACT** | Shared resources     | "Object to this proposal — it violates my constraint" |

## How It Works

PACT is a **coordination and consensus protocol**. Each agent arrives with its own private context and negotiating parameters. PACT handles how they declare positions, detect conflicts, and reach agreement — not the content itself.

**Silence = acceptance.** Proposals auto-merge after TTL unless someone objects. Only disagreements require action.

```
┌─────────────────────────────────────────────────────────────────┐
│                        PACT Workflow                            │
│                                                                 │
│  Agent A                  Document                  Agent B     │
│  ┌──────┐                ┌────────┐                ┌──────┐    │
│  │Legal │──intent───────▶│        │◀──constraint───│Budget│    │
│  │      │  "Add currency │sec:    │  "Cap at $2M"  │      │    │
│  │      │   risk clause" │liability                │      │    │
│  │      │                │        │                │      │    │
│  │      │                │  ✏️    │──notify──────▶ │      │    │
│  │      │                │  edit  │                │      │    │
│  │      │                │        │   No objection │      │    │
│  │      │                │        │◀──(silence)────│      │    │
│  │      │                │        │                │      │    │
│  │      │                │ ✅ Auto│                │      │    │
│  │      │                │ merged │                │      │    │
│  └──────┘                └────────┘                └──────┘    │
│                                                                 │
│  Humans can override ANY decision at ANY time.                  │
└─────────────────────────────────────────────────────────────────┘
```

## The Core Primitives

PACT defines **coordination**, not content. Agents bring their own context.

| Primitive | What it does | Why it matters |
|-----------|-------------|----------------|
| **Join** | Register at the table | Identifies who's negotiating |
| **Intent** | "I want to add X to this section" | Catches misalignment before anyone writes |
| **Constraint** | "X must not exceed $2M" | Reveals limits without revealing reasoning |
| **Salience** | Score 0–10: how much you care | Focuses attention on contested sections |
| **Object** | "This violates my constraint" | Blocks auto-merge, forces renegotiation |
| **Escalation** | "Humans, we need you" | Agents know when to stop and ask |
| **Done** | "I'm satisfied" | Signals completion and alignment |

Content operations (reading documents, creating proposals, editing sections) are the responsibility of the **implementation** — not the protocol. See [Implementations](#implementations).

## Quick Start

### CLI

```bash
# Install the standalone PACT CLI
npm install -g @pact-protocol/cli

# Point at any PACT-compliant server
pact config --server https://your-pact-server.com --key YOUR_API_KEY

# Join a document
pact join <documentId> --as "budget-agent" --role reviewer

# Declare what you care about
pact intent <documentId> --section sec:liability --goal "Ensure currency risk is addressed"
pact constrain <documentId> --section sec:budget --boundary "Total must not exceed $2M"
pact salience <documentId> --section sec:budget --score 9

# Watch for proposals from other agents
pact poll <documentId> --since evt_0

# Object only if something violates your constraints (silence = accept)
pact object <proposalId> --doc <documentId> --reason "Exceeds $2M budget cap"

# Escalate to humans when agents can't agree
pact escalate <documentId> --message "Budget and legal agents deadlocked on liability clause"

# Signal completion
pact done <documentId> --status aligned --summary "Budget constraints satisfied"
```

### MCP Server (for AI agent frameworks)

```bash
# Run the PACT MCP server (for Cursor, LangChain, CrewAI, AutoGen, etc.)
PACT_BASE_URL=https://your-pact-server.com \
PACT_API_KEY=YOUR_KEY \
npx @pact-protocol/mcp
```

**Cursor / VS Code (MCP config)** — add to `.cursor/mcp.json` or your editor’s MCP settings (adjust URL and use a real key or env reference):

```json
{
  "mcpServers": {
    "pact": {
      "command": "npx",
      "args": ["-y", "@pact-protocol/mcp"],
      "env": {
        "PACT_BASE_URL": "https://your-pact-server.com",
        "PACT_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

**CLI binary name:** The package installs the command `pact`. The npm ecosystem also has an unrelated contract-testing package named `pact`; if your machine already has that CLI on `PATH`, use the **`pact-agent`** alias (same binary) instead.

Packages are published from this repo — see [RELEASING.md](RELEASING.md).

### REST API

```bash
# Join via invite token (no account needed)
curl -X POST https://your-server.com/api/pact/{docId}/join-token \
  -H "Content-Type: application/json" \
  -d '{"agentName": "my-agent", "token": "INVITE_TOKEN"}'

# Declare a constraint
curl -X POST https://your-server.com/api/pact/{docId}/constraints \
  -H "X-Api-Key: SCOPED_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sectionId": "sec:budget", "boundary": "Total must not exceed $2M"}'

# Object to a proposal that violates your constraint
curl -X POST https://your-server.com/api/pact/{docId}/proposals/{id}/object \
  -H "X-Api-Key: SCOPED_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Exceeds $2M budget cap"}'

# Poll for events (stateless)
curl https://your-server.com/api/pact/{docId}/poll?since=evt_0 \
  -H "X-Api-Key: SCOPED_KEY"
```

## Integration Paths

| Path | Best for | Get started |
|------|----------|-------------|
| **CLI** | Shell scripts, CI/CD, prototyping | `npm i -g @pact-protocol/cli` |
| **MCP Tools** | Cursor, LangChain, CrewAI, AutoGen | `npx @pact-protocol/mcp` |
| **REST API** | Python/TS agents, custom frameworks | [Getting Started](spec/v1.1/GETTING_STARTED.md) |
| **SignalR / WebSocket** | Real-time event-driven agents | [Specification](spec/v1.1/SPECIFICATION.md) |

## Tooling

| Package | What it handles | Install |
|---------|----------------|---------|
| [`@pact-protocol/cli`](cli/) | Consensus coordination — join, intent, constrain, object, escalate, done | `npm i -g @pact-protocol/cli` |
| [`@pact-protocol/mcp`](mcp/) | Same primitives as MCP tools for AI frameworks | `npx @pact-protocol/mcp` |

These packages handle **coordination only**. Content operations (reading documents, creating proposals) are provided by the implementation you connect to.

## Use Cases

**Contract Negotiation** — Legal, commercial, and compliance agents negotiate terms. Each declares constraints. Proposals auto-merge unless objected to. The document converges through structured silence.

**Multi-Agent Code Review** — Security, performance, and style agents review a design doc. High-salience sections get the most attention. Disagreements escalate to human architects.

**Policy Drafting** — Regulatory agents maintain compliance policies across jurisdictions. Information barriers prevent cross-pollination of confidential reasoning.

**Knowledge Verification** — AI agents propose factual claims, debate evidence, and reach consensus. Verified facts become queryable. See [Source](https://source.tailor.au).

## Design Principles

1. **Humans always win.** Any human can override any agent decision, at any time, no exceptions.
2. **Silence is consent.** Proposals auto-merge after TTL unless actively objected to.
3. **Agents bring their own context.** PACT coordinates — it doesn't read your mind or your data.
4. **Field-level granularity.** Operations target addressable fields (sections, transaction fields, claims), not raw offsets.
5. **Event-sourced truth.** The operation log is the source of truth. The resource state is a projection.
6. **Transport-agnostic.** REST, CLI, MCP, WebSocket — use whatever fits your stack.

## Key Features (v2.0)

- **Resource Types** — Consensus on any resource: documents, transactions, knowledge claims, clinical records
- **Silence = Acceptance** — Proposals auto-merge after TTL unless objected to. Only disagreements need action.
- **Information Barriers** — Classification frameworks, agent clearance levels, dissemination controls
- **Graduated Disclosure** — 4-level framework controlling what agents can see about each other
- **Structured Negotiation** — Multi-round position exchanges facilitated by a mediator
- **Implementation Profiles** — Servers advertise supported resource types and conformance level
- **Invite Tokens (BYOK)** — Zero-trust agent onboarding; no account required
- **Message Register** — Append-only audit log of all inter-agent communication
- **Event-Sourced** — The operation log is the source of truth. The resource state is a projection.
- **Fabric Onboarding & Session Awareness (v2.0.3)** — Atomic join+constrain via `_onboard`, caller-scoped `manifest`, bidirectional `_heartbeat`, transcript + `mark-read`, and `pact_session_announce` MCP tool so the calling LLM always knows which fabrics it is in

## Specification

| Version | Status | Docs |
|---------|--------|------|
| **v2.0** | **Stable** (released 14 May 2026; patched to v2.0.3 on 15 May 2026) | [Specification](spec/v2.0/SPECIFICATION.md) · [Getting Started](spec/v2.0/GETTING_STARTED.md) · [Conformance](spec/v2.0/conformance/) · [Release notes](CHANGELOG.md#v203--2026-05-15) |
| v1.1 | Previous | [Specification](spec/v1.1/SPECIFICATION.md) · [Getting Started](spec/v1.1/GETTING_STARTED.md) · [Errata](spec/v1.1/ERRATA.md) |
| v1.0 | Previous | [Specification](spec/v1.0/SPECIFICATION.md) · [Getting Started](spec/v1.0/GETTING_STARTED.md) |
| v0.3 | Legacy | [Specification](spec/v0.3/SPECIFICATION.md) · [Getting Started](spec/v0.3/GETTING_STARTED.md) |

## Implementations

PACT defines the consensus protocol. Implementations provide the content layer for their domain.

| Implementation | Resource Type | What it adds | Spec version served | Maintainer |
|---------------|--------------|-------------|--------|------------|
| [**Tailor**](https://tailor.au) | `document` | Document collaboration — upload, edit, review, sign | v1.1 (live); v2.0 server-side rollout in progress | [TailorAU](https://github.com/TailorAU) |
| [**Source**](https://source.tailor.au) | `fact` | Verified knowledge graph — facts, legislation, standards | v1.1 (live); v2.0 server-side rollout in progress | [TailorAU](https://github.com/TailorAU) |
| **Baink** | `transaction` | Sovereign billing — multi-agent payment authorization | Planned | [TailorAU](https://github.com/TailorAU) |

The v2.0 spec is released and the reference CLI/MCP are at v2.0.3; the v2.0 server-side surface (`/.well-known/pact.json` retentionPolicy, the §17.6 `authorization_proof` envelope, the §17.8 credentials registry, §23 transfer/recovery endpoints) lands in tailor-app's deployment as those surfaces are wired through the production stack. Until then, the listed implementations serve v1.1 endpoints; clients pinned to v2.0 features should check `/.well-known/pact.json`'s `specVersion`.

### Reference implementation of the Human Authorization Layer

[**HMAN** — Human-Managed-Access-Network](https://github.com/Tailor-AUS/Human-Managed-Access-Network) (public, MIT) is the **reference implementation of PACT §17 (Human Authorization Layer) and §18 (Attestation Format Reference)**. It is the canonical proof that those sections are implementable on a sovereign, local-first stack: it runs the human's credential registry, mints and rotates per-task `agentId`s (§23), and produces the `authorization_proof` envelope (§17.6) — including the `voice-biometric` attestation type (§18.3) whose normative crypto is tracked in issue [#3](https://github.com/TailorAU/pact/issues/3).

HMAN is **not** PACT and is deliberately a separate artifact: PACT is the vendor-neutral protocol; HMAN is one (reference-grade) implementation of the human end of it. A conformant non-HMAN implementation that produces a valid §18-conformant proof interoperates with HMAN over a fabric with no special-casing — that interoperability is the protocol's reason to exist and the reason the boundary is kept. The §18.3 interface between the two is frozen as a contract (see [`docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml`](docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml)) precisely so the spec/implementation boundary stays sharp at the one seam where the two are genuinely co-designed.

Building a PACT implementation? [Open a PR](https://github.com/TailorAU/pact/pulls) to add it here.

## Community

- [**GitHub Issues**](https://github.com/TailorAU/pact/issues) — Bug reports, feature requests, spec discussions
- [**Contributing Guide**](CONTRIBUTING.md) — How to contribute to the specification
- [**Code of Conduct**](CODE_OF_CONDUCT.md) — Community standards
- [**Security Policy**](SECURITY.md) — Reporting vulnerabilities

## License

**[MIT](LICENSE)** — Use PACT however you want. Build implementations, fork it, extend it.

PACT is maintained by [TailorAU](https://github.com/TailorAU). The specification is open and vendor-neutral — anyone can implement it.
