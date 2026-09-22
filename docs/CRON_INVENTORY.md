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
| **legislation-sync** | `0 6 * * 0` | 4:00 pm Sunday | Full legislation re-sync from AU government sources (CTH, QLD) into `legislation_sections`. CTH filter + extractor fixed by #69. **Detached** (tailor-group#38, see below): lock `LEGISLATION_SYNC_LOCK_KEY = 542502`; `ok` = no jurisdiction reported an error, applied as a **warning** (one source erroring never failed this job); the summary line per jurisdiction carries its counts and **first error string** (160 chars, JSON-escaped) so a credentials failure is readable, not just countable. `GET /api/cron/legislation-sync/status` adds `runs`, the latest `legislation_sync_log` row per jurisdiction | KG platform | GitHub Actions job failure → workflow summary email; `::warning::` for a completed run with errors; a sync that throws is a `cron.legislation-sync.failed` log line | `gh run list --repo TailorAU/pact --workflow cron.yml`; `GET /api/cron/legislation-sync/status` with the bearer |
| **spatial-snapshot** | `0 2 * * *` | 12:00 pm daily | Logan City ArcGIS REST API snapshot — fetches planning layers into `spatial_features` (#874). **Detached** (tailor-group#38): lock `SPATIAL_SNAPSHOT_LOCK_KEY = 542505`. Our own transport/3xx/4xx failures on the trigger are fatal; upstream ArcGIS trouble arrives through the summary — `warning` whenever any layer errored, `ok: false` only when every layer did — and both stay non-fatal (`not-ok: warn`), as the tolerance always was. No log table of its own: `GET /api/cron/spatial-snapshot/status` is `lastRun` alone, with every layer's status and `errorDetail` in `summary.results` | KG platform | `::warning::` annotation in Actions for upstream errors; job failure otherwise | `gh run list --repo TailorAU/pact --workflow cron.yml`; `GET /api/cron/spatial-snapshot/status` with the bearer |
| **gtfs-sync** | `0 17 * * 1` | 3:00 am Tuesday | Translink SEQ GTFS static feed into `transit_stops`, `transit_routes`, `transit_trips`, `transit_stop_times` (#875). Weekly cadence matches GTFS feed publication. **Detached** (tailor-group#38): lock `GTFS_SYNC_LOCK_KEY = 542503`; `ok` = the sync recorded no error, which now **fails** the job (a feed that did not download used to answer 200 with the error in the body). `GET /api/cron/gtfs-sync/status` adds `runs`, the latest `gtfs_sync_log` row | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml`; `GET /api/cron/gtfs-sync/status` with the bearer |
| **fiscal-sync** | `0 18 * * *` | 4:00 am daily | Reconstruct QLD fiscal source data (#3053). **Detached** (tailor-group#38): lock `FISCAL_SYNC_LOCK_KEY = 542504`; `ok` = `status !== "error"`, the verdict the synchronous route used for its 500, so the job fails on exactly what failed it before. `GET /api/cron/fiscal-sync/status` adds `runs`, the latest `fiscal_sync_log` row per jurisdiction | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml`; `GET /api/cron/fiscal-sync/status` with the bearer |
| **auto-merge** | `*/30 * * * *` | every 30 min | Consensus sweep: Silence=Consent auto-merge, topic-proposal approve/reject evaluation, promotion/demotion, challenges. #5425 removed the engine from GET read paths; the route takes a Postgres advisory lock and reports `sweepRan: false` when a concurrent sweep (another replica, or the in-process heartbeat) holds it. A sweep that throws is a structured `cron.auto-merge.failed` log line and a generic 500 | KG platform | GitHub Actions job failure → workflow summary email | `gh run list --repo TailorAU/pact --workflow cron.yml` |

**Endpoint base:** `https://pact.tailor.au/api/cron/<name>` for every job — one
base, no second host to drift from (tailor-app#5582). Never add `-L` to a curl
here; a redirect would forward the bearer to whatever host it names.

**Auth:** `Authorization: Bearer ${CRON_SECRET}` from the `prod` environment
(each job declares `environment: prod`). `auth-check` is the credential proof:
it hits a route with no database dependency, so a 200 says only that the
deployed secret matches.

**Detached jobs** (tailor-group#38): `pact.tailor.au` is proxied through a
Next.js rewrite with a 30 s timeout, so the four long jobs above no longer run
inside the request. Each route takes its own Postgres advisory lock (registry
in `src/lib/db.ts`; single flight across replicas, held on one dedicated
connection for the whole run), upserts the job's row in `cron_job_runs`
(`sql/cron-job-runs.sql`: one row per job name — `job_id`, `started_at`,
`completed_at`, `ok`, `summary`), answers `202 { started, jobId, startedAt }`
at once, and stamps `completed_at` / `ok` / `summary` before it unlocks;
`?wait=1` keeps the synchronous response under the same lock for local use.
Every `GET /api/cron/<job>/status` answers `{ running, lastRun, runs? }`:
`running` is the lock read from `pg_locks`, `lastRun` that row, `runs` the
job's own log rows where it has a table. The workflow jobs share the
composite action `.github/actions/poll-cron-job`: trigger, then poll `/status`
every 30 s to a 27-minute wall-clock deadline (`timeout-minutes: 30`) until
`running` is false and `lastRun` is the triggered run with a `completedAt`;
print the job's summary line(s); fail at the first poll that proves the run
died (lock free, row never completed); and apply the job's `not-ok` policy
(`fail` or `warn`) to a completed run whose `ok` is false. A run that throws
records `ok: false, summary: { error }` and a `cron.<job>.failed` log line.
The locked connection is idle for the whole run (the job's own queries go
through the pool), so the pool sets TCP keepalive (`PG_POOL_OPTIONS` in
`src/lib/db.ts`, 30 s) to stop a NAT or load balancer dropping it mid-run,
which would leave `running: true` and the poller at its deadline for a run
that finished. A status poll that gets no answer (transport failure or a proxy 5xx) is tolerated up to `max-transient-polls` times (default 4) before the job fails, since a replica that dies mid-run looks exactly like that while it restarts. The GTFS ingest streams `stop_times.txt` (~220 MB uncompressed) line by line and keeps only the key stations' rail rows, so it fits the 1 GiB replica.

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
4. **Detached jobs** (tailor-group#38) — `op` = `cron.<job>.started` /
   `.completed` (with `ok`) / `.failed` / `.skipped` / `.record-failed` with
   a `jobId`; `GET /api/cron/<job>/status` (bearer) reports whether the
   job's advisory lock is held anywhere in the cluster, the job's
   `cron_job_runs` row as `lastRun`, and its latest log rows where it has a
   table. Jobs: `legislation-sync`, `gtfs-sync`, `fiscal-sync`,
   `spatial-snapshot`.
5. **Future** — once App Insights is wired, cron and heartbeat success/failure
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
