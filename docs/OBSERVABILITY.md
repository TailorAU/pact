# Source — Observability Runbook

> **Status:** Tier-1 baseline shipped 2026-04-26 (#1307, MEGA-80 WS3)
> **Audience:** Operators (Knox), agents debugging Source incidents

---

## What's shipped

1. **Structured JSON logger** at `src/lib/logger.ts`. Dependency-free, line-delimited JSON to stdout/stderr.
2. **`GET /api/health`** at `src/app/api/health/route.ts`. Probes DB + Redis, returns 200 / 503 with check details.
3. **Log-level convention** (this doc).
4. **Where logs go** documentation (this doc).

## What's deferred

The **OpenTelemetry SDK + App Insights wiring** is Knox-action. To activate:

1. Provision an App Insights workspace (Australia East, share with Tailor's existing instance if desired).
2. Add `APPLICATIONINSIGHTS_CONNECTION_STRING` to `cd-source.yml` env (line ~102 — same block as `DATABASE_URL`, `CRON_SECRET`).
3. Install `@vercel/otel` + `@azure/monitor-opentelemetry-exporter` (or equivalent) in `sites/source/package.json` and add an `instrumentation.ts` at the project root.
4. Source's logger already emits structured JSON; ACA + App Insights will pick up stdout automatically once the connection string is present. The trace correlation (`traceId`, `spanId` fields in log entries) follows once the OTel SDK is initialised.

The existing structured logger works without OTel. App Insights wiring is an enhancement, not a prerequisite for Tier-1.

## Logger API

```ts
import { log } from "@/lib/logger";

// Simple log line
log.info({ op: "pact.proposal.create", topicId, proposalId }, "proposal created");

// Error logging — pass the Error object as `err`; logger flattens name/message/stack/cause
try { ... } catch (err) {
  log.error({ err, op: "pact.proposal.create", topicId }, "failed to publish proposal");
}

// Bound child logger for a request
const reqLog = log.child({ requestId: crypto.randomUUID() });
reqLog.info({ op: "scenarios.match", predicateCount }, "matching scenarios");
```

### Levels

| Level | When to use |
|---|---|
| `trace` | Verbose internal — inputs/outputs of internal helpers. Off in prod by default. |
| `debug` | Diagnostic detail; used for slow queries, retries, fallback paths. Off in prod by default. |
| `info` | Successful operations of business value (proposal created, scenario matched, vote recorded). |
| `warn` | Recoverable degradation (Redis fallback to in-memory, slow Neon cold start, retry succeeded). |
| `error` | Operation failed; user / agent saw a 4xx/5xx. Always include `err`. |
| `fatal` | Process-level failure where the app can't recover (DB unreachable on startup). |

Default level is `info`. Override with the `LOG_LEVEL` env var (e.g. `LOG_LEVEL=debug` for an investigation).

### Log fields (conventions)

Always include where applicable:

- `op` — operation name in dot notation (`pact.proposal.create`, `axiom.legislation.search`, `scenarios.match`).
- `requestId` — UUID for the inbound request (use a child logger to bind).
- `actorKeyHash` — SHA-256 of the `x-source-agent-key`. **Never log raw API keys.**
- `actorLabel` — human-readable agent name if known (e.g. `agent_007`).
- `latencyMs` — operation latency for performance investigations.
- `entityType`, `entityId` — for mutations (e.g. `entityType: "proposal", entityId: "prop_xyz"`).
- `err` — the Error object on error paths.

PII / secret rules:

- Never log raw API keys, raw tokens, or full IPs.
- Hash actor keys with `crypto.createHash("sha256")` before logging.
- For IPs, log `ipCountry` (coarse only) — never the full address.
- Do not log raw request bodies for PACT registration, key issuance, or admin endpoints.

## Health endpoint

```bash
curl https://source.tailor.au/api/health
```

### Healthy response (200)

```json
{
  "status": "ok",
  "checks": {
    "db":    { "ok": true, "latencyMs": 24 },
    "redis": { "ok": true, "latencyMs": 41 }
  },
  "version": "abc1234",
  "region": "australiaeast",
  "latencyMs": 47
}
```

### Degraded response (503)

```json
{
  "status": "degraded",
  "checks": {
    "db":    { "ok": false, "latencyMs": 2003, "detail": "db probe timed out after 2000ms" },
    "redis": { "ok": true, "latencyMs": 38 }
  },
  "version": "abc1234",
  "region": "australiaeast",
  "latencyMs": 2041,
  "errors": ["db: db probe timed out after 2000ms"]
}
```

### Probe semantics

| Dependency | Probe | Failure mode |
|---|---|---|
| Postgres (Neon) | `SELECT 1 AS ok` via `getDb()` | 503; root causes: Neon paused / connection limit / network partition |
| Azure Cache for Redis (`source-redis-prod`, `australiaeast`) | `SET health:probe:<pid> "1" EX 5` via shared `lib/redis-client.ts` singleton (node-redis v4, RESP+TLS port 6380) | 503 if env vars present and write fails. If `AZURE_REDIS_HOSTNAME`/`AZURE_REDIS_PASSWORD` are absent, returns OK with `detail: "fallback-in-memory"` (Source's rate-limit has an in-memory fallback — see `src/lib/rate-limit.ts`). Post-WS0b cutover: probe latency typically ~3ms in-region. |

Each probe has a 2-second timeout. The endpoint itself has no auth — keep it cheap and ensure no PII / secrets leak in the response.

### When to use it

- ACA readiness probe (configure in `cd-source.yml` ACA template if not already).
- External uptime monitor (UptimeRobot, Pingdom).
- Agent diagnostics (e.g. an agent hitting 5xx can `curl /api/health` to check whether the issue is widespread).
- Pre-flight before running smoke tests against a fresh deploy.

## Where logs go in production

| Surface | Today | After App Insights wiring |
|---|---|---|
| stdout / stderr | Captured by ACA's log driver | Captured by ACA + forwarded to App Insights |
| Live tail | `az containerapp logs show --name <source-aca> --resource-group rg-source-prod --type system --tail 200 --follow` | Same, plus App Insights live-stream |
| Historical | ACA log retention (~30 days default) | App Insights query (KQL via `az monitor app-insights query`) |
| Search | Limited (free-text in `az containerapp logs show`) | KQL: `traces \| where customDimensions.op == "pact.proposal.create"` |
| Alerting | None | App Insights alert rules on log queries |

Until App Insights is wired, agents and operators read logs via:

```bash
# Last 200 lines from the running prod replica
az containerapp logs show --name <source-aca-name> --resource-group rg-source-prod --type system --tail 200

# Live tail
az containerapp logs show --name <source-aca-name> --resource-group rg-source-prod --type system --follow
```

(Replace `<source-aca-name>` with the actual ACA name from `cd-source.yml` outputs.)

## Adoption guide

The new logger is shipped alongside the existing 22 `console.log/error` call sites. Migration is incremental:

1. **New code** uses `log.info(...)` / `log.error(...)` from day one. No new `console.*` calls.
2. **High-value existing call sites** (security-sensitive paths, error handlers, auth) migrate first as touched by other tickets.
3. **Bulk migration** of the 22 existing `console.*` sites is a separate small handoff (effort: S, ~half a day).

## Verification

After deploy, verify the surface is live:

```bash
# Health endpoint returns 200 with the expected shape
curl -s https://source.tailor.au/api/health | jq .

# A request that triggers logging (e.g. a public read with rate-limit miss)
# should produce a JSON log line in ACA logs
curl -s https://source.tailor.au/api/hub/stats > /dev/null
az containerapp logs show --name <source-aca-name> --resource-group rg-source-prod --type system --tail 5
```

Look for line-delimited JSON entries with `service: "source"` and a recent `time`.

## Known limitations / follow-ups

- **No `console.*` migration yet.** The 22 existing sites still use `console.log/error`. Tracked as a follow-up handoff.
- **No request-ID middleware.** Each route handler that wants `requestId` must mint one and pass it via `log.child(...)`. A Next.js middleware that sets `x-request-id` and propagates is a follow-up.
- **No OTel SDK.** App Insights wiring is Knox-action (provision + connection string) plus a small follow-up handoff to install `@vercel/otel` and add `instrumentation.ts`.
- **No PII redaction enforcement.** The logger trusts callers to follow conventions. A redaction wrapper (similar to pino's `redact` config) is a follow-up if PII leaks become a concern.

These are documented as small follow-on items; none block Tier-1 readiness.
