# Source — Incident Response

> **Status:** Procurement-grade baseline. Single-operator reality, no on-call rotation yet.
> **Audience:** Knox (operator), procurement reviewers, agents whose service has degraded.

---

## Severity definitions

We use four severity levels. The level determines the response SLA, the
paging path, and the post-incident artefacts.

| Sev | Definition | Examples |
|---|---|---|
| **Sev 1 — Down** | Production is unreachable or returning 5xx for the majority of requests. The product is unusable for the majority of authenticated agents. | `source.tailor.au` returns 502/503 from any AU IP; database unreachable; ACA all replicas unhealthy; Cloudflare origin error if the edge is wired. |
| **Sev 2 — Degraded** | Production responds, but a major surface is broken or substantially slow. Some users / agents are affected; others are not. | `/api/scenarios/match` returns 5xx but legislation reads are fine; Redis fallback engaged and rate-limit drops to 10% of normal; p95 latency > 4× SLA target on a single endpoint. |
| **Sev 3 — Isolated bug** | A single endpoint, query path, or data slice is broken. Most users / agents are unaffected. The product is functioning. | One legislation parser silently returning zero rows (per [`OBSERVABILITY.md`](OBSERVABILITY.md) warn signal); a specific scenario predicate scores incorrectly; a stale cache entry persists past TTL. |
| **Sev 4 — Advisory** | A finding has been raised that is not currently affecting users but warrants action. Includes security findings under [`SECURITY.md`](SECURITY.md) below CVSS 7.0. | A new High-severity CVE landed in a transitive dependency; a known bug in a deferred follow-on; an external monitor flagged a non-fatal anomaly. |

A finding can move between severities as more information comes in. The
acting operator records the level at first observation and at every
transition.

## Response SLAs

| Sev | First response | Initial mitigation | Resolution target |
|---|---|---|---|
| Sev 1 | 4 hours from detection | 8 hours | 24 hours |
| Sev 2 | 4 hours from detection | 24 hours | 72 hours |
| Sev 3 | 24 hours | Next business day | Within 14 days |
| Sev 4 | 72 hours | Triaged in next sprint | Per [`SECURITY.md`](SECURITY.md) fix-SLA matrix |

"First response" = the operator has acknowledged the incident in writing
(GitHub issue, email, or status update). It does not mean a fix is in
flight; it means the clock has started.

These SLAs are **best-effort** while Source is pre-revenue and
single-operator. They are tighter than what most pre-revenue products
publish, and they reflect our actual operational posture (Knox is the
on-call). When Source moves to a paid tier we will revisit and likely
tighten Sev 1.

## Detection — how an incident gets observed

Today, in order of speed:

1. **Synthetic monitor / health check** — `/api/health` is the cheapest
   probe; see [`OBSERVABILITY.md`](OBSERVABILITY.md) § Health endpoint.
   Until an external uptime monitor is wired (Pingdom / UptimeRobot /
   App Insights availability test), detection depends on the next
   observer in line.
2. **External report** — an agent or Knox notices an anomaly and writes
   to `security@tailor.au` or files a GitHub issue.
3. **Operator-initiated** — Knox sees something during routine ops review
   (logs, dashboards, freshness endpoint per #1401, deploy outcome).
4. **Daily smoke** — the nightly `cron-source-smoke.yml` (post-#1401)
   surfaces drift before users do.

The detection-to-acknowledgement gap is the variable we will close hardest
once App Insights alerting is wired (WS-dash in the production-readiness
plan).

## Paging path

**Honest reality:** there is one operator. The paging path is **Knox's
phone**, reachable via the channels he has chosen to publish privately.
There is no rotation, no secondary, and no automated paging system today.

| Surface | Path | Notes |
|---|---|---|
| Sev 1 / Sev 2 | Email `security@tailor.au` + a phone call to the number Knox has shared with the contracting party | Phone number is not published publicly; it is shared with named procurement counterparties on contract signing. |
| Sev 3 | Email `security@tailor.au`, or open a GitHub issue with the `incident` label | Knox triages within the response SLA. |
| Sev 4 | GitHub issue, or for security findings see [`SECURITY.md`](SECURITY.md) | Routine queue. |

When an automated paging system is wired (App Insights alert rule + Azure
Action Group → SMS), we will publish that path here. Until then the
**phone-call-to-Knox** path is the published reality. We are not pretending
to have an on-call rotation we do not have.

## Response playbook

When an incident is acknowledged, the acting operator (Knox today) follows
this loop:

1. **Confirm and classify.** Reproduce the symptom from a clean machine if
   possible. Hit `/api/health` from an AU IP. Pull recent logs via
   `az containerapp logs show ...` (see [`OBSERVABILITY.md`](OBSERVABILITY.md)).
   Assign a severity.
2. **Stop further damage.** If the failure is on a deploy, roll back per
   `RUNBOOK_ROLLBACK.md` (placeholder; produced by WS6b). If the failure is
   on data, freeze writes via the relevant feature flag or admin gate. If
   the failure is on a single endpoint, consider taking it offline behind
   a 503 returner while the underlying issue is fixed.
3. **Restore service.** The fastest viable path. Rollback before forward-fix
   when both are available; correctness over completeness.
4. **Communicate.** Post status to the affected counterparty (procurement
   contact, agent, or public if widespread). Use the customer-comms template
   below.
5. **Investigate root cause.** After service is restored, not before. Pull
   trace IDs (`requestId`), audit log entries (see [`AUDIT.md`](AUDIT.md)),
   and any cross-system correlations.
6. **Write the retrospective.** Within 7 days of resolution for Sev 1/2;
   within 14 days for Sev 3.
7. **File follow-ups.** Every retrospective produces at least one
   "what would have caught this earlier" item, filed as a Requirement or a
   small handoff.

## Customer communications template

Use this template for the counterparty notification. Adapt to channel
(email / status page / GitHub issue) but keep all sections.

```
Subject: [Source] Incident sev-{N} — {one-line title}

Status: {investigating | mitigated | resolved}
Severity: {1 | 2 | 3 | 4}
First observed: {ISO timestamp UTC}
Affects: {endpoints / surfaces / agent groups}

What happened:
{Two sentences. Plain language. No jargon.}

Current impact:
{What can users / agents do right now? What is broken?}

What we are doing:
{Specific next action and ETA. If unsure, say so.}

What we will not do:
{Anything we have ruled out — e.g. "no data loss; no cross-tenant exposure."}

Next update: {ISO timestamp, no later than the SLA window for this severity}

Knox / Source
```

For Sev 1/2, the **Next update** field must contain a hard timestamp. For
Sev 3/4 a calendar day is sufficient.

## Retrospective template

Within the timebox above, the operator writes a retrospective to
`docs/operations/incidents/{YYYY-MM-DD}-{slug}.md`. The directory does not
exist yet — the first incident creates it.

```
# Incident — {title}

- Severity: {1-4}
- Detected: {ISO}
- Acknowledged: {ISO}
- Mitigated: {ISO}
- Resolved: {ISO}
- Time-to-detect: {duration}
- Time-to-mitigate: {duration}
- Time-to-resolve: {duration}

## Summary

{Two paragraphs. What happened, what was the impact, what fixed it.}

## Timeline

{ISO bullet log of every observation, action, and decision.}

## Root cause

{Five-whys. Stop when you hit something that is not actionable —
"because the substrate is in another universe" is not a root cause;
"because we did not have a synthetic monitor on this surface" is.}

## What worked

{Things that already existed that helped. Reinforce these.}

## What did not work

{Things that hurt or slowed us down. Each becomes an action.}

## Action items

| ID | Action | Owner | Issue |
|---|---|---|---|
| 1 | {imperative} | {person} | #{issue} |

## Lessons

{One paragraph. The single thing we want every future operator to take from this.}
```

We do not name-and-shame in retrospectives. We name systems, not people.

## Cross-references

- [`SECURITY.md`](SECURITY.md) — vulnerability reporting, fix SLAs by severity
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — log levels, health endpoint, where logs go
- [`AUDIT.md`](AUDIT.md) — audit log schema for forensic review
- `RUNBOOK_ROLLBACK.md` — deploy rollback procedure (produced by WS6b)
- [`COMPLIANCE.md`](COMPLIANCE.md) — what we are and are not certified to
- [`SLA.md`](SLA.md) — uptime targets, maintenance windows, credit policy
