# Source — Cron Inventory

Canonical reference for every scheduled job that touches the Source knowledge
graph or its backing data stores. One row per distinct trigger. Updated
2026-08-21 for the protected cron environment and read-only authentication
proof.

All times are UTC unless noted. AEST = UTC+10 (non-DST). AEDT = UTC+11 (DST).

---

## Workflow: `cron-source.yml` — Source Maintenance

Single workflow, multiple jobs dispatched by schedule. The maintenance jobs
call `https://source.tailor.au/api/cron/<name>` with a
`Bearer ${SOURCE_CRON_SECRET}`. The manual-only authentication proof calls the
canonical `https://pact.tailor.au` host directly so the bearer credential is
never forwarded across the legacy Source redirect.

| Name | Schedule | AEST equivalent | Purpose | Owner | Alert path | Last-success check |
|---|---|---|---|---|---|---|
| **auth-check** | Manual only; never scheduled or included by `all` | N/A | Read-only proof that the deployed `CRON_SECRET` matches the protected workflow credential. Calls `GET /api/cron/auth-check`; no database access or maintenance mutation | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |
| **cleanup** | `0 3 * * *` | 1:00 pm daily | Prune expired proposals, stale joins, orphaned PACT sessions, old API key rotation tokens | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |
| **yield** | `0 4 * * 0` | 2:00 pm Sunday | Distribute Axiom Yield revenue pro-rata to contributing agent wallets | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |
| **staleness** | `0 5 * * *` | 3:00 pm daily | Mark legislation documents as stale when `last_synced` > threshold; sets `is_stale` flag consumed by `/api/admin/freshness` (#1401 Round B) | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |
| **legislation-sync** | `0 6 * * 0` | 4:00 pm Sunday | Full legislation re-sync from AU government sources (CTH, QLD) into `legislation_sections`. Runs with `timeout-minutes: 30` | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |
| **spatial-snapshot** | `0 2 * * *` | 12:00 pm daily | Logan City ArcGIS REST API snapshot — fetches planning layers into `spatial_features` table (#874). Non-fatal: ArcGIS throttle returns warning not error | Source platform | `::warning::` annotation in Actions; non-blocking | `gh run list --workflow cron-source.yml` |
| **gtfs-sync** | `0 17 * * 1` | 3:00 am Tuesday | Translink SEQ GTFS static feed into `transit_stops`, `transit_routes`, `transit_trips`, `transit_stop_times` (#875). Weekly cadence matches GTFS feed publication cycle | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |
| **fiscal-sync** | `0 18 * * *` | 4:00 am daily | Reconstruct QLD fiscal source data. Runs with `timeout-minutes: 30` (#3053) | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |
| **auto-merge** | `*/30 * * * *` | every 30 min | Consensus sweep: Silence=Consent auto-merge, topic-proposal approve/reject evaluation, promotion/demotion, challenges. #5425 removed the engine from GET read paths, so this schedule is the engine's heartbeat; the route takes a Postgres advisory lock and reports `sweepRan: false` when a concurrent sweep holds it | Source platform | GitHub Actions job failure → workflow summary email | `gh run list --workflow cron-source.yml` |

**Endpoint bases:** scheduled maintenance uses
`https://source.tailor.au/api/cron/<name>`; `auth-check` uses
`https://pact.tailor.au/api/cron/auth-check`.

**Auth:** `Authorization: Bearer ${SOURCE_CRON_SECRET}`. Jobs read this secret
from the protected, main-only `source-prod-cron` GitHub environment. The legacy
repository-level `SOURCE_CRON_SECRET` remains only for the coordinated rotation
window and must be deleted after the protected credential is deployed and the
read-only auth check succeeds. The unrelated repository secret
`PACT_CRON_SECRET` is not part of this workflow or incident and must remain
untouched.

---

## Workflow: `source-scenarios.yml` — Scenario Golden Check

| Name | Schedule | AEST equivalent | Purpose | Owner | Alert path | Last-success check |
|---|---|---|---|---|---|---|
| **scenario-golden-check** | `0 6 * * 1` | 4:00 pm Monday | Runs `scenario_golden_check.py` against prod — verifies every scenario self-matches above the confidence floor, checks `appliesWhen` edges point at known topics, confirms `/scenarios` endpoint responds. Read-only; never seeds data (#1160 Round 4) | Source platform | Failure opens/updates a GitHub issue with title `[source-scenarios] Weekly golden check failed` | Open issues labelled `source,golden-check,auto-filed` |

---

## Workflow: `source-cve-scan.yml` — Weekly CVE Re-scan

| Name | Schedule | AEST equivalent | Purpose | Owner | Alert path | Last-success check |
|---|---|---|---|---|---|---|
| **source-cve-scan** | `0 14 * * 1` | 12:00 am Tuesday (midnight) | Runs `npm audit` against latest `main` and `trivy image` against latest pushed `source-web:latest` tag. Posts/updates a single tracking issue on CVSS-7+ findings. Surfaces CVE drift between deploys (WS6) | Source platform | Failure opens/updates a GitHub issue with prefix `[cve-scan] Source HIGH/CRITICAL findings` | Open issues labelled `cve-scan` |

---

## Workflow: `source-grocery-scrape.yml` — Grocery Price Scrape

| Name | Schedule | AEST equivalent | Purpose | Owner | Alert path | Last-success check |
|---|---|---|---|---|---|---|
| **source-grocery-scrape** | `0 */6 * * *` | Every 6 hours (12am, 6am, noon, 6pm) | Scrapes Coles and Woolworths grocery prices into `bestprice_db` (Source-side copy) via `sites/bestprice`. Default categories: `milk,bread,eggs,chicken,rice,pasta,cereal,coffee,cheese,butter` | BestPrice / Source platform | Failure opens/updates a GitHub issue labelled `scraper-alert,source` | Open issues labelled `scraper-alert` |

---

## Workflow: `source-fuel-scrape.yml` — Fuel Price Scrape

| Name | Schedule | AEST equivalent | Purpose | Owner | Alert path | Last-success check |
|---|---|---|---|---|---|---|
| **source-fuel-scrape** | `0 22 * * *` | 8:00 am daily | Scrapes fuel prices from QLD (qld-direct + petrolspy), NSW, and other AU sources into `SOURCE_DATABASE_URL` + `BESTPRICE_DATABASE_URL` via `sites/bestprice` | BestPrice / Source platform | Failure opens/updates a GitHub issue labelled `scraper-alert,source` | Open issues labelled `scraper-alert` |

> **Status: schedule wired, scraper build gated (#1401 Round A).**
> The cron trigger fires daily at 22:00 UTC. However, the `sites/bestprice`
> workspace build step (`npm run build -w @bestprice/db -w @bestprice/matching
> -w @bestprice/scrapers`) currently fails due to a workspace configuration
> issue tracked in handoff #1401 Round A. The schedule was added in WS10 so
> it is ready to run the moment Round A lands; it should not be removed — fix
> is Round A, not removing the trigger.
>
> The older `bestprice-fuel-scrape.yml` workflow is **permanently disabled**
> (`if: false` on the job body, schedule commented out) because its scraper
> was merged into `source-fuel-scrape.yml`. Do not re-enable it.

---

## Out-of-scope (cron routes without a workflow trigger)

One cron API route exists in `sites/source/src/app/api/cron/` that does not
have a corresponding scheduled workflow entry. It is documented here for
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
| **Fuel/grocery scraper product decisions** (#1401 Round E) | Knox-gated decisions about data licensing, retailer agreements, and scraping legality. Not safe to automate until those decisions are made. |
| **NSW legislation parser** (#1401 Round D) | Parser not yet built; NSW sync is therefore a manual gap, not a disabled cron. |
| **Axiom fact contribution** | Requires authenticated agent key and PACT consensus; no timer semantics. |
| **Schema migrations** | Run via `migrate-source.yml` (workflow_dispatch only) on schema change. Timer-based migration would be unsafe. |

---

## Monitoring reference

No centralised dashboard exists yet (WS-dash is Phase 3). Current monitoring
surface for each workflow:

1. **GitHub Actions UI** — `https://github.com/TailorAU/tailor-app/actions`
   — filter by workflow name for history.
2. **GitHub issue queue** — open issues labelled `scraper-alert`, `cve-scan`,
   or `golden-check` are auto-filed by failure handlers.
3. **Source health endpoint** — `GET https://source.tailor.au/api/health`
   returns `{ status, db, redis, checks }`. Does not surface cron state.
4. **Future** — once WS1 (App Insights) and WS-dash land, cron job success/
   failure will be tracked as custom metrics with alert rules for consecutive
   failures.

---

## Quick commands

```bash
# Prove cron authentication without mutating production data
gh workflow run cron-source.yml -f job=auth-check --ref main

# Trigger a specific maintenance cron manually (mutates production data)
gh workflow run cron-source.yml -f job=legislation-sync --ref main
gh workflow run cron-source.yml -f job=gtfs-sync --ref main
gh workflow run cron-source.yml -f job=all --ref main

# Check last 5 runs of the maintenance workflow
gh run list --workflow cron-source.yml --limit 5

# Check scenario golden check history
gh run list --workflow source-scenarios.yml --limit 5

# Check CVE scan history
gh run list --workflow source-cve-scan.yml --limit 5

# Trigger grocery scrape manually
gh workflow run source-grocery-scrape.yml

# Trigger fuel scrape manually (will fail until #1401 Round A ships)
gh workflow run source-fuel-scrape.yml
```
