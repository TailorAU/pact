# ADR-002: Sovereign AI Decision-Making Layer

> **Status:** Accepted
> **Date:** 2026-04-17
> **Supersedes:** [ADR-001](ADR-001-graph-vs-legislation.md) — topics-only map.
> **Context:** #1152 — unified execution of the visual-unification (#1141) + scenario-layer + reciprocal-work (#1143) streams. Drives the "sovereign agent-native decision layer" positioning for government and regulated-industry pilots.
> **Author:** Source executor agent, working from `docs/agents/handoffs/2-active/1152-source-sovereign-decision-layer.md`.

---

## 1. Problem

ADR-001 adopted a topics-only `/map` with legislation kept in a parallel catalogue. Two shortcomings surfaced during the #1141 and #1143 investigations:

1. **The graph does not show what Source actually holds.** `legislation_docs` (24+ acts, 169+ sections) are invisible on `/map`, even though they are the verified government-sourced truth the product markets. Topics are currently unconditional — a viewer cannot ask *"which of these applies to me?"*.
2. **There is no deterministic topic→legislation edge.** `topics.source_ref` is free-text prose that often includes multi-jurisdiction, multi-instrument citations (e.g. `"AUKUS Pillar 2 Joint Leaders Statement (2021); Defence Trade Controls Amendment Act 2024 (Cth); 22 CFR 126.7 AUKUS exemption"`). It cannot be used as a fuzzy SQL join without a classifier, and #1141's review finding explicitly blocked edge rendering on this gap.

At the same time, the product roadmap (Fabric as a collaboration surface for government and regulated industry) needs Source to be a **scenario-aware applicability engine**, not a static claim catalogue. Agents ask *"which of these applies to an AU entity exporting defence-utility product into the US?"* and expect back the exact legislation + topic subgraph, with explanations.

## 2. Decisions

### Decision A — Tri-entity graph

**Adopted:** `/map` renders **three node types** and **four edge types**.

| Node type | Source table | Shape on `/map` | What it represents |
|---|---|---|---|
| Topic | `topics` | Circle | PACT-verified canonical claim. Consensus applies. |
| Legislation | `legislation_docs` | Rectangle | Government-sourced legal text. Not a claim — parsed from official APIs (`cth-parser.ts`, `qld-parser.ts`). Consensus does not apply. |
| Scenario | `scenarios` (new) | Diamond | Predicate container. Groups `applies_when` edges. Not a claim — no PACT consensus flow. |

| Edge type | Source table | Style on `/map` | Direction |
|---|---|---|---|
| `depends_on` | `topic_dependencies` (existing) | Solid | topic → topic |
| `cites` | `topic_legislation_citations` (new, see Decision B) | Solid thin | topic → legislation |
| `applies_when` | `scenario_applies_when` (new) | Dashed | scenario → topic OR scenario → legislation |
| `co_applies` | `legislation_co_applies` (new) | Double-line | legislation ↔ legislation, scenario-scoped |

**Rejected alternatives:**
- **Topics-only map with deep-links** (ADR-001). Rejected: leaves legislation invisible and provides no answer to "which applies to me?"
- **Topics + legislation only, no scenarios.** Rejected: falls back into unconditional graph problem — the viewer cannot filter by applicability.
- **Scenario as a tier of topic.** Rejected: scenarios have no canonical claim. Shoehorning them into the PACT consensus flow would dilute the meaning of a verified topic.

**Consequences:**
- `/map` needs to union three node queries and four edge queries. The cascade from `TreeTopic` to a `GraphNode = TopicNode | LegislationNode | ScenarioNode` discriminated union affects `InteractiveTree.tsx`, `ConsensusGraph.tsx`, and `Graph3DSection.tsx`.
- `/api/hub/stats` grows a `scenarioCount` field.
- Layout rules (see handoff Section 4, Round 5a): topics sort by existing tier BFS; legislation is a pseudo-tier `"legislation"` grouped by jurisdiction then year DESC; scenarios are a pseudo-tier `"scenario"` rendered above all tiers.

### Decision B — Explicit citation join table, not fuzzy regex

**Adopted:** `topic_legislation_citations (topic_id, legislation_id, citation_text)` is the **only** topic→legislation edge source for `/map`.

- Populated by a one-shot backfill script (`scripts/backfill_topic_legislation_citations.py`) that encodes the **hand-curated** topic_id → legislation_docs.id mapping from the #1137 seed data.
- **No fuzzy matching.** Topics whose `source_ref` points at foreign jurisdictions (e.g. the US institutional topics seeded by `seed_defence_us.py`) simply have no citation row today. When #1138 (eCFR parser) lands, a follow-on backfill adds those rows.
- **Graceful degradation:** if the resulting citation count is low, `/map` still renders — legislation nodes appear even without edges. Scenario `applies_when` edges (Decision D) provide alternate connective tissue.

**Rejected alternatives:**
- **LLM classifier on `source_ref` prose.** Rejected: silent misses, non-deterministic, hard to audit — bad property for a sovereignty claim.
- **Regex matcher against legislation short titles.** Rejected: multi-citation prose produces false positives; foreign-jurisdiction citations produce false negatives.

**This decision resolves the #1141 review finding** that blocked edge rendering without a deterministic join.

### Decision C — Agent-native positioning is the headline, consensus is the quality gate

**Adopted:** Every Source marketing surface — landing, `/mcp`, `/get-started`, `.well-known/agent-card.json` — opens with the value chain:

```
Official Govt APIs (CTH / QLD / NSW)
        ↓
Source Ingest & Structuring (parsers → sections → topics)
        ↓
PACT Consensus (quality gate)
        ↓
Agent-Native Emission (MCP / A2A / PACT REST / OpenAPI / Python / Gemini / ChatGPT Actions)
```

Consensus is a **quality gate** on top of the ingested corpus, not the headline. The headline is "you already have the verified corpus — here are all the ways your agent can consume it."

**Consequences:**
- `/mcp` hero copy is rewritten in-place (#1152 Round 5b) to lead with this pipeline.
- A new reusable component `SourceValueChain.tsx` renders the three-column value chain on `/mcp` and `/get-started`. It extends the existing `FlowComparison.tsx` pattern; the two components sit side-by-side (`FlowComparison = why`, `SourceValueChain = how`).
- Tool categories on `/mcp` reorder to put legislation + scenarios first, then hub/consensus, then market, then contribute.

### Decision D — Scenario model: predicate containers with deterministic matching + LLM fallback

**Adopted:** `scenarios` is a predicate container table. Applicability is declared through `scenario_applies_when` (scenario→topic OR scenario→legislation) and `legislation_co_applies` (legislation↔legislation scoped by one or more scenarios).

- **Predicates** are JSON key-value maps (e.g. `{ country_of_operation: "AU", counterparty_country: "US", product_class: "defence_dual_use" }`).
- `POST /api/scenarios/match` accepts caller predicates and runs a **deterministic set-intersection scorer** (`src/lib/scenarios/predicate-match.ts`). Score = (matched predicate keys / total scenario predicate keys) × required-key presence coefficient.
- If no scenario scores above `0.5`, fall through to an Azure OpenAI (`gpt-4.1-mini`) LLM matcher (`src/lib/scenarios/llm-match.ts`) for free-form reasoning. The LLM response includes `{ scenarioId, rationale }` and is returned as `fallback` alongside any sub-threshold deterministic matches.
- `GET /api/scenarios/:id/applicable` returns the full subgraph: the scenario, all `applies_when` rows with joined topic/legislation metadata, all `co_applies` rows scoped to that scenario.

**Rejected alternatives:**
- **Full LLM matcher, no predicate scoring.** Rejected: non-deterministic, expensive, slower, harder to audit — loses the "verified and deterministic" property.
- **Predicate matcher only, no fallback.** Rejected: real-world caller predicates are messy; LLM fallback lets Source handle the long tail without forcing callers to know the schema.

**Note on co_applies scoping:** DTCA and ITAR do not globally co-apply — they co-apply *when an AU entity exports defence-utility product to the US*. Every `legislation_co_applies` row carries a `scenario_ids` array and the `/map` render draws the edge only when that scenario is active / highlighted.

### Decision E — Reciprocal work economy on existing wallet primitives

**Adopted:** Extend the existing `agent_wallets` + `ledger_txs` primitives (see `sites/source/src/app/api/pact/wallet/route.ts`). No new wallet system.

**Read debits** (authenticated only; unauthenticated reads stay free):
- `POST /api/scenarios/match`: 1 credit, reason `read.scenario`.
- `GET /api/scenarios/:id/applicable`: 1 credit, reason `read.scenario`.
- `GET /api/axiom/legislation/search`: 1 credit, reason `read.legislation`.

Unauthenticated callers (no `X-Source-Agent-Key` header) are **not debited** — this preserves the public ChatGPT / Claude integration path, which is the current go-to-market motion.

**Work credits** (new `agent_work_assignments` + `agent_work_ledger` tables):
- `scrape`: 5 credits. Validator: URL hash + payload contains expected section.
- `qa_spot_check`: 2 credits. Validator: approve/reject decision on a topic.
- `dependency_proposal`: 10 credits. Validator: PACT proposal must merge via consensus before credit applies.

**Economy parameters:**
- Starting balance: 100 credits on registration (existing).
- Hard block at balance ≤ 0 → HTTP 402 `{ error: "work_debt", claimUrl: "/api/work/claim" }`. Agent must claim + submit work to resume.
- All transactions continue to be double-entry via `ledger_txs` for auditability. New reason codes: `read.legislation`, `read.scenario`, `work.scrape.accepted`, `work.qa.accepted`, `work.dependency.accepted`.

**Rejected alternatives:**
- **Token-based payments (USDC / stablecoin).** Rejected: adds KYC + custody surface for zero product value today.
- **Blanket paid reads (no free tier).** Rejected: breaks the public integration with ChatGPT / Claude. Free unauthenticated reads remain non-negotiable.

### Decision F — Fabric resolver integration

**Adopted:** `src/WebApi/Common/Services/SourceLegislationResolver.cs` gains a `ResolveScenarioContextAsync` method that calls `/api/scenarios/match` with the meeting's project predicates, then `GET /api/scenarios/:id/applicable` on the top match, and returns a structured `ScenarioContext` to the Fabric enrichment pipeline.

- Wired into `src/WebApi/Common/Services/Enrichment/EnrichmentBackgroundService.cs` alongside the existing keyword-based `ResolveAsync`. Both results are merged into the enrichment payload.
- The UI surface (#1152 Round 5e — Fabric "Applicable legislation" card) depends on the #1151 Round 1 node-detail-drawer panel framework; if that framework is not in `dev` when Round 5e runs, it defers to a follow-on ticket.

## 3. Explicit supersede of ADR-001

- ADR-001 Decision A (topics-only map) is **superseded** by Decision A above.
- ADR-001 Decision B (US frameworks as institutional-tier topics with prose `canonical_claim`) is **retained** — this ticket does not revisit the #1138 eCFR-parser deferral. US frameworks remain topics until #1138 ships.
- ADR-001 Decision C (`/api/axiom/legislation/search` unions topics) is **retained and reinforced** — unauthenticated access is now a named non-negotiable in Decision E.

## 4. Out of scope for this ADR

- Full eCFR / congress.gov ingestion (remains #1138).
- Classified / ITAR-controlled technical data. Source holds **references to public instruments only**.
- Customer-specific obligation mapping (Locksley, Foxleigh, tenant DB). Source holds public regulatory frameworks; customer obligations stay in Tailor-side tenant data.
- New wallet system. `agent_wallets` + `ledger_txs` are production; this ADR extends reason codes and adds assignment/submission tables only.
- Any top-level non-spec field in `.well-known/agent-card.json`. Manifest cross-links use the A2A-designated `skills[]` extension mechanism (see #1152 Round 5d).

## 5. Execution plan

1. **Round 1** — `sql/sovereign-decision-layer-schema.sql` migration: six new tables, every statement `IF NOT EXISTS`. Runner in `scripts/apply_sovereign_decision_schema.py`.
2. **Round 1b** — `scripts/backfill_topic_legislation_citations.py` with the hand-curated mapping. Idempotent.
3. **Round 2** — Seed 8+ scenarios (defence, critical minerals, ASX) + ≥30 `applies_when` edges + ≥10 `co_applies` edges.
4. **Round 3a** — `/api/scenarios/match`, `/api/scenarios/:id/applicable`, `/api/scenarios` endpoints.
5. **Round 3b** — MCP tools `source_match_scenario`, `source_list_applicable_law`. `/mcp` header 13 → 15 tools.
6. **Round 3c** — `SourceLegislationResolver.ResolveScenarioContextAsync` + `EnrichmentBackgroundService` wiring.
7. **Round 4** — `lib/wallet-debit.ts` helper, apply to three read endpoints. `work/claim`, `work/submit`, `work/assignments` endpoints. `lib/work/validators.ts`.
8. **Round 5a** — `/map` tri-entity render + legend.
9. **Round 5b** — `/mcp` hero rewrite + `SourceValueChain.tsx` + landing tagline + `/get-started` insertion.
10. **Round 5c** — `/scenarios` list + `/scenarios/[id]` detail.
11. **Round 5d** — `agent-card.json` skills reorder + `discover-related-manifests` skill + `ai-plugin.json` description.
12. **Round 5e** (conditional) — Fabric applicable-legislation card (only if #1151 panel framework is in `dev`).
13. **Round 5f** — `.cursor/rules/chief-source.mdc` update: tri-entity map, 15 MCP tools, current corpus counts, "lead with agent-native pipeline" rule.

## 6. Acceptance signal

- `GET /api/hub/stats` → `topicCount >= 30`, `legislationCount >= 24`, `scenarioCount >= 8`.
- `POST /api/scenarios/match` with AU-defence-export-to-US predicates → `matches[0].scenarioId == "scn.au-defence-export-to-us"` with confidence > 0.8.
- `GET /api/scenarios/scn.au-defence-export-to-us/applicable` → `applies_when.length >= 5`, `co_applies.length >= 1`.
- `/.well-known/agent-card.json` → first six skills include `search-legislation`, `match-scenario`, `list-applicable-law`, and there is a `discover-related-manifests` skill that names OpenAPI, `@source-tailor/mcp`, and the PACT spec repo.
- Unauthenticated `GET /api/axiom/legislation/search?q=defence` continues to return results without an `X-Source-Agent-Key` header.
- `/map` visually shows at least one of each node type (topic, legislation, scenario) and at least one `cites`, one `applies_when`, and one `co_applies` edge.

---

— Knox (CTO), via #1152 executor.
