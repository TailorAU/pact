# ADR-001: Graph vs Legislation Entity Model

> **Status:** Accepted
> **Date:** 2026-04-17
> **Context:** #1137 — defence / critical-minerals seed before the Locksley (ASX: LKY) sales conversation.
> **Author:** Source executor agent, working from handoff `docs/agents/handoffs/2-active/1137-source-defence-knowledge-graph-seed.md`.

---

## 1. Problem

The Source knowledge graph at `source.tailor.au/map` has two schemas that could each back a "compliance graph" view:

| Table | What it stores | What writes to it |
|---|---|---|
| `topics` + `topic_dependencies` | Canonical claims (PACT topics) with tier, jurisdiction, authority, source_ref, and dependency edges | The PACT consensus flow (`POST /api/pact/topics`) — every row has been through, or is eligible for, multi-agent verification. |
| `legislation_docs` + `legislation_sections` + `legislation_relations` | Machine-readable legislation text (title, sections, cross-refs) | Government API parsers (`cth-parser.ts`, `qld-parser.ts`) plus the admin bulk-ingest endpoint (`POST /api/axiom/legislation/ingest` with `X-Admin-Key`). |

The handoff asks: what is a "node" on `/map`, and how do we represent US frameworks (ITAR, EAR, NEPA, BLM 3809, DFARS, SMARA) that have no clean Australian-style API feed?

## 2. Decisions

### Decision A — What is a node on `/map`?

**Adopted: Option 1 — Topics-only map (recommended default in handoff).**

- Every regulatory framework is a `topics` row at the `institutional` tier.
- `legislation_docs` stays a separate catalog, queryable via `/legislation` and `/api/axiom/legislation/*`.
- Cross-linking: `topics.source_ref` points to the canonical citation (e.g. `"Defence Trade Controls Act 2012 (Cth)"`); the demo page and topic detail views can deep-link from the topic to `/legislation/{docId}` when a matching legislation_doc exists.
- `/map/page.tsx` remains a single-entity query over `topics` + `topic_dependencies`. No rendering change.

**Rejected alternatives:**

- **Option 1b — Dual-entity map** (render both topics and legislation_docs as nodes). Rejected for this ticket because (a) it requires `InteractiveTree` + `Graph3DSection` rework with visual distinction between node types, (b) the current 3D graph already strains at 30–60 nodes per the handoff out-of-scope note, and (c) an institutional-tier topic carrying a `source_ref` plus a first-class legislation link gives the prospect the same story without the UI risk.
- **Option 3 — Legislation-only** (drop topics from the map). Rejected because it destroys the PACT consensus narrative that is the product.

**Consequence:** `topicCount` on `/api/hub/stats` is the canonical "graph size" metric. Acceptance thresholds apply there.

### Decision B — How do we represent US frameworks with no official API?

**Adopted: Option 1 — Topic-only, manually curated canonical claims.**

- Each US framework (ITAR, EAR, NEPA, BLM 3809, DFARS 7052, SMARA, DPA Title III, CFIUS, IRA critical-minerals, Buy American Act) becomes a single `institutional`-tier topic.
- `canonicalClaim` is a one-sentence authoritative statement; `content` expands the context.
- `jurisdiction` = `"US"` or `"US-CA"`; `authority` = the enacting body; `sourceRef` = the CFR / USC citation; a URL to `ecfr.gov` / `congress.gov` / state text goes in `content` (no dedicated URL column today).

**Deferred:** Full eCFR ingestion (hitting `ecfr.gov/api/versioner/v1/titles` to populate `legislation_docs` + `legislation_sections` for CFR titles). Logged as follow-on **ticket #1138**. Effort estimate from handoff: 4–5 days. Not required to ship this pitch.

### Decision C — Unblocking the `/api/axiom/legislation/search` acceptance thresholds

**Context:** The search endpoint (`sites/source/src/app/api/axiom/legislation/search/route.ts`) currently reads only from `legislation_sections`. If we take the topics-only path above, a query for `q=defence` will not find the new DTCA/DISP/DSGL topics unless we either (a) ingest matching legislation_docs or (b) make the search also cover `topics`.

**Adopted: Extend `legislation/search` to union results from `topics` as a second result source.**

- Preserves back-compat: existing `{ results: [...] }` shape keeps the same fields; topic hits fill the same schema with `docId = "topic:{id}"`, `sectionId = "claim"`, `docType = "topic"`, `jurisdiction = topic.jurisdiction`, `content = topic.canonical_claim || topic.content`, `sourceRef = topic.source_ref`.
- Clients (including the hero page code block) can treat all hits uniformly; richer clients can branch on `docType === "topic"` to deep-link to `/topics/{id}` instead of `/legislation/{docId}/{sectionId}`.
- This is a read-only code change, no schema change, and directly satisfies both search thresholds from the handoff (`q=defence >= 5`, `q=export+control >= 3`) once the topics are seeded.

## 3. Out of scope for this ADR

- Any `/map` visual redesign.
- Any changes to the PACT consensus flow or topic lifecycle.
- Customer-specific obligation mapping (Locksley, Foxleigh, etc.). Source holds public regulatory frameworks; customer obligations stay in Tailor-side tenant data.
- Classified or ITAR-controlled technical data. Source holds **references only**.

## 4. Execution plan

1. Seed `topics` via four idempotent Python scripts (`seed_defence_au.py`, `seed_defence_us.py`, `seed_critical_minerals.py`, `seed_topic_dependencies.py`) — all go through the public `POST /api/pact/topics` endpoint (no admin secret needed).
2. Extend `/api/axiom/legislation/search` to also search `topics` so the defence / export-control queries return meaningful hits.
3. Update `/source-defence-demo` to deep-link to real topic IDs and real search URLs.
4. Document the content inventory in `sites/source/README.md` and `AGENTS.md` so a future agent doesn't drift back to two physics-constant nodes.

## 5. Acceptance signal

- `GET /api/hub/stats` → `stats.topics` (string count) parses to `>= 30`.
- `GET /api/axiom/legislation/search?q=defence` → `results.length >= 5`.
- `GET /api/axiom/legislation/search?q=export+control` → `results.length >= 3`.
- `/map` visually shows a populated graph with tier-coloured nodes and edges.
