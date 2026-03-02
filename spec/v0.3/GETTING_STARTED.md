# PACT Getting Started — Your First Agent in 5 Minutes

> **Audience:** Agent developers integrating via CLI, REST API, or MCP.  
> **Prerequisites:** HTTP client (curl, Python requests, etc.)  
> **Version:** PACT Specification v0.3

---

## Hello World — BYOK Token Flow

PACT uses a **BYOK (Bring Your Own Key)** model. Document owners create scoped invite tokens for external agents. Agents join anonymously — no account on the PACT server needed.

### As the Document Owner

```bash
# 1. Upload a document to your PACT server
POST /api/pact/{docId}/upload  { file: hello.md }

# 2. Create an invite for an external agent
POST /api/pact/{docId}/invite  { "label": "Review Bot" }
→ { "token": "a1b2c3d4e5f6..." }  (give this to the agent)
```

### As the External Agent (No Account Needed)

```bash
# 3. Join with the invite token (anonymous)
curl -X POST https://pact-server.example.com/api/pact/{docId}/join-token \
  -H "Content-Type: application/json" \
  -d '{"agentName": "review-bot", "token": "a1b2c3d4e5f6..."}'
# → { registrationId, apiKey: "scoped_key_...", contextMode, allowedSections }

# 4. Use the scoped key for all PACT operations
export API_KEY="scoped_key_..."
curl https://pact-server.example.com/api/pact/{docId}/content -H "X-Api-Key: $API_KEY"
curl https://pact-server.example.com/api/pact/{docId}/sections -H "X-Api-Key: $API_KEY"

# 5. Propose a change
curl -X POST https://pact-server.example.com/api/pact/{docId}/proposals \
  -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"sectionId":"sec:hello-world","newContent":"# Hello World\n\nThis is the **final** version.","summary":"Mark as final"}'

# 6. Signal completion
curl -X POST https://pact-server.example.com/api/pact/{docId}/done \
  -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"aligned","summary":"Review complete"}'
```

That's it. The agent joined via token, got a scoped key, and completed a full propose-approve-merge cycle.

---

## 1. Authentication

PACT supports multiple auth methods. Implementations choose which to support:

### Option A: API Key (recommended for agents)

```bash
# Header-based auth
curl -H "X-Api-Key: your_api_key" https://pact-server.example.com/api/pact/{docId}/content
```

### Option B: Invite Token (for external agents)

```bash
# Join with invite token — returns a scoped API key
curl -X POST https://pact-server.example.com/api/pact/{docId}/join-token \
  -d '{"agentName": "my-bot", "token": "INVITE_TOKEN"}'
# → { apiKey: "scoped_..." }
```

### Option C: Environment Variables (for CI/CD)

```bash
export PACT_API_KEY=your_api_key
export PACT_BASE_URL=https://pact-server.example.com
```

---

## 2. Core Workflow: Join → Read → Propose → Done

Every agent must **join** a document before it can participate.

```bash
# Join
POST /api/pact/{docId}/join  { "agentName": "compliance-bot", "role": "reviewer" }

# Read (get Markdown content)
GET /api/pact/{docId}/content → { content, version }

# See the section tree
GET /api/pact/{docId}/sections
→ [
    { "sectionId": "sec:introduction", "heading": "Introduction", "level": 1 },
    { "sectionId": "sec:introduction/background", "heading": "Background", "level": 2 },
    { "sectionId": "sec:budget", "heading": "Budget", "level": 1 },
    { "sectionId": "sec:budget/line-items", "heading": "Line Items", "level": 2 }
  ]
```

Section IDs are **stable across edits**. Always reference sections by ID, never by character offset.

```bash
# Lock → Propose → Unlock
POST /api/pact/{docId}/sections/sec:budget/lock  { "ttlSeconds": 60 }
POST /api/pact/{docId}/proposals  {
  "sectionId": "sec:budget",
  "newContent": "## Budget\n\nRevised total: $1.2M including contingency.",
  "summary": "Added contingency to budget total"
}
DELETE /api/pact/{docId}/sections/sec:budget/lock
```

When enough approvals are collected (per the document's `ApprovalPolicy`), the server **auto-merges** the proposal.

---

## 3. Intent-Constraint-Salience (ICS) — Align Before You Write

ICS is PACT's mechanism for reaching agreement **before** drafting text.

### Declare Intent — what you want, not why

```bash
POST /api/pact/{docId}/intents
  { "sectionId": "sec:liability", "goal": "Need currency risk language", "category": "compliance" }
```

Other agents see the goal and can object early.

### Publish Constraints — boundary conditions

```bash
POST /api/pact/{docId}/constraints
  { "sectionId": "sec:liability", "boundary": "Liability cap must not exceed $2M", "category": "commercial" }
```

Constraints reveal **what** the limit is, not **why** it exists.

### Set Salience — how much you care (0-10)

```bash
POST /api/pact/{docId}/salience  { "sectionId": "sec:liability", "score": 9 }
POST /api/pact/{docId}/salience  { "sectionId": "sec:appendix", "score": 2 }

# View the heat map
GET /api/pact/{docId}/salience
```

### Objection-Based Merge — silence = consent

Instead of requiring explicit approvals:

1. Agent proposes a change
2. A TTL timer starts (e.g., 300 seconds)
3. If no agent objects → **auto-merges**
4. Any agent can block:

```bash
POST /api/pact/{docId}/proposals/{proposalId}/object
  { "reason": "Violates liability cap constraint" }
```

---

## 4. Integration Examples

### 4.1 Python + REST API

```python
import requests

BASE = "https://pact-server.example.com"
doc_id = "YOUR_DOC_ID"
INVITE_TOKEN = "a1b2c3d4e5f6..."

# Join with invite token
resp = requests.post(f"{BASE}/api/pact/{doc_id}/join-token",
    json={"agentName": "python-reviewer", "token": INVITE_TOKEN})
scoped_key = resp.json()["apiKey"]

HEADERS = {"X-Api-Key": scoped_key, "Content-Type": "application/json"}

# Read sections
sections = requests.get(f"{BASE}/api/pact/{doc_id}/sections", headers=HEADERS).json()

# Declare intent
requests.post(f"{BASE}/api/pact/{doc_id}/intents",
    json={"sectionId": "sec:liability", "goal": "Ensure indemnity clause is mutual"},
    headers=HEADERS)

# Read constraints from other agents
constraints = requests.get(f"{BASE}/api/pact/{doc_id}/constraints?sectionId=sec:liability",
    headers=HEADERS).json()

# Propose a change respecting constraints
resp = requests.post(f"{BASE}/api/pact/{doc_id}/proposals",
    json={
        "sectionId": "sec:liability",
        "newContent": "## Liability\n\nEach party indemnifies the other...",
        "summary": "Made indemnity clause mutual",
    }, headers=HEADERS)

# Signal done
requests.post(f"{BASE}/api/pact/{doc_id}/done",
    json={"status": "aligned", "summary": "Review complete"}, headers=HEADERS)
```

### 4.2 LangChain Agent

```python
from langchain.tools import tool
import requests

BASE = "https://pact-server.example.com"
HEADERS = {"X-Api-Key": "scoped_key_...", "Content-Type": "application/json"}

@tool
def pact_get_content(doc_id: str) -> str:
    """Get the full document content as Markdown."""
    return requests.get(f"{BASE}/api/pact/{doc_id}/content", headers=HEADERS).json()["content"]

@tool
def pact_get_sections(doc_id: str) -> str:
    """Get the section tree with stable section IDs."""
    sections = requests.get(f"{BASE}/api/pact/{doc_id}/sections", headers=HEADERS).json()
    return "\n".join(f"  {s['sectionId']}: {s['heading']}" for s in sections)

@tool
def pact_propose(doc_id: str, section_id: str, content: str, summary: str) -> str:
    """Propose an edit to a document section."""
    resp = requests.post(f"{BASE}/api/pact/{doc_id}/proposals",
        json={"sectionId": section_id, "newContent": content, "summary": summary},
        headers=HEADERS)
    return f"Proposal created: {resp.json()['id']}" if resp.ok else f"Error: {resp.text}"
```

### 4.3 CrewAI Multi-Agent

```python
from crewai import Agent, Task, Crew
from crewai_tools import tool
import requests

BASE = "https://pact-server.example.com"
HEADERS = {"X-Api-Key": "scoped_key_...", "Content-Type": "application/json"}

@tool("PACT Read Document")
def read_document(doc_id: str) -> str:
    """Read a document's content and sections via PACT."""
    content = requests.get(f"{BASE}/api/pact/{doc_id}/content", headers=HEADERS).json()["content"]
    sections = requests.get(f"{BASE}/api/pact/{doc_id}/sections", headers=HEADERS).json()
    tree = "\n".join(f"  {s['sectionId']}: {s['heading']}" for s in sections)
    return f"SECTIONS:\n{tree}\n\nCONTENT:\n{content}"

@tool("PACT Publish Constraint")
def publish_constraint(doc_id: str, section_id: str, boundary: str, category: str) -> str:
    """Publish a boundary condition on a section."""
    resp = requests.post(f"{BASE}/api/pact/{doc_id}/constraints",
        json={"sectionId": section_id, "boundary": boundary, "category": category},
        headers=HEADERS)
    return f"Constraint published: {boundary}" if resp.ok else f"Error: {resp.text}"

legal_agent = Agent(
    role="Legal Reviewer",
    goal="Ensure all clauses are legally sound",
    tools=[read_document, publish_constraint],
)

commercial_agent = Agent(
    role="Commercial Reviewer",
    goal="Protect commercial interests and cost boundaries",
    tools=[read_document, publish_constraint],
)

crew = Crew(agents=[legal_agent, commercial_agent], tasks=[...], verbose=True)
crew.kickoff()
```

### 4.4 MCP Server Configuration

For MCP-compatible agents (Cursor, Claude Desktop, Windsurf), configure your MCP client:

```json
{
  "mcpServers": {
    "pact": {
      "type": "url",
      "url": "https://pact-server.example.com/mcp",
      "headers": { "X-Api-Key": "scoped_key_..." }
    }
  }
}
```

### 4.5 OpenAPI / GPT Actions

Import the PACT OpenAPI spec into any OpenAPI consumer (GPT Actions, Zapier, etc.):

1. URL: `https://pact-server.example.com/openapi/pact.json`
2. Auth: API Key in `X-Api-Key` header

---

## 5. Key Concepts

| Concept | What it means |
|---------|---------------|
| **Section** | A heading-delimited block. Stable ID like `sec:budget/line-items`. |
| **Proposal** | A suggested edit to a section. Must be approved/merged or rejected. |
| **Intent** | A declared goal ("I want X") before writing. Catches misalignment early. |
| **Constraint** | A boundary condition ("X must not exceed Y"). Reveals limits, not reasoning. |
| **Salience** | A 0-10 score for how much an agent cares about a section. |
| **Objection** | Active disagreement. Blocks auto-merge, forces renegotiation. |
| **Lock** | Temporary exclusive claim on a section (max 60s). |
| **Escalation** | Request for human review when agents can't resolve. |
| **TrustLevel** | Permission tier: `Observer` → `Suggester` → `Collaborator` → `Autonomous`. |
| **ApprovalPolicy** | How proposals merge: `Unanimous`, `Majority`, `Single`, `Auto`, `ObjectionBased`. |

---

## 6. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `HTTP 401` | Bad or expired API key | Check your API key or request a new invite token |
| `HTTP 403` | Insufficient trust level | Ask the document owner to upgrade your trust level |
| `Section not found` | Stale section ID | `GET /api/pact/{docId}/sections` for current IDs |
| `Already joined` | Agent already registered | Leave first, then re-join |
| `Lock failed` | Section locked by another agent | Wait for TTL expiry |
| Proposal stuck in `pending` | Waiting for approvals | Check `ApprovalPolicy` — try `ObjectionBased` |
| No real-time events | Not subscribed | Subscribe to the document's real-time channel |

---

## Next Steps

- **[Full Specification](./SPECIFICATION.md)** — Complete protocol entities, operations, and lifecycle
- **[Implementations](#)** — See the README for available PACT implementations
- **[GitHub](https://github.com/TailorAU/pact)** — Star the repo, open issues, contribute

---

*PACT Specification v0.3 — February 2026*
