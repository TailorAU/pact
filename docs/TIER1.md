# Source Tier-1 — Vision and Decision Record

> **Status:** Decisions locked in 2026-04-26 (#1282)
> **Date:** 2026-04-26 (charter #1281) · amended 2026-04-26 (decision lock-in #1282)
> **Charter:** [#1281](../../../docs/agents/handoffs/3-verification/1281-mega-80-source-tier1-charter.md) · MEGA-80
> **Decision lock-in:** [#1282](../../../docs/agents/handoffs/3-verification/1282-mega-80-oq1-decision-lockin.md)
> **Builds on:** [ADR-002](ADR-002-sovereign-decision-layer.md) · [ADR-003](ADR-003-scenario-coverage-policy.md)
> **Audience:** Knox, future executor agents, regulators, pilot customers

---

## 1. Bottom line

Source today is a strong Tier-2 product — a verified knowledge graph with a working PACT consensus engine, a 9-cluster scenario library, AU legislation ingest, an agent work economy, a 19-tool MCP surface, and a clean Container Apps deploy. **Decided 2026-04-26 (#1282 lock-in):** OQ1a = (a) **Source stays pure-public** — private tenant data lives in Tailor's data plane, never in Source. OQ1b = **no** — ADR-003 stands; customer-scoped scenario overlays remain a Tailor-side concern as ADR-003 §2 Decision A consequences and §6 already plan. Cross-corpus query (public Source + private Tailor) is solved at the API/MCP layer (`tailor_query_with_source`), not by colocating data. This document records the gap, the (now closed) decision space, and the trimmed 5-workstream Source-side scope. Four originally-proposed workstreams (WS1 / WS2 / WS4 / WS6) move to Tailor as separate handoffs.

---

## 2. What's already solid

The shipped product (verified 2026-04-26) — do not re-architect:

| Capability | Where | Verification |
|---|---|---|
| PACT consensus engine | `sites/source/src/lib/db.ts:84–299` (topics, proposals, votes, intents, constraints, salience) | shipped, in use |
| Scenario library — ~31 scenarios across 9 clusters | `sites/source/scripts/seed_scenarios_*.py` (9 files: AML/CTF, ASX, critical-minerals, defence, mining-safety, privacy, procurement, US-inbound, WHS) | per ADR-003 line 6 |
| Work economy — `agent_work_ledger`, blind-prediction validator (#1160) | `sites/source/sql/sovereign-decision-layer-schema.sql:81–92` + `/api/work/{claim,submit,assignments,defects}` | shipped |
| Legislation ingest — CTH + QLD parsers, weekly cron | `sites/source/src/app/api/cron/legislation-sync/route.ts` (line 25 accepts NSW param but no handler ships) | shipped |
| Rate limiting — Upstash sliding-window with in-memory fallback | `sites/source/src/lib/rate-limit.ts:1–50` | shipped |
| MCP surface — 19 tools | `sites/source/mcp/src/index.ts:60–448` (`grep -c '\.tool('` → 19) | shipped |
| OpenAPI — 44 paths, manually maintained | `sites/source/public/openapi.json` (`grep -c '"/api/'` → 44) | shipped |
| Auth — API-key only (`x-source-agent-key`) | `sites/source/mcp/src/index.ts:30` + route handlers | shipped, no JWT, no tenant claim |
| Deployment — ACA, max 3 replicas | `.github/workflows/cd-source.yml:127` (`--max-replicas 3`) | shipped |
| ADRs documented | `sites/source/docs/ADR-002-sovereign-decision-layer.md`, `ADR-003-scenario-coverage-policy.md` | accepted |

**CI health, last 30 days:** all 10 most recent `cd-source.yml` runs succeeded. No rollbacks visible. Most recent activity 2026-04-22 (#1252 BACKLOG bump) and 2026-04-17 (#1160 R7 prod seed wave).

---

## 3. The 12-dimension Tier-1 gap

| # | Dimension | Status | One-line gap |
|---|---|---|---|
| 1 | Multi-tenancy & isolation | 🔴 | No `tenant_id`; no RLS; no tenant claim in auth — but see ADR-003 §6 (defer, not foreclose) |
| 2 | Private-sources data model | 🔴 | Schema is public-only; no `private_sources` namespace |
| 3 | API surface coverage | 🟡 | 44 routes; no `/api/private/...`; OpenAPI manually maintained, not auto-generated |
| 4 | PACT cross-org | 🟡 | In-org PACT works; cross-tenant consensus / reputation bridge defers to MEGA-74 Phase 2B/3 |
| 5 | Production posture | 🟡 | CI/CD + Upstash rate limit ✓; no observability beyond ACA defaults; no published SLA; no DR procedure |
| 6 | Security & compliance | 🟡 | API-key auth ✓; no audit log; no encryption-at-rest policy beyond Neon defaults; no PII strategy |
| 7 | Client onboarding | 🔴 | No self-serve flow; reuse `aink.tailor.au/connect` pattern from #1278 if onboarding ships |
| 8 | Data curation & freshness | 🟡 | Weekly cron (CTH+QLD only); NSW handler not yet shipped; no published freshness SLA |
| 9 | Performance & scale | 🟡 | Neon serverless, 3-replica ACA; no load-test data; no CDN strategy |
| 10 | Cross-product integration | 🟡 | `SourceLegislationResolver` HTTP works in Tailor; no typed SDK; tenant-context propagation depends on OQ1a |
| 11 | Documentation | 🟡 | README + 3 ADRs (this is the 4th doc); no architecture guide; no runbook; no breaking-changes policy |
| 12 | MEGA-74 / contribution attestation | 🔴 | No ZK proof; no immutable contribution signature; `agent_work_ledger` is the in-org precursor (free patent enablement if a future schema touch adds an `attestation_ref TEXT NULL` placeholder per MEGA-74 Chapter 4) |

🔴 = missing entirely · 🟡 = partial / shipped baseline but lacks Tier-1 polish · ✅ = Tier-1-ready (none yet)

---

## 4. ADR-003 — what it actually binds

The earlier strategic read of "Source becomes multi-tenant" assumed ADR-003 forecloses private data anywhere in Source. **It does not.** ADR-003 binds the **`scenarios` table** to public-only via Decision A, and explicitly defers (does not foreclose) tenant overlays in §6.

**ADR-003 Decision A (`sites/source/docs/ADR-003-scenario-coverage-policy.md` line 25):**

> "Source `scenarios` are the public canonical set of **general-industry** applicability predicates. Customer- or project-specific applicability stays **tenant-side in Tailor** (per-org graph overlays, not the public Source graph)."

**ADR-003 §6 — Out of scope (line 128):**

> "Tenant-side overlays are a future concern for Tailor, not Source."

The phrase "future concern for Tailor, not Source" reads as a **defer**, not a foreclose. The decision was scoped to keep the #1160 scenario library expansion focused; it did not pre-decide whether private data of any other kind can ever live in Source. The actual decision space is two narrower questions, framed in §6 below.

---

## 5. Five surviving Source workstreams (post-OQ1 lock-in)

**Decided 2026-04-26:** OQ1a = (a) pure-public Source. The four workstreams that required Source to become multi-tenant — WS1 tenant foundation, WS2 private-sources schema, WS4 multi-tenant query, WS6 admin + onboarding — move to Tailor as separate handoffs. Source's Tier-1 program is now five workstreams.

| # | Workstream | Effort | Status | Notes |
|---|---|---|---|---|
| WS0 | Azure foundation — already on ACA (max 3 replicas), Upstash sliding-window rate limit, Neon serverless | — | ✅ Settled | Source is already on ACA per `.github/workflows/cd-source.yml`. No migration to do. Listed for completeness so the program inventory is honest. |
| WS3 | Observability — structured logging, `/health`, OpenTelemetry to existing collector, App Insights | M (1–2 wk) | 🟡 To do | Independent of OQ1a; fits naturally next to existing rate-limit + cron infra. |
| WS5 | Audit log + compliance — mutation audit, 7-yr retention, residency config, Privacy Act mapping | M (1–2 wk) | 🟡 To do | Public mutations also benefit from audit (PACT votes, scenario proposals, legislation contributions). |
| WS7 | Cross-org PACT + contribution attestation | XL post-MVP | ⏳ Deferred | Defers to MEGA-74 Phase 2B/3. Do NOT pull forward into Source ahead of MEGA-74. |
| WS8 | Performance + caching — CDN strategy, Redis warm cache, load test for 10k concurrent | M (1–2 wk) | 🟡 To do | Independent of OQ1a. Likely the lowest-risk fast win. |

**Critical path:** WS3 / WS5 / WS8 can run in parallel; WS7 is deferred; WS0 needs no action.

### 5.1 Moved to Tailor — separate handoffs, not in MEGA-80

Under OQ1a = (a), four workstreams from the original 8-WS draft are not Source's job. They land as Tailor handoffs with separate ticket numbers (none claimed in this charter — they spawn from Tailor's BACKLOG when scoped):

| # | Original Source framing | Tailor-side reframe |
|---|---|---|
| WS1 | Tenant foundation in Source | **NOT NEEDED** — Tailor already has tenancy. The need was a misframe. |
| WS2 | Private-sources schema in Source | Becomes `tailor_private_sources` — extension of Tailor's document model that tags Tailor docs as "sources" (searchable, citable, queryable from MCP). Tailor workstream. |
| WS4 | Multi-tenant query layer in Source | Becomes a cross-product MCP tool — `tailor_query_with_source` — that federates Source's public answer + Tailor tenant context. Lives in Tailor's MCP, calls Source's public MCP under the hood. |
| WS6 | Admin + onboarding in Source | **NOT NEEDED for private sources** — Tailor admin already covers tenant onboarding. Source's existing API-key issuance via `POST /api/pact/register` is sufficient for public-tier agent access. |

---

## 6. Decisions recorded

### 6.1 OQ1a — Private non-scenario data in Source

**Decided 2026-04-26: (a) Source stays pure-public.**

Private documents, private topics, private facts live in Tailor's tenant data plane and reach Source only via published, anonymised statistics or via federated MCP query. ADR-003 + ADR-002 stand as currently shipped. No `tenant_id` columns in Source; no `/api/private/...` namespace; no JWT tenant claim added to Source auth.

**Rationale (per Knox lock-in 2026-04-26):**

| Factor | (a) Pure-public | (b) Multi-tenant Source | (c) Hybrid sibling |
|---|---|---|---|
| Time to "clients with private sources in prod" | ~6 wk (Tailor already has tenancy) | 4–6 mo (full tenant plumbing in Source) | 3–4 mo (new app to scaffold) |
| Engineering cost | M (cross-product query layer in Tailor) | XL (schema, RLS, audit, billing, leakage tests) | L (duplicates schema + services) |
| ADR-003 reversal | not needed | required (high-cost signal — 8-day-old ADR) | not needed |
| Source brand "verified public good" | intact | muddied (gov / enterprise buyers may distrust private+public colocated) | intact for Source proper |
| Foreclosure risk | none — can add (b) later if needed | high — locks in private+public coupling | medium — sibling app is hard to retire |
| Cross-corpus query UX | API-federated (one MCP call, two backends) | unified DB query | API-federated |
| Loom alignment (per MEGA-74 §2.3) | clean (Source stays Tier-0 substrate) | complicated (private tenant data crosses Loom boundary) | clean for public side |

**The reframe that unlocked the decision.** Knox's research brief originally framed this as "clients load private sources INTO Source." The actual user need is "private data interacts with Source's public knowledge." Those are different — the second is a cross-corpus query problem, solved at the API/MCP layer; the first requires tenancy in Source. Buyers (Foxleigh, Nyrstar, QGov) don't care which DB row sits where. They care that an AI agent can answer "what applies to me, given the public legislation graph + my org's policies?" Federated query at the MCP layer is invisible to that agent.

**What we trade away under (a):**

- **Pitch elegance.** "Buy Source, get private + public knowledge graph" is a cleaner sales line than "buy Tailor, which has private sources that federate to Source's public layer." Recoverable later if needed.
- **Single-DB unified queries.** A query that joins private and public in one SQL statement is impossible under (a) — federation happens at the API layer. For analytics / reporting workloads this is friction; for agent-facing MCP queries it is invisible.

(a) does **not** foreclose (b). If 18 months in we find genuine need for private knowledge IN Source, we can add it then. (b) and (c) are harder to walk back.

### 6.2 OQ1b — Amend ADR-003 §6 for scenario overlays

**Decided 2026-04-26: no — ADR-003 stands.**

Customer-scoped scenarios remain tenant-side in Tailor as `tenant_scenarios` overlays referencing Source's public scenarios — exactly as ADR-003 §2 Decision A consequences and §6 already plan. ADR-003 is **not amended.** The tenant overlay table lives in Tailor's data plane, not in Source.

### 6.3 Decision matrix — closed cell

| | OQ1b = keep (locked in) |
|---|---|
| **OQ1a = (a)** (locked in) | ✅ **Source stays fully public.** Tenant overlays + private data both live in Tailor. Cross-corpus query via federated MCP (`tailor_query_with_source`). Cleanest path to Tier-1, fastest delivery, brand integrity preserved. |

---

## 7. MEGA-74 intersection (under OQ1a = (a) — locked in)

Source is referenced in the MEGA-74 charter (`docs/agents/handoffs/1-pending/1184-mega-74-charter.md` §2.3) as the substrate every Fabric inherits from. With OQ1a = (a) locked in, the three intersections simplify:

1. **MEGA-74 Chapter 1 (stitch projection)** is per-public-graph in Source's substrate. **No Source schema change needed.** MEGA-74 Chapter 1's stitches enumerate over the public graph; tenant-private Fabric stitches live in Tailor and never reach Source's substrate. This is now the canonical path — the OQ1a=(b)/(c) re-specification branches are off the table.

2. **MEGA-74 Chapter 9 (mediated negotiation + sanitization proxy)** = **WS7 cross-org PACT**. Defers to MEGA-74; do NOT build cross-org PACT inside Source ahead of MEGA-74 charter execution.

3. **MEGA-74 Chapter 4 (ZK attestations)** = **`agent_work_ledger` future-proofing.** When a future Source schema touch lands (most likely under WS5 audit log work), populate an `attestation_ref TEXT NULL` placeholder per MEGA-74 Chapter 1's discriminated-union spec. NULL-initial is fine. Free patent enablement; expensive retrofit.

---

## 8. Risk register

- **Tenant-boundary classification on the post-OQ1 ticket.** If OQ1a resolves to (b) or (c), the next handoff inherits the elevated-scrutiny classification used by #1254 / #1270 / #1278 — full tenant-isolation review, residency config, cross-tenant leak negative tests.
- **`SourceLegislationResolver` consumer fan-out.** Tailor's `SourceLegislationResolver` (HTTP) currently has no tenant-context propagation. Revising this to pass tenant context (under OQ1a ≠ (a)) is a Tailor-side migration with its own surface area.
- **Cross-product reputation bridge.** Pulling cross-org PACT (WS7) forward into Source ahead of MEGA-74 breaks the charter sequencing and creates a parallel implementation that MEGA-74 will then need to reconcile. Do not.
- **OpenAPI auto-generation drift.** OpenAPI is manually maintained today (44 paths). As the surface grows under any OQ1a outcome, manual maintenance becomes a freshness-SLA risk. Auto-generation from route handlers is a low-cost WS3 add-on if it ships.
- **Naming collision.** `src/WebApi/Features/Source/` and `Common/Domain/Source/` in the Tailor monorepo are supply-chain BestPrice entities — completely unrelated to this product. Any future SDK / typed-client work must not import these by mistake.

---

## 9. Operational reality check (grounding appendix)

Five bullets from the 30-minute grounding pass at execution time, 2026-04-26:

- **CI is healthy.** All 10 most recent `cd-source.yml` runs succeeded (last push 2026-04-22, before that the #1160 R7 wave on 2026-04-17). No rollbacks. Tier-1 work does not need to fix a broken pipeline first.
- **The only live customer-ask signal is public-tier.** #1168 (Locksley/Danny George DM) claims Source backs up Locksley's full compliance stack via *live graph, scenario applicability APIs, and agent-consumable endpoints*. All public-graph asks. No private-tier ask in flight as of execution time.
- **#1160 prod seed (R7) is human-gated.** The #1160 lifecycle has shipped #1160 Rounds 0–6 to dev and prod; Round 7 (prod seed) is human-gated per the handoff §12 PowerShell block. Tier-1 workstreams that touch the scenarios table must coordinate with #1160's prod seed window, not assume seed is done.
- **Naming-collision precedent.** `src/WebApi/Features/Source/` (BestPrice supply-chain) is documented in `AGENTS.md`. Any Tier-1 SDK work in Tailor must explicitly avoid this namespace in its import paths.
- **Multi-agent BACKLOG churn is high.** Between this charter's drafting (acfbb343e at 03:04) and execution (902e0830a six commits later), Baink #1290 ran six rounds (#1292–#1297) and PACT #1301 shipped. The post-OQ1 ticket needs to re-baseline `@parallel_safety` against the live BACKLOG, not the snapshot in this doc.

---

## 10. What we're not doing

- Re-opening OQ1a or OQ1b. Both are decided 2026-04-26 (§6 + §12).
- Writing schema, migrations, or route code in Source. The 5 surviving Source workstreams (WS3 / WS5 / WS7 / WS8) graduate as their own handoffs after this lock-in lands.
- Committing to a launch date. Once WS3 / WS5 / WS8 are scoped (each is M, 1–2 wk), a date-bracketed plan can land.
- Editing ADR-003. ADR-003 stands per OQ1b decision.

---

## 11. Out of scope / parking lot

- **Tailor-side cross-product workstreams.** WS1 / WS2 / WS4 / WS6 from the original 8-WS draft moved to Tailor under OQ1a = (a). Tailor handoffs for `tailor_private_sources` (Tailor doc-model extension), `tailor_query_with_source` (federated MCP tool), and tenant-context propagation in the existing `SourceLegislationResolver` are scoped separately. This document does not specify them; the Source side of the seam is the existing public MCP (19 tools) and OpenAPI (44 paths). They land as Tailor BACKLOG entries, not MEGA-80 sub-tickets.
- **#946 (1-pending) — Source strategic refactor.** Likely stale (predates Source becoming its own Next.js app at `sites/source/`). Reconcile when convenient: either close as obsolete or fold the docs-pieces into a future Source maintenance handoff. Do not edit #946 in this charter or in #1282.
- **NSW legislation parser.** The cron route at `sites/source/src/app/api/cron/legislation-sync/route.ts:25` accepts a `NSW` param but ships no handler. NSW activation is a future ticket — a small follow-on under data-curation. Out of scope here.
- **Auto-generated OpenAPI.** Replacing the manually-maintained `sites/source/public/openapi.json` with route-handler-driven generation is a low-cost WS3 add-on if it ships; out of scope as its own workstream.
- **Source typed SDK in Tailor.** A typed Source client in Tailor (`src/frontend/src/lib/source-sdk.ts` or backend equivalent) is a cross-product integration item that lands on the Tailor side of the WS4 reframe (`tailor_query_with_source`).

---

## 12. Decision log

| Date | Decision | Ticket | One-line rationale |
|---|---|---|---|
| 2026-04-26 | **OQ1a = (a)** Source stays pure-public; private tenant data lives in Tailor's data plane | #1282 | Fastest path to "private sources in prod" (~6 wk via Tailor extension vs 4–6 mo via Source tenant plumbing); honors freshly-accepted ADR-003; preserves Source's "verified public good" brand for gov / enterprise buyers; doesn't foreclose (b) later. Full rationale + trade-off table in §6.1. |
| 2026-04-26 | **OQ1b = no** ADR-003 stands; customer-scoped scenario overlays remain a Tailor-side concern | #1282 | ADR-003 §2 Decision A consequences and §6 already plan tenant overlays as a Tailor data-plane concern. No reversal needed. |
| 2026-04-26 | **MEGA-80 trimmed to 5 surviving Source workstreams** (WS0 settled, WS3/WS5/WS8 to do, WS7 deferred) | #1282 | OQ1a = (a) makes WS1/WS2/WS4/WS6 wrong-product; they move to Tailor as separate handoffs. See §5.1. |

---

## Appendix A — How to use this document

When OQ1a + OQ1b resolve, the next handoff (#1282) consumes this doc as input. The minimum it needs:

- §3 to scope which dimensions ship in MVP vs phase 2.
- §5 to graduate the right subset of WS1–WS8 (the unconditional ones always; the OQ1a-conditional ones only if OQ1a ≠ (a)).
- §6 for the recorded decisions.
- §7 to coordinate with MEGA-74 sequencing.
- §8 for risk-register inheritance.
- §9 for operational baselines that may have shifted by then.

If §9 has aged more than ~30 days when #1282 runs, refresh the grounding pass before drafting WS handoffs. CI health, customer-ask signals, and BACKLOG churn move fast.
