# Source — Service Level Agreement

> **Status:** Best-effort SLA, pre-revenue. Targets reflect actual operational posture, not aspiration.
> **Audience:** Procurement reviewers, agents under contract, future paid-tier customers.

---

## Headline targets

| Metric | Target | Notes |
|---|---|---|
| Monthly uptime | **99.9% best-effort** | ~43 minutes allowed downtime per month. Best-effort while pre-revenue and single-operator; no service credits today. |
| Monthly error rate | < 1% across all endpoints | Measured as 5xx responses; 4xx is correct behaviour and excluded. |
| RTO (recovery time objective) | 1 hour | See `DISASTER_RECOVERY.md` (placeholder, produced by WS4). |
| RPO (recovery point objective) | 15 minutes | Postgres Flexible Server PITR window. |

These targets match those committed in [`PERFORMANCE.md`](PERFORMANCE.md)
§ Tier-1 SLA targets and [`TIER1.md`](TIER1.md) § OQ matrix.

## Latency targets — by surface

Measured at the origin (ACA ingress). API responses are not edge-cached;
Cloudflare transport, WAF, and proxying may improve network handling but
do not change the origin-measured latency SLA.

| Surface | p50 | p95 | p99 |
|---|---|---|---|
| `/api/health` | < 100 ms | < 250 ms | < 500 ms |
| `/api/hub/stats` (cache-warm, 30s TTL) | < 80 ms | < 300 ms | < 800 ms |
| `/api/axiom/legislation/search` | < 200 ms | < 1000 ms | < 2000 ms |
| `/api/scenarios/match` | < 250 ms | < 1500 ms | < 3000 ms |
| All authenticated mutations | < 300 ms | < 2000 ms | < 5000 ms |

The full latency budget breakdown — including which paths dominate the
budget at each percentile — is in [`PERFORMANCE.md`](PERFORMANCE.md). p99
on cache-cold first hits and on LLM-fallback scenario matches will exceed
target by design; both are bounded by external dependencies.

## Maintenance window

**Sunday 04:00 – 05:00 AEST** (Australian Eastern Standard Time, UTC+10
year-round; we do not observe AEDT for maintenance window purposes).

Within the maintenance window we may:

- Deploy non-rollback-friendly migrations (none are scheduled today; see
  WS8 for the migration extraction work that makes this safer).
- Perform Postgres major version upgrades.
- Cycle Azure Cache for Redis into a new instance class.
- Apply substrate-level config changes that briefly disrupt connections.

Maintenance-window downtime **does not count against the 99.9% target**.
Routine zero-downtime deploys via Azure Container Apps revisions happen
outside the window with no expected service impact.

If a maintenance event is anticipated to last more than 5 minutes within
the window, we will notify counterparties at least 48 hours in advance per
the channel agreed in their contract.

## Service credits

**Pre-revenue posture:** Source is best-effort. There are no service
credits today. If a Sev 1 / Sev 2 incident exceeds the SLA window per
[`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md), we owe you the
retrospective and the action items, not money.

When Source moves to a paid tier, this section will be revised to
publish a credit schedule. The current draft proposal is:

| Cumulative monthly downtime | Service credit |
|---|---|
| 43 min – 4 hours | 10% of monthly fee |
| 4 hours – 24 hours | 25% of monthly fee |
| > 24 hours | 50% of monthly fee |

This schedule is **not in force today**. It is published as our intent
when paid tiers ship so procurement reviewers can plan against it.

## What counts and does not count

**Counts as downtime:**

- `/api/health` returns non-200 from an AU IP for more than 60 seconds.
- A core endpoint (`/api/pact/*`, `/api/axiom/legislation*`,
  `/api/scenarios/match`, `/api/work/*`) returns 5xx for more than 5
  consecutive minutes from healthy ingress.
- Postgres or Redis are unreachable from prod ACA replicas for more than
  5 consecutive minutes.

**Does not count as downtime:**

- The published maintenance window.
- Force majeure (Microsoft Azure region-wide outage, DNS provider
  outage, undersea cable cuts).
- Customer-side issues (caller's network, caller's API key revoked).
- Rate-limit responses (429) — these are correct behaviour.
- Failures in optional observability surfaces (e.g. delayed Cloudflare
  security analytics when request proxying and the origin are healthy).
- LLM-fallback latency on `/api/scenarios/match` when Azure OpenAI is
  the dominating term.

## Measurement

Today, uptime is measured indirectly via:

- ACA platform metrics (revision health, replica count).
- Manual `/api/health` polls during incidents.
- The nightly `cron-source-smoke.yml` (post-#1401 Round B).

A formal external uptime monitor (UptimeRobot / Pingdom / App Insights
availability test) lands as Phase 1 WS-dash. Until that is wired, the
uptime number above is **best-effort, self-reported**, and not
contractually binding. We will not retroactively dispute uptime claims
made by a contracted counterparty's external monitor; if they say we were
down, we were down.

## Cross-references

- [`PERFORMANCE.md`](PERFORMANCE.md) — full latency targets, capacity estimates, investigation runbook
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — severity definitions, response SLAs
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — `/api/health` shape, log levels, where logs go
- [`SOVEREIGNTY.md`](SOVEREIGNTY.md) — substrate residency
- [`COMPLIANCE.md`](COMPLIANCE.md) — what we are and are not certified to
- `DISASTER_RECOVERY.md` (placeholder, WS4) — RTO / RPO procedure
