# Source Tier-1 — Vision and Decision Record

> **Status:** Tier-1 complete 2026-04-26. User-facing surfaces shipped (#1307/#1308/#1309); sovereign substrate migration shipped (#1310). All three substrates (compute, DB, cache) on Azure in `australiaeast`.
> **Date:** 2026-04-26 (charter #1281) · amended 2026-04-26 (decision lock-in #1282) · corrected 2026-04-26 (WS0 split) · WS0b shipped 2026-04-26
> **Charter:** [#1281](../../../docs/agents/handoffs/3-verification/1281-mega-80-source-tier1-charter.md) · MEGA-80
> **Decision lock-in:** [#1282](../../../docs/agents/handoffs/3-verification/1282-mega-80-oq1-decision-lockin.md)
> **Substrate cutover:** [#1310](../../../docs/agents/handoffs/2-active/1310-source-ws0b-sovereign-substrate-migration.md) · commit `88d013a4e`
> **Builds on:** [ADR-002](ADR-002-sovereign-decision-layer.md) · [ADR-003](ADR-003-scenario-coverage-policy.md)
> **Audience:** Knox, future executor agents, regulators, pilot customers

---

## 1. Bottom line

Source today is a strong Tier-2 product — a verified knowledge graph with a working PACT consensus engine, a 9-cluster scenario library, AU legislation ingest, an agent work economy, a 19-tool MCP surface, and a clean Container Apps deploy. **Decided 2026-04-26 (#1282 lock-in):** OQ1a = (a) **Source stays pure-public** — private tenant data lives in Tailor's data plane, never in Source. OQ1b = **no** — ADR-003 stands; customer-scoped scenario overlays remain a Tailor-side concern as ADR-003 §2 Decision A consequences and §6 already plan. Cross-corpus query (public Source + private Tailor) is solved at the API/MCP layer (`tailor_query_with_source`), not by colocating data. This document records the gap, the (now closed) decision space, and the trimmed 5-workstream Source-side scope. Four originally-proposed workstreams (WS1 / WS2 / WS4 / WS6) move to Tailor as separate handoffs.

**Tier-1 status (shipped 2026-04-26):** User-facing surfaces (observability, audit log + compliance, perf + caching) are live on `source.tailor.au`. **Sovereign substrate is fully Azure-aligned in `australiaeast`**: compute (ACA `source-web-prod`) ✅ + database (Azure Database for PostgreSQL Flexible Server `source-pg-prod`) ✅ + cache (Azure Cache for Redis `source-redis-prod`) ✅. Post-cutover `/api/health` Redis probe latency dropped from **~633ms** (Upstash cross-region) to **~3ms** (Azure Cache for Redis in-region) — a 200× improvement that confirms the substrate migration landed cleanly. Source is honestly sovereign-AU Tier-1 — procurement-team data-residency review for QGov / Foxleigh / Nyrstar tenants returns "all data in `australiaeast`."

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
| 6 | Security & compliance | 🟡 | API-key auth ✓; audit log shipped (#1308); encryption-at-rest via Azure Postgres Flexible Server defaults (verified Ready in `rg-source-prod`); PII strategy in `AUDIT.md` Privacy Act mapping |
| 7 | Client onboarding | 🔴 | No self-serve flow; reuse `aink.tailor.au/connect` pattern from #1278 if onboarding ships |
| 8 | Data curation & freshness | 🟡 | Weekly cron (CTH+QLD only); NSW handler not yet shipped; no published freshness SLA |
| 9 | Performance & scale | 🟡 | Azure Postgres Flexible Server (Standard_B1ms) + Azure Cache for Redis (Basic C0) both `australiaeast`; 3-replica ACA; k6 baseline shipped (#1309); post-WS0b /api/health Redis probe ~3ms; CDN strategy documented in `PERFORMANCE.md` (Knox-action to provision) |
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
| WS0a | Azure compute — already on ACA (max 3 replicas) per `cd-source.yml` | — | ✅ Settled | Compute substrate is sovereign-aligned. No work required for this leg. |
| WS0b | **Redis substrate migration** — Upstash Redis → Azure Cache for Redis `source-redis-prod` (Basic C0, `australiaeast`, Redis 6.0, SSL-only port 6380). Client library swap to node-redis v4 across `lib/rate-limit.ts`, `lib/cache.ts`, `app/api/health/route.ts` via shared `lib/redis-client.ts` async-singleton factory. | actual: ~1 day end-to-end (provisioning 18 min + code swap + cd-source deploy + validation) | ✅ **Shipped 2026-04-26** (#1310, commit `88d013a4e`, cd-source run `24950001682` green 2m33s) | **Sovereign-AU substrate complete.** Post-cutover `/api/health` Redis probe latency dropped from ~633ms (Upstash cross-region) to ~3ms (Azure Cache for Redis in-region) — 200× improvement. Procurement-team data-residency review now returns "all data in `australiaeast`." Database leg of WS0b dropped before commit (substrate audit 2026-04-26 caught `source-pg-prod` already on Azure Postgres Flexible Server). |
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
| 2026-04-26 | **WS3 / WS5 / WS8 user-facing surfaces shipped to prod** | #1307 / #1308 / #1309 | Logger + /api/health, audit log + Privacy Act mapping, Redis read-through cache + k6 baseline. All three cd-source runs green. See `OBSERVABILITY.md`, `AUDIT.md`, `PERFORMANCE.md`. |
| 2026-04-26 | **WS0 split into WS0a (compute ✅) + WS0b (substrate ⏳)** — Tier-1 reframed as "user-facing complete; sovereign substrate pending" | #1310 | Knox cold-eye review caught that the original "WS0 settled" tick conflated multiple substrates. (Initial framing claimed both DB+Redis were off-Azure; substrate audit during #1310 §3 verification gate corrected the DB claim — see next entry.) |
| 2026-04-26 | **#1310 substrate audit — DB already on Azure Postgres** — `source-pg-prod` (Standard_B1ms, PG 16) verified Ready in `rg-source-prod` `australiaeast`. The "Neon serverless Postgres" claim was a misread of "Neon-compatible" (the connection-string format) for "Neon-hosted." Only Redis remains off-Azure. Migration scope cut roughly in half. | #1310 | Caught at executor §3 verification gate via `az postgres flexible-server show`. cd-source.yml line 31 also already documents `PG_HOST: source-pg-prod.postgres.database.azure.com`. WS0b is now Redis-only (~3–5 days), not DB+Redis (~1–2 wk). |
| 2026-04-26 | **WS0b Redis substrate migration shipped** — Source data plane fully Azure-aligned in `australiaeast` (Azure Postgres Flexible Server already there + Azure Cache for Redis `source-redis-prod` newly provisioned Basic C0 SSL-only); `@upstash/redis` replaced by node-redis v4 via shared `lib/redis-client.ts` factory; cd-source.yml secrets rotated; commit `88d013a4e`; cd-source run `24950001682` green 2m33s | #1310 | Sovereign-AU procurement-review readiness for QGov / Foxleigh / Nyrstar tenants. /api/health Redis probe latency dropped from ~633ms (Upstash cross-region) to ~3ms (Azure Cache for Redis in-region) — 200× improvement. Knox greenlit path 1 on 2026-04-26; executor provisioned + cutover same day. Round 5 (decommission Upstash) deferred T+7 days for soak. |

---

## 13. Sovereignty posture (corrected 2026-04-26)

The "Azure migration — settled" qualifier in #1282's WS0 line was misread. It conflated three substrates that have very different states:

| Substrate | Today (verified 2026-04-26 post-WS0b) | Sovereign target | Status |
|---|---|---|---|
| **Compute** | Azure Container Apps (`source-web-prod` in `rg-source-prod`, `australiaeast`) per `.github/workflows/cd-source.yml` | Azure Container Apps (`australiaeast`) | ✅ Done (always was) |
| **Database** | Azure Database for PostgreSQL Flexible Server (`source-pg-prod`, Standard_B1ms, PG 16, `australiaeast`) — verified via `az postgres flexible-server show` | Azure Database for PostgreSQL Flexible Server (`australiaeast`) | ✅ Done (always was; was misclaimed as Neon in earlier drafts — "Neon-compatible" connection-string format was misread as Neon-hosted) |
| **Cache / rate-limit** | Azure Cache for Redis (`source-redis-prod`, Basic C0, Redis 6.0, SSL-only port 6380, `australiaeast`) — verified via `/api/health` probe at ~3ms | Azure Cache for Redis (`australiaeast`) | ✅ **Shipped 2026-04-26** (#1310, commit `88d013a4e`) |

### The sovereign-AU pitch is honest now

For QGov, Foxleigh, Nyrstar, and any other AU-government or AU-critical-minerals tenant subject to **procurement-team data-residency review**:

> **Where does Source's data live?** All three substrates are Azure `australiaeast`: compute on Azure Container Apps, database on Azure Database for PostgreSQL Flexible Server, cache on Azure Cache for Redis. No AWS, no cross-region. The data plane exits AU only when an external user reads through global edge (and even then via TLS over public internet — no cross-region replication).

This passes a standard procurement residency review cleanly. If a tenant requires additional sovereignty controls — CMK encryption keys, customer-managed certificates, dedicated-tenant Azure subscription, AU-only build-time dependency manifest — those land as separate ADRs on top of the WS0b baseline.

**Until WS0b ships, do NOT claim Source is "sovereign-AU ready" externally.** Claim:

- ✅ "Source's user-facing surface is Tier-1 (observability, audit log + Privacy Act mapping, perf baselines)."
- ❌ NOT "Source's data plane is sovereign-AU."
- 🟡 "Source's data plane is Azure-aligned for compute today; database and cache substrate migration is in flight (#1310)."

For non-sovereign tracks (general AI agents, public legislation queries, the Locksley-style DM use case which only consumes the public graph), today's posture is fine — there's no procurement question to fail.

### Path taken — execute (shipped 2026-04-26)

Knox greenlit Path 1 on 2026-04-26. Executor ran the substrate migration end-to-end the same day:

- **Provisioned** Azure Cache for Redis `source-redis-prod` (Basic C0, `australiaeast`, Redis 6.0, SSL-only port 6380) via `az redis create` — 18 min provisioning time. Captured primary key. Set `AZURE_REDIS_HOSTNAME` + `AZURE_REDIS_PASSWORD` GitHub secrets via `gh secret set`.
- **Swapped client library** from `@upstash/redis` (HTTPS REST) to node-redis v4 (RESP+TLS). Extracted `lib/redis-client.ts` shared async-singleton factory; refactored `lib/rate-limit.ts` (sliding-window pipeline now uses `multi/exec` with camelCase commands `zRemRangeByScore`/`zAdd`/`zCard`/`expire`), `lib/cache.ts` (EX uppercase, explicit JSON.stringify/parse), `app/api/health/route.ts` (probe via shared singleton with 2s timeout). `@upstash/redis` retained in `package.json` for rollback safety until Round 5 (T+7 days).
- **Updated CD pipeline** — `cd-source.yml` lines 107-108 + 136-137 swapped `KV_REST_API_URL` / `KV_REST_API_TOKEN` for `AZURE_REDIS_HOSTNAME` / `AZURE_REDIS_PASSWORD` in both staging + prod env-var blocks.
- **Atomic commit** `88d013a4e`. cd-source.yml run `24950001682` green in 2m33s.
- **Validation** — `/api/health` Redis probe dropped from ~633ms (Upstash cross-region) to ~3ms (Azure Cache for Redis in-region). DB probe ~52ms. `status: ok`.

Path 2 (relax the directive) was no longer needed.

**Path 2 — Explicitly relax the sovereign-AU directive.** Document the relaxation as an ADR-004 supersession of the WS0b commitment, recorded in this doc's §12 Decision log + a separate ADR. The "Azure-only" framing quietly evaporating without record is the failure mode this section is intended to prevent.

Knox decides. Until then, this doc carries the corrected posture so internal references don't propagate the original misclaim.

### What WS0b does NOT cover

- LLM provider sovereignty (Source uses `AZURE_OPENAI_KEY` per `cd-source.yml:108` — that's already Azure-aligned).
- CDN sovereignty (no CDN in front of Source today; recommended Cloudflare config in `PERFORMANCE.md` is global edge, not AU-only).
- Tailor-side substrates (Tailor has its own sovereign track via `cd-sovereign.yml`; Source's WS0b is independent).

These are outside Source's WS0b scope. If they become procurement requirements, they're separate handoffs.

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
