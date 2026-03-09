# PACT Announcement — Draft

> Use this as a template for posting to Hacker News, Reddit (r/MachineLearning, r/artificial, r/LangChain, r/LocalLLaMA), Twitter/X, and blog posts.

---

## Hacker News Title

**PACT: An open protocol for multi-agent document collaboration (MIT)**

## Hacker News / Reddit Post

### The problem

AI agents can read databases (MCP), talk to each other (A2A), and use tools. But when 3 agents need to **collaborate on the same document** — negotiate contract terms, co-author a policy, review a design doc — there's no standard for how they do it.

What happens today: agents overwrite each other, there's no structured way to disagree, and humans have no override mechanism. It's the multi-agent equivalent of 5 people editing a Google Doc with no conflict resolution.

### What PACT does

PACT (Protocol for Agent Consensus and Truth) is an open protocol (MIT) that gives agents a structured way to collaborate on shared documents:

- **Intent** — agents declare what they want *before* writing ("I need to add a liability clause")
- **Constraints** — agents publish boundaries ("Total cap must not exceed $2M") without revealing reasoning
- **Proposals** — agents suggest edits to specific sections, with a TTL timer
- **Silence = consent** — proposals auto-merge if nobody objects within the TTL
- **Objections** — any agent can block a merge and force renegotiation
- **Escalation** — when agents can't agree, they escalate to humans
- **Humans always win** — any human can override any agent decision at any time

The document is always valid Markdown. Operations are section-level (not character offsets). The whole thing is event-sourced.

### v0.4 adds enterprise features

- Information barriers (classification, clearance levels)
- Mediated communication (agents talk through a trusted intermediary)
- Invite tokens (BYOK — external agents join without accounts)
- Structured negotiation (multi-round position exchanges)

### Integration

PACT is transport-agnostic. Works with REST, CLI, MCP (for LangChain/CrewAI/AutoGen/Claude), WebSocket, and OpenAPI (for GPT Actions).

### Links

- Spec: github.com/TailorAU/pact
- Getting Started (5 min): github.com/TailorAU/pact/blob/main/spec/v0.4/GETTING_STARTED.md
- Reference implementation: tailor.au

---

## Twitter/X Thread Draft

**Tweet 1:**
We just open-sourced PACT — a protocol for multi-agent document collaboration.

MCP gives agents tools. A2A gives agents communication. PACT gives agents a shared negotiation table.

MIT licensed. github.com/TailorAU/pact

**Tweet 2:**
The problem: 3 AI agents need to negotiate a contract. Legal drafts clauses. Finance enforces budgets. Compliance checks regulations.

How do they collaborate without chaos?

PACT introduces: Intent → Constraint → Propose → Consensus

**Tweet 3:**
Key design decisions:
- Silence = consent (proposals auto-merge if nobody objects)
- Humans always win (any human can override any agent)
- Section-level operations (agents think in sections, not character offsets)
- Event-sourced (operation log is the source of truth)

**Tweet 4:**
Works with every major agent framework:
- LangChain
- CrewAI
- AutoGen
- Claude (via MCP)
- GPT Actions (via OpenAPI)
- Any HTTP client (REST API)

v0.4 adds information barriers and mediated communication for enterprise.

**Tweet 5:**
The spec is open, vendor-neutral, and MIT licensed. Anyone can implement it.

Read the 5-minute getting started guide and try it with your agents.

github.com/TailorAU/pact

---

## Reddit Post (r/MachineLearning, r/artificial)

**Title:** [P] PACT — Open protocol for multi-agent document collaboration (MIT)

**Body:**

We've been working on a problem that comes up whenever you run multiple AI agents: how do they collaborate on the same document without stepping on each other?

MCP connects agents to tools. A2A connects agents to each other. But neither provides a standard for **structured consensus on shared content**.

PACT (Protocol for Agent Consensus and Truth) fills this gap. It's an open protocol where agents:

1. **Declare intents** before writing (catches misalignment early)
2. **Publish constraints** (reveals boundaries without revealing reasoning)
3. **Propose edits** to specific sections with a TTL timer
4. **Auto-merge on silence** (only disagreements require action)
5. **Escalate to humans** when they can't agree

The document is always valid Markdown, operations are section-level, and the whole thing is event-sourced. Humans can override any agent decision at any time.

v0.4 adds information barriers, mediated communication, and invite tokens for zero-trust agent onboarding.

Works with LangChain, CrewAI, AutoGen, Claude (MCP), GPT Actions (OpenAPI), and any HTTP client.

**Links:**
- GitHub: github.com/TailorAU/pact
- Getting Started: github.com/TailorAU/pact/blob/main/spec/v0.4/GETTING_STARTED.md
- Reference implementation: tailor.au

Would love feedback from anyone building multi-agent systems. What consensus patterns are you using today?

---

## Suggested Subreddits

- r/MachineLearning (tag: [P] for Project)
- r/artificial
- r/LangChain
- r/LocalLLaMA
- r/ChatGPT
- r/ClaudeAI
- r/Futurology
- r/programming

## Suggested HN Timing

- Post between 9-11am EST on a weekday (Tuesday-Thursday optimal)
- Title should be factual, not clickbait
- Be ready to answer questions in comments for the first 2-3 hours
