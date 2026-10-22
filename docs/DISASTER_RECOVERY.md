# Source — Disaster Recovery Runbook

> **Status:** Procurement-grade baseline. Knox-action items are called out inline.
> Targets align with [`PERFORMANCE.md`](PERFORMANCE.md) § Tier-1 SLA targets.
> **Audience:** Knox (operator), procurement reviewers, incident commanders.
> **Last reviewed:** 2026-05-09

---

## 1. RTO / RPO targets

| Objective | Target | Basis |
|---|---|---|
| **RTO** — Recovery Time Objective | **1 hour** | Time from confirmed outage to production traffic restored. Consistent with `PERFORMANCE.md` SLA targets and Azure Container Apps restart-and-redeploy times. |
| **RPO** — Recovery Point Objective | **15 minutes** | Azure Database for PostgreSQL Flexible Server PITR (point-in-time recovery) creates a continuous WAL backup stream; the effective RPO is the transaction log flush interval, documented by Azure as typically sub-5 minutes, with a **restore window of up to the last 7 days** (see Knox-action below). |

> **Knox-action (PITR retention):** Verify and, if required, raise the PITR
> retention window from the Azure default (7 days) to the recommended 14 days
> for procurement accounts. Set via:
> ```bash
> az postgres flexible-server update \
>   --name source-pg-prod \
>   --resource-group rg-source-prod \
>   --backup-retention 14
> ```
> Until Knox confirms the setting in the Azure portal, the documented window
> is "7 days (default); recommend 14 days."

---

## 2. Substrate posture

All three Source substrates are in Azure `australiaeast`. There is no
cross-region replication of customer data. See [`SOVEREIGNTY.md`](SOVEREIGNTY.md)
for the full residency table and sovereignty commitment.

| Substrate | Resource | SKU | Region | DR posture |
|---|---|---|---|---|
| **Compute** | Azure Container Apps `source-web-prod` in `source-env-prod` / `rg-source-prod` | 0.5 CPU / 1 Gi, 1 min → 3 max replicas | `australiaeast` | Stateless. ACA restarts failed replicas automatically. On full region outage: see § Region-level outage. |
| **Database** | Azure Database for PostgreSQL Flexible Server `source-pg-prod` | Standard_B1ms, PG 16, `sslmode=require` | `australiaeast` | PITR enabled (continuous WAL backup). Restorable to any point in the retention window via `az postgres flexible-server restore`. |
| **Cache** | Azure Cache for Redis `source-redis-prod` | Basic C0, 250 MB, Redis 6.0, SSL port 6380 | `australiaeast` | **No persistence.** Cache is non-canonical — rate-limit state and read-through values rebuild from cold on cache miss. In-memory fallback activates automatically. No data loss risk; only transient performance degradation. |

**Redis is non-canonical.** This is a design decision documented in
[`PERFORMANCE.md`](PERFORMANCE.md) § Redis — Azure Cache for Redis. A Redis
failure or restart results in a brief p99 latency spike and a temporary drop
in rate-limit precision, not data loss. No Redis-specific restore procedure
is required.

---

## 3. Recovery procedures

### 3.1 Postgres point-in-time restore

Use when the primary Postgres server (`source-pg-prod`) is corrupted, deleted,
or returns a data-integrity error that is confirmed at the DB level.

**Decision gate:** confirm data integrity issue before initiating PITR. A
bad deploy that corrupts application state is a code rollback (§ 3.2), not a
PITR event. PITR is for genuine database-level corruption or accidental DML.

**Step 1 — Identify the restore point.**

The restore point must be before the corruption event. Confirm via the audit
log (`GET /api/admin/audit?...` with `X-Admin-Key`) and `az postgres
flexible-server show-connection-string` / logs. Restore times are in UTC.

```bash
# List PITR options (verify the earliest restorable time)
az postgres flexible-server show \
  --name source-pg-prod \
  --resource-group rg-source-prod \
  --query "{earliestRestoreDate:properties.earliestRestoreDate, \
            backupRetentionDays:properties.backup.backupRetentionDays}"
```

**Step 2 — Restore to a new server (do not restore in-place).**

Azure PITR creates a new server. The original server can remain running
during the restore.

```bash
az postgres flexible-server restore \
  --name source-pg-prod-restored \
  --resource-group rg-source-prod \
  --source-server source-pg-prod \
  --restore-time "2026-05-08T14:30:00Z"
```

The restore operation typically takes 10–30 minutes for a Standard_B1ms
server depending on database size.

**Step 3 — Validate the restored server.**

Connect to `source-pg-prod-restored` and verify row counts, audit log
continuity, and legislation content before cutting over.

```bash
psql "host=source-pg-prod-restored.postgres.database.azure.com \
      dbname=postgres user=sourceadmin sslmode=require" \
  -c "SELECT COUNT(*) FROM audit_log; SELECT MAX(synced_at) FROM legislation_docs;"
```

**Step 4 — Swap the connection string and redeploy.**

```bash
# Update the production secret
az containerapp secret set \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --secrets "pg-connection-string=postgres://REDACTED:REDACTED@source-pg-prod-restored.postgres.database.azure.com/postgres?sslmode=require"

# Update env var to reference the new secret
az containerapp update \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --set-env-vars "DATABASE_URL=secretref:pg-connection-string"
```

**Step 5 — Verify and rename.**

Confirm `/api/health` returns 200 with sub-100ms DB probe. Once validated,
rename `source-pg-prod-restored` to `source-pg-prod` if a persistent rename
is desired — or leave as-is and update the hostname reference in GH secrets.

```bash
# Update PG_HOST GitHub secret to point to restored server
gh secret set PG_HOST --body "source-pg-prod-restored.postgres.database.azure.com" \
  --repo TailorAU/tailor-app
```

Re-deploy via `cd-source.yml` to pick up the updated secret:

```bash
gh workflow run cd-source.yml --ref main --repo TailorAU/tailor-app
```

---

### 3.2 ACA revision rollback (bad deploy)

Use when the most recent deploy introduced a regression. This is the
**most common recovery scenario.** See [`RUNBOOK_ROLLBACK.md`](RUNBOOK_ROLLBACK.md)
for the decision tree and the complete rollback procedure.

Summary command:

```bash
az containerapp revision set-mode \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --mode single

az containerapp revision set-active \
  --revision <previous-revision-name> \
  --name source-web-prod \
  --resource-group rg-source-prod
```

---

### 3.3 Full re-seed from cold (compute + DB both lost)

Use only when both the compute layer and the database have been deleted or are
permanently unrecoverable. This is the worst-case scenario and requires
Knox-hands-on time. Estimated time: 2–4 hours.

**Step 1 — Re-deploy the application.**

The application image and deploy config are in git and the GitHub Actions
workflow. A fresh ACA environment can be provisioned and the app deployed
from the last good commit:

```bash
gh workflow run cd-source.yml --ref main --repo TailorAU/tailor-app
```

If the ACA environment itself (`source-env-prod`) is also gone, it must be
re-provisioned via the Bicep templates in `infra/` before the workflow can
succeed.

**Step 2 — Restore the database.**

If a PITR backup exists, use § 3.1. If no PITR backup exists (e.g. the Azure
subscription itself was deleted), the database must be rebuilt from seed
scripts. **The PITR window is the backstop; PITR loss is the recovery worst
case.**

**Step 3 — Run seed scripts.**

From `sites/source/scripts/`, against the freshly provisioned environment:

```bash
# Scenario and legislation seeds (idempotent)
export BASE=https://source.tailor.au
python seed_institutional.py
python seed_defence_au.py
python seed_defence_us.py
python seed_critical_minerals.py
python seed_topic_dependencies.py   # run last — depends on IDs from above

# Legislation re-ingest (requires ADMIN_SECRET)
# Trigger the cron endpoint directly or wait for the weekly schedule
curl -X POST https://source.tailor.au/api/cron/legislation-sync \
  -H "Authorization: Bearer $CRON_SECRET"
```

Agent identities, PACT proposals, votes, and audit logs are not
seed-recoverable without the database PITR backup. The seed scripts restore
the public knowledge graph; agent-credit ledger and audit history require
PITR.

**Step 4 — Verify.**

```bash
curl -s https://source.tailor.au/api/health | jq '.status, .checks'
curl -s https://source.tailor.au/api/hub/stats | jq '.topicCount'
```

---

### 3.4 Region-level outage (`australiaeast` down)

Source's **Tier-2 accepted posture** for an `australiaeast` Azure regional
outage is: **wait for region recovery.** There is no multi-region failover
today. This is an honest statement, not an oversight.

**Rationale:**

- Source's data sovereignty commitment is `australiaeast`-only. A failover to
  `australiasoutheast` or another region would require the database to
  replicate cross-region, which we explicitly do not do per
  [`SOVEREIGNTY.md`](SOVEREIGNTY.md).
- Azure regional outages affecting `australiaeast` are rare historical events.
  The PITR backup stream and ACA container image are sufficient for recovery
  once the region is restored.
- Multi-region failover is available as a per-contract enhancement for
  counterparties whose SLA requires it. That would land as a separate
  Requirement and ADR.

**On region recovery:**

1. ACA typically recovers replicas automatically when the region comes back.
2. If ACA does not self-recover, redeploy: `gh workflow run cd-source.yml --ref main`.
3. Verify `/api/health` returns 200 before declaring recovery complete.

**During an outage:** notify affected counterparties per the customer-comms
template in [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md). A Sev 1 regional
outage triggers the Sev 1 response SLA (4-hour first response, 8-hour
initial mitigation target — noting "mitigation" in a regional outage means
"status communicated and recovery monitored," not an independent restore,
unless Azure fails to recover within the SLA window).

---

## 4. Restore-test cadence

A documented runbook that has never been executed is a theoretical runbook.
Source commits to a **quarterly restore test** cadence:

| Q | Scheduled test | What is tested |
|---|---|---|
| Q3 2026 | First test (Knox-action to schedule) | PITR restore of `source-pg-prod` to a new server, validate row counts, confirm restore time is within RTO. Decommission the test server after validation. |
| Q4 2026 and beyond | Quarterly | Rotate between (a) PITR validation and (b) ACA rollback drill — so both procedures stay current. |

> **Knox-action:** Schedule the Q3 2026 restore test in Knox's calendar, ideally
> in a low-traffic window (weekday 02:00–05:00 AEST). Create a GitHub issue
> with the `incident` label titled "Restore test Q3 2026 — PITR drill" as the
> tracking artefact. After the test, document the actual restore time (target:
> ≤ 1 hour) as a comment on the issue before closing.

The test must not use the production ACA environment or expose the restored
server to production traffic. Create and destroy the test server in the same
calendar window.

---

## 5. Recovery decision tree (quick reference)

```
Incident detected
        │
        ▼
  Is it a bad deploy?
        │
   Yes──┤──── No ────► Is it a data-integrity issue?
        │                        │
        ▼                    Yes─┤──── No ──► Is the region down?
  RUNBOOK_ROLLBACK.md            │                    │
  (ACA revision rollback)         │                    ▼
                                  │          Wait for Azure region recovery.
                                  ▼          Monitor status.azure.com.
                            § 3.1 PITR restore
                            (Postgres PITR → swap connection string)
```

---

## 6. Cross-references

- [`RUNBOOK_ROLLBACK.md`](RUNBOOK_ROLLBACK.md) — deploy rollback procedure and decision tree
- [`SECURITY.md`](SECURITY.md) — vulnerability disclosure; security-incident scope
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — severity definitions, response SLAs, customer-comms template
- [`COMPLIANCE.md`](COMPLIANCE.md) — IRAP-equivalent control mapping, backup and recovery entry
- [`SOVEREIGNTY.md`](SOVEREIGNTY.md) — why no cross-region replication; substrate residency table
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — `/api/health` contract; log access commands
- [`PERFORMANCE.md`](PERFORMANCE.md) — RTO/RPO values originate in this doc's SLA table
- [`TIER1.md`](TIER1.md) — substrate migration history; why Azure Postgres Flexible Server is the DB (not Neon)

> **Note:** `PERFORMANCE.md` § "Database — Neon serverless" (lines 97–104)
> is a stale section that pre-dates the WS0b substrate audit on 2026-04-26.
> The actual database is **Azure Database for PostgreSQL Flexible Server**
> (`source-pg-prod`), confirmed by `az postgres flexible-server show` and
> documented in `TIER1.md` §13. The Neon section in `PERFORMANCE.md`
> should be updated to reflect this (Knox-action / separate PR).
