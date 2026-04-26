# Source Tier-1 — Vision and Decision Space

> **Status:** Draft, decision-pending
> **Date:** 2026-04-26
> **Charter:** [#1281](../../../docs/agents/handoffs/3-verification/1281-mega-80-source-tier1-charter.md) · MEGA-80
> **Builds on:** [ADR-002](ADR-002-sovereign-decision-layer.md) · [ADR-003](ADR-003-scenario-coverage-policy.md)
> **Audience:** Knox, future executor agents, regulators, pilot customers

---

## 1. Bottom line

Source today is a strong Tier-2 product — a verified knowledge graph with a working PACT consensus engine, a 9-cluster scenario library, AU legislation ingest, an agent work economy, a 19-tool MCP surface, and a clean Container Apps deploy. The path to Tier-1 turns on **two open questions Knox must answer before any implementation handoff graduates**: whether private *non-scenario* data can live in Source at all (OQ1a — three options), and whether ADR-003 §6 should be amended to allow customer-scoped scenario *overlays* (OQ1b — binary). This document lays out the gap and the decision space without picking a winner.

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

## 5. Eight workstreams as conditional scenarios

Knox's research brief identified eight workstreams. They make sense **only under OQ1a = (b) or (c)**. Under OQ1a = (a), four of them are Tailor work, not Source. The table below tags each by OQ1a-conditionality so the post-OQ1 ticket can graduate the right subset:

| # | Workstream | Effort | OQ1a-conditional? | Notes |
|---|---|---|---|---|
| WS1 | Tenant & auth foundation — `tenants` table, `tenant_id` FKs, JWT middleware, row-level filters | L (3–4 wk) | OQ1a ≠ (a) | Wrong-product under OQ1a = (a); becomes Tailor data-plane work |
| WS2 | Private-sources schema + upload API — `/api/private/sources/*`, parser pipeline, versioning | L (3–4 wk) | OQ1a ≠ (a) | Wrong-product under OQ1a = (a); private docs live in Tailor |
| WS3 | Observability — structured logging, `/health`, OpenTelemetry to existing collector, App Insights | M (1–2 wk) | All OQ1a outcomes | Already in scope regardless |
| WS4 | Multi-tenant query layer — union public+private scenarios, private match endpoint | L (3–4 wk) | OQ1a ≠ (a) | Wrong-product under OQ1a = (a) |
| WS5 | Audit log + compliance — mutation audit, 7-yr retention, residency config, Privacy Act mapping | M (1–2 wk) | All OQ1a outcomes | Public mutations also benefit from audit |
| WS6 | Admin panel + onboarding — self-serve signup (reuse #1278 `aink.tailor.au/connect`), API key gen, usage dashboard | M (1–2 wk) | OQ1a ≠ (a) | Becomes Tailor admin work under OQ1a = (a) |
| WS7 | Cross-org PACT + contribution attestation | XL post-MVP | All OQ1a outcomes | Defers to MEGA-74 Phase 2B/3 — do not pull forward |
| WS8 | Performance + caching — CDN strategy, Redis warm cache, load test for 10k concurrent | M (1–2 wk) | All OQ1a outcomes | Independent of OQ1a |

Critical path under OQ1a = (b) or (c): WS1 → WS2 → WS4 → WS6 launch; WS3 / WS5 / WS8 parallel; WS7 deferred.

Critical path under OQ1a = (a): WS3 / WS5 / WS8 only in Source; WS1 / WS2 / WS4 / WS6 graduate as Tailor data-plane handoffs (different tickets, different file_locks).

---

## 6. The decision space

### 6.1 OQ1a — Private non-scenario data in Source

Can private documents, private topics, private facts live in Source today? ADR-003 says nothing about this; it governs only `scenarios`. **Three options for Knox.** All three are real; the charter does not pick a winner.

**(a) Source stays pure-public.** Private docs / topics / facts live in Tailor's tenant data plane and reach Source only via published, anonymised statistics. Simplest model; no schema delta in Source. Reads cleanly off ADR-003 + ADR-002 as currently shipped. Customer asks like #1168 (Locksley/Danny George) for "live graph + scenario applicability APIs" — public-tier asks — fit cleanly. Trade-off: tenant-context propagation across products becomes Tailor's problem, not Source's; cross-product SDK design is more work.

**(b) Admit private tier in Source.** Add `tenant_id` to non-scenario tables; new `/api/private/...` namespace; row-level filters; tenant claim in auth. Larger schema delta; reuses Source's existing PACT engine, rate-limit infra, and ACA deploy for private data; concentrates multi-tenant complexity in one product. Trade-off: Source becomes a tenant-boundary product, inheriting the audit, compliance, and isolation surface area that Tailor already carries.

**(c) Hybrid sibling app.** Source remains pure-public; spin a `sites/source-private/` (or sub-app) for the multi-tenant private layer with shared identity (e.g., shared API keys, shared rate-limit Redis, shared MCP entry point but separate routes). Splits the complexity at the cost of two deployment surfaces and an explicit sync contract between them. Trade-off: clean separation of concerns; double the operational load.

The customer-ask signal as of 2026-04-26 (#1168 Locksley DM) points toward **(a)** — the live ask is for public-graph quality + freshness, not private hosting. But Foxleigh, Nyrstar, QGov, Praxis-tier customers may ask for (b) or (c) once Source is a serious option for them. Knox decides based on portfolio strategy, not just current asks.

### 6.2 OQ1b — Amend ADR-003 §6 for scenario overlays

ADR-003 §6 currently defers `tenant_scenarios` overlays to "a future Tailor ticket." Should ADR-003 be amended to allow customer-scoped scenario overlays *in Source*, referencing the public `scenarios` rows as their base?

This is **narrower than OQ1a.** Even under OQ1a = (a), the answer to OQ1b can be "yes — amend ADR-003 §6, allow tenant overlays as a separate Source layer that *references but does not pollute* the public seed." A `tenant_scenario_overlays` table (with `base_scenario_id` FK to public `scenarios`) is structurally different from polluting the public seed with customer-tagged rows; the two-customer test in Decision A doesn't bind overlays.

Knox's options on OQ1b are binary: **amend** (loosen §6 to allow Source-side overlays as a distinct table) or **keep as is** (overlays remain a Tailor data-plane concern; Source's `scenarios` table stays pure).

The two questions interact, but they decouple cleanly. The matrix below is the decision space:

| | OQ1b = keep | OQ1b = amend |
|---|---|---|
| **OQ1a = (a)** | Source stays fully public. Tenant overlays + private data both live in Tailor. Cleanest. | Source stays public for non-scenarios; gains tenant scenario overlays. |
| **OQ1a = (b)** | Source is multi-tenant for non-scenario data; scenarios stay public-only. Awkward asymmetry. | Source is multi-tenant across the board. Most ambitious. |
| **OQ1a = (c)** | Sibling private app handles all private data; Source scenarios stay public-only. | Sibling private app handles private data; Source scenarios gain Source-side overlays. Clearest separation. |

---

## 7. MEGA-74 intersection

Source is referenced in the MEGA-74 charter (`docs/agents/handoffs/1-pending/1184-mega-74-charter.md` §2.3) as the substrate every Fabric inherits from. Three direct intersections:

1. **MEGA-74 Chapter 1 (stitch projection)** is per-public-graph in Source's substrate today. Under OQ1a = (a), no Source schema change is needed — MEGA-74 Chapter 1's stitches enumerate over the public graph and stitches in tenant-private Fabric live in Tailor. Under OQ1a = (b) or (c), MEGA-74 Chapter 1 must be re-specified to consume tenant-aware Source stitches.

2. **MEGA-74 Chapter 9 (mediated negotiation + sanitization proxy)** = **WS7 cross-org PACT**. Defer to MEGA-74; do NOT build cross-org PACT inside Source ahead of MEGA-74 charter execution.

3. **MEGA-74 Chapter 4 (ZK attestations)** = **`agent_work_ledger` future-proofing.** When the post-OQ1 ticket eventually touches the relevant table, populate an `attestation_ref TEXT NULL` placeholder per MEGA-74 Chapter 1's discriminated-union spec. NULL-initial is fine. Free patent enablement; expensive retrofit.

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

- Picking OQ1a or OQ1b. Both are Knox's calls, framed in §6.
- Writing schema, migrations, or route code. This is a vision doc; the post-OQ1 ticket is the bridge to concrete work.
- Committing to a launch date. Once OQ1a + OQ1b resolve, the post-OQ1 ticket can produce the program skeleton and a date-bracketed plan.
- Editing ADR-003. OQ1b's amendment, if Knox accepts it, ships as a separate handoff with proper supersession.

---

## 11. Out of scope / parking lot

- **#946 (1-pending) — Source strategic refactor.** Likely stale (predates Source becoming its own Next.js app at `sites/source/`). Reconcile post-OQ1: either close as obsolete or fold the docs-pieces into the post-OQ1 ticket. Do not edit #946 in this charter.
- **NSW legislation parser.** The cron route at `sites/source/src/app/api/cron/legislation-sync/route.ts:25` accepts a `NSW` param but ships no handler. NSW activation is a future ticket — likely a small follow-on under WS-data-curation. Out of scope here.
- **Auto-generated OpenAPI.** Replacing the manually-maintained `sites/source/public/openapi.json` with route-handler-driven generation is a separate WS3 follow-on; out of scope here.
- **Source typed SDK in Tailor.** A typed Source client in Tailor (`src/frontend/src/lib/source-sdk.ts` or backend equivalent) is a cross-product integration item that depends on OQ1a. Out of scope here.

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
