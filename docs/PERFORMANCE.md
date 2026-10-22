# Source — Performance, Caching, CDN Strategy

> **Status:** Tier-1 baseline shipped 2026-04-26 (#1309, MEGA-80 WS8)
> **Audience:** Operators, performance engineers, agents debugging slow paths

---

## Tier-1 SLA targets

| Surface | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| `/api/health` | < 100 ms | < 250 ms | < 500 ms | Cheap probe; DB+Redis ping with 2s timeout per probe |
| `/api/hub/stats` | < 80 ms | < 300 ms | < 800 ms | Cached read-through (30s TTL); cache-cold p99 will exceed target on first hit |
| `/api/axiom/legislation/search` | < 200 ms | < 1000 ms | < 2000 ms | Uncached today; future cache work brings p99 down |
| `/api/scenarios/match` | < 250 ms | < 1500 ms | < 3000 ms | Predicate scoring + LLM fallback; LLM path is variance-bounded |
| All authenticated mutations | < 300 ms | < 2000 ms | < 5000 ms | Includes rate-limit + DB writes + audit-log + emit-event chain |

| Other targets | Value |
|---|---|
| Uptime | 99.9% (~43 min/month allowed downtime) |
| Error rate | < 1% across all endpoints |
| RTO (recovery time objective) | 1 hour |
| RPO (recovery point objective) | 15 min (Neon PITR window) |

These targets match the OQ8 default Knox set in TIER1.md §6 OQ matrix and align with what ACA's default replica posture (1 min, 3 max) can support.

## What's shipped (Tier-1 baseline)

### Cache layer — `src/lib/cache.ts`

Read-through Redis cache via the shared `src/lib/redis-client.ts` async-singleton factory (node-redis v4, RESP+TLS to Azure Cache for Redis `source-redis-prod` in `australiaeast`). Reuses the same fallback pattern as `src/lib/rate-limit.ts` — when Redis is unavailable, the cache helper falls through to direct fetch.

- `cache.getOrSet(key, ttlSec, fetchFn)` — main API. Returns cached if present, else calls fetchFn, stores, and returns.
- `cache.del(key)` — best-effort invalidation. Used by mutation routes that write through.
- `cache.paramsKey(prefix, params)` — deterministic cache-key builder from sorted params.
- All operations: best-effort (try/catch + log warn + fall through). Cache failures cannot break the underlying operation.

### Cached endpoints (round 1)

| Endpoint | Cache key | TTL | Why |
|---|---|---|---|
| `GET /api/hub/stats` | `hub:stats:v1` | 30 s | Homepage hero traffic; data refresh cadence is dominated by infrequent topic/proposal/legislation events. 30s lag is invisible to end users. |

### Cache invalidation strategy

- **TTL-based.** Entries expire on schedule, no explicit invalidation needed for most cases.
- **Bump version suffix.** When the cached value's shape changes, change the key from `:v1` to `:v2`. Old keys age out via TTL.
- **Explicit `cache.del(key)`.** Used sparingly in mutation paths that must invalidate a specific known key. None applied yet — the cached endpoints today don't have low-latency invalidation requirements.

## What's deferred (follow-ons, none block Tier-1)

### Cache round 2 — search

- `GET /api/axiom/legislation/search` — uncached today. Wrapping requires extracting ~280 lines of search logic into a thunk for `cache.getOrSet`. Large mechanical edit; lands as a separate handoff (M, ~1 day) when the latency on this endpoint becomes a measurable hot spot.
- `GET /api/scenarios/match` — similar shape; defer to the same round 2.

### CDN strategy — API cache fail-closed

Tier-1 is achievable from ACA without edge response caching (ACA + Azure Postgres Flexible Server + Azure Cache for Redis are all low-latency in `australiaeast`; verified 3ms Redis probe + 52ms DB probe via `/api/health`). Cloudflare can still provide:

- DDoS absorption layer.
- TLS termination + HTTP/3 + compression at the edge.
- Origin proxying and WAF enforcement.

All `/api/*` responses now carry origin, generic-CDN, and
Cloudflare-specific no-store controls from `next.config.ts`. This is a
deliberate default-deny policy: even unauthenticated legislation and
health reads remain uncacheable until an audited allowlist is approved.

Required edge posture:

1. Bypass cache for all `/api/*` paths, regardless of method or apparent public status.
2. Respect the origin's three no-store headers.
3. Continue using Cloudflare WAF, DDoS protection, and origin proxying.
4. Cache only content-addressed/static assets under their existing policies.
5. Introduce an API allowlist only with route-level data/auth review, matching edge rules, and production-shape tests.

The internal Redis read-through cache is unaffected; it remains
server-side in `australiaeast` and currently caches only reviewed public
hub statistics.

### Load-test CI integration

A nightly k6 baseline against dev is a useful follow-up — see `scripts/load-test/README.md` § "CI integration (deferred)". Not in scope for #1309.

### Database connection pooling

Source uses `pg.Pool` directly (`src/lib/db.ts:25`). Default pool size; not tuned for load. If load tests reveal connection contention under burst, the pool config should be raised and Neon's connection limit verified. Not currently a hot spot.

## Capacity estimates

ACA config from `cd-source.yml:127`: **min 1, max 3 replicas**, 0.5 CPU, 1 Gi memory each. Per-replica capacity guidance:

| Workload | Per-replica RPS | 3-replica RPS |
|---|---|---|
| Cached reads (`/api/hub/stats` cache-warm) | ~500 RPS | ~1500 RPS |
| Uncached reads (`/api/axiom/legislation/search`) | ~50–80 RPS | ~150–250 RPS |
| Authenticated mutations (rate-limited at 30/min/agent) | bounded by agent count, not replica capacity | — |

These are estimates — confirm via `k6-baseline.js` runs against dev or a staging tier. If demand exceeds 3-replica capacity, raise `--max-replicas` in `cd-source.yml` (cheap; ACA only bills for replicas in use) and revisit the pool config.

## Database — Neon serverless

- Region: Australia East (matches ACA region — no cross-region latency).
- Compute autoscale: managed by Neon; cold start can add 200–500 ms on the first request after idle. Subsequent requests are sub-50ms typically.
- Connection limit: default Neon project quota; should be re-verified if connection-pool exhaustion shows up in errors.
- PITR (point-in-time recovery): Neon-managed, in-region, RPO matches the SLA target of 15 min.

## Redis — Azure Cache for Redis

- Region: `australiaeast` (verified). Instance: `source-redis-prod`, Basic C0 (250MB), Redis 6.0, SSL-only port 6380. Provisioned 2026-04-26 as part of #1310 / MEGA-80 WS0b migration; Upstash retired pending T+7 day soak.
- Post-cutover `/api/health` Redis probe latency: **~3 ms** (was ~633ms with Upstash cross-region).
- Used for: rate-limit (sliding window), cache layer (read-through), health-check probe.
- Failure mode: in-memory fallback for rate-limit, no-op fallback for cache. Health endpoint reports `detail: "fallback-in-memory"` when env vars absent.

## Investigation runbook

When latency regresses or load tests fail:

1. Check `/api/health` — confirms DB + Redis are reachable and within probe-timeout.
2. Look at logs (per `OBSERVABILITY.md`) — search for `latencyMs` fields above SLA targets.
3. Check ACA replica count — `az containerapp revision list` — is autoscale lagging demand?
4. Check Neon dashboard — connection-pool exhaustion? Slow query log?
5. Check Azure Cache for Redis metrics in Azure Portal — `source-redis-prod` → Monitoring → Metrics; cache misses, used memory, server load, connected clients.
6. Run `k6-baseline.js` against the affected environment to characterise the regression.
7. File a regression handoff with the failing thresholds + a hypothesis.

## Known limitations / follow-ups

- **Cache round 2 (search endpoints) deferred** — see above.
- **CDN deferred** — Knox-action.
- **Load-test CI integration deferred** — manual runs only.
- **Connection pool config not tuned** — defaults; revisit if needed.
- **No per-tenant performance accounting** — under OQ1a = (a) Source stays public-only; tenant-attributed perf metering happens in Tailor's data plane.
