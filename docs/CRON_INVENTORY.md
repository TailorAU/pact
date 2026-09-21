# PACT Knowledge Graph — Cron Inventory

Canonical reference for every scheduled job that touches the knowledge graph
(`pact.tailor.au`) or its backing data stores. One row per distinct trigger.
Updated 2026-09-21 for the re-home into this repository (tailor-group#9): the
scheduler is `.github/workflows/cron.yml` here, and the consensus sweep also
ticks from an in-process heartbeat.

All times are UTC unless noted. AEST = UTC+10 (non-DST). AEDT = UTC+11 (DST).

---

## Where the schedule runs from

- **`.github/workflows/cron.yml`** in this repository calls
  `https://pact.tailor.au/api/cron/<name>` with
  `Authorization: Bearer ${CRON_SECRET}` — the `prod` environment secret
  `cd-kg.yml` deploys into the `pact-web` container app, so the credential has
  exactly one source. Every job declares `environment: prod` to read it (an
  environment secret is empty in a job that does not); `prod` has no required
  reviewers, so nothing waits.
- **GitHub runs `schedule` triggers from the default branch only.** The KG
  deploys from `rehome-review` until tailor-group#7 step 3 promotes it, so
  until then the schedules below are inert and every job is reachable through
  `workflow_dispatch` on that branch (see Quick commands). GitHub lists and
  dispatches only a workflow that has run at least once, so `cron.yml` carries
  a `push` trigger on its own path: that no-op run (every job's `if:` ignores
  a push) is what registers it. Nothing else changes at promotion.
- **The consensus sweep does not wait for promotion.** `instrumentation.ts`
  starts `src/lib/consensus-heartbeat.ts` on every server boot; it calls
  `runConsensusSweep` every `CONSENSUS_SWEEP_INTERVAL_MINUTES` (default 30,
  `0` disables, requires `DATABASE_URL`). The sweep's Postgres advisory lock
  (`CONSENSUS_SWEEP_LOCK_KEY`) makes the heartbeat, a second replica and the
  GitHub job skip rather than double-run.
- **History.** These jobs ran from tailor-app's `cron-source.yml` until
  tailor-app#5954 retired the Source-era workflows and their secrets on
  2026-09-18, which left the engine with no scheduler at all (tailor-group#9).

---

## Workflow: `cron.yml` — PACT Knowledge Graph Maintenance

Single workflow, multiple jobs dispatched by schedule. Every job calls
`https://pact.tailor.au/api/cron/<name>` with a `Bearer ${CRON_SECRET}`.

| Name | Schedule | AEST equivalent | Purpose | Owner | Alert path | Last-success check |
|---|---|---|---|---|---|---|
| **auth-check** | Manual only; never scheduled or included by `all` | N/A | Read-only proof that the deployed `CRON_SECRET` matches the repository secret. Calls `GET /api/cron/auth-check`; no database access or maintenance mutation | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **cleanup** | `0 3 * * *` | 1:00 pm daily | Latch + purge unchained pre-#5566 events past retention (#5598), prune resolved proposals and stale registrations older than 90 days, drop spent invite tokens, run the consensus sweep, classify claim atomicity (#3691 W6) | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **yield** | `0 4 * * 0` | 2:00 pm Sunday | Distribute Axiom Yield revenue pro-rata to contributing agent wallets | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **staleness** | `0 5 * * *` | 3:00 pm daily | Mark legislation documents as stale when `last_synced` > threshold; sets `is_stale` consumed by `/api/admin/freshness` (#1401 Round B) | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **legislation-sync** | `0 6 * * 0` | 4:00 pm Sunday | Full legislation re-sync from AU government sources (CTH, QLD) into `legislation_sections`. CTH filter + extractor fixed by #69. Runs with `timeout-minutes: 30` | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **spatial-snapshot** | `0 2 * * *` | 12:00 pm daily | Logan City ArcGIS REST API snapshot — fetches planning layers into `spatial_features` (#874). Our own transport/3xx/4xx failures are fatal; an upstream ArcGIS 5xx is a warning | KG platform | `::warning::` annotation in Actions for upstream 5xx; job failure otherwise | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **gtfs-sync** | `0 17 * * 1` | 3:00 am Tuesday | Translink SEQ GTFS static feed into `transit_stops`, `transit_routes`, `transit_trips`, `transit_stop_times` (#875). Weekly cadence matches GTFS feed publication | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **fiscal-sync** | `0 18 * * *` | 4:00 am daily | Reconstruct QLD fiscal source data. Runs with `timeout-minutes: 30` (#3053) | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |
| **auto-merge** | `*/30 * * * *` | every 30 min | Consensus sweep: Silence=Consent auto-merge, topic-proposal approve/reject evaluation, promotion/demotion, challenges. #5425 removed the engine from GET read paths; the route takes a Postgres advisory lock and reports `sweepRan: false` when a concurrent sweep (another replica, or the in-process heartbeat) holds it. A sweep that throws is a structured `cron.auto-merge.failed` log line and a generic 500 | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |

**Endpoint base:** `https://pact.tailor.au/api/cron/<name>` for every job — one
base, no second host to drift from (tailor-app#5582). Never add `-L` to a curl
here; a redirect would forward the bearer to whatever host it names.

**Auth:** `Authorization: Bearer ${CRON_SECRET}` from the `prod` environment
(each job declares `environment: prod`). `auth-check` is the credential proof:
it hits a route with no database dependency, so a 200 says only that the
deployed secret matches.

---

## In-process heartbeat: consensus sweep

| Name | Cadence | Purpose | Configuration | Where to look |
|---|---|---|---|---|
| **consensus-heartbeat** | every 30 min, first tick 60 s after boot, per replica | Calls `runConsensusSweep` — the same entry point `/api/cron/auto-merge` and `/api/cron/cleanup` use — so the engine ticks without an external scheduler (tailor-group#9). A tick that overlaps a running sweep is skipped and counted; a sweep that throws is logged and the next tick still fires | `CONSENSUS_SWEEP_INTERVAL_MINUTES` (unset = 30, `0`/`off` = disabled, floor 1); starts only when `DATABASE_URL` is set | Container console logs, `op` = `consensus.heartbeat.started` / `.tick` / `.overlap` / `.failed` / `.disabled` (`ContainerAppConsoleLogs_CL` in Log Analytics) |

---

## Retired workflows (history, not re-homed)

tailor-app#5954 retired these with the rest of the Source-era CI on
2026-09-18, after `rg-source-prod` was deleted on 2026-09-17. They are recorded
here so nobody goes looking for them.

| Workflow | Was | Why it stays retired |
|---|---|---|
| `source-scenarios.yml` | Weekly scenario golden check (`0 6 * * 1`) against prod, read-only (#1160 Round 4) | Not re-homed yet; `scripts/scenario_golden_check.py` is the entry point if it comes back |
| `source-cve-scan.yml` | Weekly `npm audit` + `trivy image` re-scan (`0 14 * * 1`) | `cd-kg.yml` runs the audit gate and the Trivy scan on every deploy |
| `source-grocery-scrape.yml` | Six-hourly Coles/Woolworths price scrape via `sites/bestprice` | `rg-bestprice-prod` and `rg-source-prod` were deleted 2026-09-17; the scrapers have no target |
| `source-fuel-scrape.yml` | Daily fuel-price scrape (schedule wired, build gated on #1401 Round A) | Same; `bestprice-fuel-scrape.yml` was already permanently disabled |
| `migrate-source.yml` | Manual schema migration dispatch | The KG schema self-bootstraps in `initSchema` on the first `getDb()` of a boot |

---

## Out-of-scope (cron routes without a workflow trigger)

One cron API route exists in `src/app/api/cron/` that does not have a
corresponding scheduled workflow entry. It is documented here for
completeness. (`/api/cron/auto-merge` used to sit in this table; #5425 wired
its `*/30 * * * *` schedule when the engine came off the GET read paths —
see the main table above.)

| Cron route | Purpose | Why not scheduled |
|---|---|---|
| `/api/cron/quote-rates-assignments` | Opens fresh `agent_work_assignment` records per stale `(item_key, retailer)` pair so agents can mine retail prices (#1216) | Daily cadence is described in the route comment but no GitHub Actions trigger has been wired. Adding this is a distinct piece of work; file a requirement when BestPrice agent mining ramps up. |

---

## Intentionally manual operations

Some data operations that look like cron candidates are intentionally manual.

| Operation | Why manual |
|---|---|
| **Legislation manual ingest** (`POST /api/pact/legislation/propose`) | Agent-contributed legislation goes through PACT 3-agent consensus before ingestion. This is a human-in-the-loop protocol, not a timer event. |
| **Seed runs** (`scripts/seed_*.py`) | Data changes on the live graph: dry-run → diff → apply only on Knox's go (tailor-group#7). |
| **NSW legislation parser** (#1401 Round D) | Parser not yet built; NSW sync is therefore a manual gap, not a disabled cron. |
| **Axiom fact contribution** | Requires authenticated agent key and PACT consensus; no timer semantics. |

---

## Monitoring reference

No centralised dashboard exists yet. Current monitoring surface:

1. **GitHub Actions UI** — `https://github.com/TailorAU/pact/actions` —
   filter by workflow name for history. Inert schedules produce no runs until
   the workflow is on the default branch; dispatched runs appear as usual.
2. **Health endpoint** — `GET https://pact.tailor.au/api/health` returns
   `{ status, checks: { db, redis }, version, region }`. Does not surface cron
   or heartbeat state.
3. **Heartbeat** — container console logs in Log Analytics
   (`ContainerAppConsoleLogs_CL`), `op` starting `consensus.heartbeat.`; a
   route-level sweep failure is `cron.auto-merge.failed`.
4. **Future** — once App Insights is wired, cron and heartbeat success/failure
   become custom metrics with alert rules for consecutive failures.

---

## Quick commands

```bash
# While the KG deploys from rehome-review, dispatch on that branch.
REF=rehome-review

# Prove cron authentication without mutating production data
gh workflow run cron.yml --repo TailorAU/pact --ref "$REF" -f job=auth-check

# Trigger a specific maintenance cron manually (mutates production data)
gh workflow run cron.yml --repo TailorAU/pact --ref "$REF" -f job=auto-merge
gh workflow run cron.yml --repo TailorAU/pact --ref "$REF" -f job=legislation-sync
gh workflow run cron.yml --repo TailorAU/pact --ref "$REF" -f job=all

# Check the last 5 runs of the maintenance workflow
gh run list --repo TailorAU/pact --workflow cron.yml --limit 5
```
