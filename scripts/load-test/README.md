# Source — Load Test Scripts

> **Status:** Tier-1 baseline shipped 2026-04-26 (#1309, MEGA-80 WS8)
> **Audience:** Operators, performance engineers
> **SLA targets + cache strategy:** see [`docs/PERFORMANCE.md`](../../docs/PERFORMANCE.md)

---

## Scripts

| File | Purpose |
|---|---|
| `k6-baseline.js` | Ramping-VU baseline test against /api/health + /api/hub/stats + /api/axiom/legislation/search. Walks 0 → 250 VUs over ~3.5 min, asserts SLA thresholds. |

## Install k6

- macOS: `brew install k6`
- Windows: `choco install k6`
- Linux: see https://k6.io/docs/get-started/installation/

## Run

### Against prod (be careful)

Prod has Tier-1 SLA targets and live-customer traffic. Run baselines in low-traffic windows (AU evening/early morning) and start with a small VU count to be safe.

```bash
# Smoke (10 VUs for 30s, no ramp)
SOURCE_BASE_URL=https://source.tailor.au k6 run --vus 10 --duration 30s scripts/load-test/k6-baseline.js

# Full baseline (the script's default ramping scenario, ~3.5 min total)
SOURCE_BASE_URL=https://source.tailor.au k6 run scripts/load-test/k6-baseline.js
```

### Against dev

Dev is the safe place to push hard:

```bash
# Burst test
SOURCE_BASE_URL=https://source-dev.tailor.au k6 run --vus 500 --duration 60s scripts/load-test/k6-baseline.js
```

(Replace `source-dev.tailor.au` with the actual dev hostname from `cd-source.yml` if different.)

### Local

```bash
# In one terminal
cd sites/source && npm run dev   # serves on :4000

# In another
SOURCE_BASE_URL=http://localhost:4000 k6 run scripts/load-test/k6-baseline.js
```

## Reading the output

k6 prints a summary table at the end. The custom summary at the bottom groups latency by endpoint:

```
Source k6 baseline summary
==========================
Base URL:                https://source.tailor.au
Iterations:              4321
Error rate:              0.05%
http_req_failed:         0.05%

Per-endpoint latency (ms):
  /api/health                       min=12  med=24  p95=78  p99=145  max=412
  /api/hub/stats                    min=18  med=42  p95=180 p99=420  max=890
  /api/axiom/legislation/search     min=45  med=180 p95=890 p99=1820 max=4500

Thresholds:
  PASS  health_latency_ms                p(99)<500
  PASS  hub_stats_latency_ms             p(99)<800
  FAIL  legislation_search_latency_ms    p(99)<2000
```

A `FAIL` on a threshold means the SLA target was breached. Investigate before merging anything that might have caused regressions.

## Tier-1 SLA targets (from PERFORMANCE.md)

| Endpoint | p99 target | Today's posture |
|---|---|---|
| `/api/health` | < 500 ms | Should comfortably meet — cheap probe |
| `/api/hub/stats` | < 800 ms | Cached read-through; target met when cache is warm |
| `/api/axiom/legislation/search` | < 2000 ms | Uncached today; expected to meet for queries with selective filters; future cache work brings p99 down |
| Error rate | < 1% | All endpoints |

If a baseline run consistently breaches an SLA, file the regression alongside an investigation handoff. The breach is the trigger; the fix is a separate scoped piece of work.

## What this script does NOT do

- **Authenticated request load.** All requests are anonymous reads. To exercise rate-limiter + auth paths, add a separate authenticated-flow scenario.
- **Mutation load.** Writes (POST/PUT/DELETE) are not exercised. Source has stake-to-propose, review-duty gates, and PACT consensus thresholds — synthetic mutations would distort consensus state. Test mutations in a dedicated dev/staging environment.
- **Long-running runs.** The script's default ramp is ~3.5 minutes. For soak tests (running for hours), add a separate `k6-soak.js` script with a constant-VU stage.
- **Cache-cold simulation.** The script uses 8 rotating queries for legislation search — this means warm cache after the first ~10 requests per query. To test cold-cache behaviour, modify `SEARCH_QUERIES` to a much larger pool or use random terms.

These are documented as future enhancements; not blockers for Tier-1.

## CI integration (deferred)

A scheduled GitHub Actions job that runs `k6 run --quiet --vus 50 --duration 30s` against dev nightly is a useful follow-up. Output goes to a Slack channel (or App Insights once observability is wired). Not in scope for #1309; track as a future ops handoff if it becomes needed.
