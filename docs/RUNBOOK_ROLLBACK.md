# Source — Deploy Rollback Runbook

> **Status:** Procurement-grade baseline.
> **Audience:** Knox (operator), on-call responder.
> **Last reviewed:** 2026-05-09

---

## 1. Decision tree — roll back or roll forward?

Use this tree when a deploy produces anomalies. **When in doubt, roll back
first and investigate after service is restored.**

```
Deploy completed or anomaly detected
              │
              ▼
      5xx error rate > 1%
      over a 5-minute window?
              │
        Yes ──┤── No ──► /api/health degraded
              │          (non-200 or probe latency
              │           > 4× SLA target)
              │          for > 3 consecutive minutes?
              ▼                      │
       ROLL BACK               Yes ──┤── No ──► One-off 5xx or
       (§ 2 below)                   │          transient spike?
                               ROLL BACK             │
                               (§ 2 below)           ▼
                                              Monitor for 5 min.
                                              If stable: roll forward.
                                              If escalates: roll back.
```

**Roll-forward conditions (do NOT roll back):**
- A single known-bad request against a specific known-bad input (not a
  pattern of errors).
- A trailing test failure in a non-production path that is already tracked as
  a known issue.
- A feature flag is on and the error only affects users with that flag.

**Manual override:** Knox can trigger a rollback at any point regardless of
the thresholds above. The decision tree is a guide for autonomous operators;
a human override supersedes it.

---

## 2. Rollback procedure

### Step 1 — Identify the last good revision

Azure Container Apps tracks every deploy as a numbered revision. List the
recent revisions and find the one before the bad deploy:

```bash
az containerapp revision list \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --query "[].{name:name, active:properties.active, \
              created:properties.createdTime, \
              traffic:properties.trafficWeight}" \
  --output table
```

The output shows each revision with its creation timestamp and whether it is
currently active. The revision immediately before the current active one is
the rollback target.

If you know the previous deploy SHA (from the GitHub Actions `cd-source.yml`
run history), you can confirm it matches the revision name.

### Step 2 — Set single-revision mode (required before activating)

ACA must be in single-revision mode to fully activate a previous revision:

```bash
az containerapp revision set-mode \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --mode single
```

### Step 3 — Activate the previous revision

```bash
az containerapp revision set-active \
  --revision <previous-revision-name> \
  --name source-web-prod \
  --resource-group rg-source-prod
```

This immediately routes 100% of traffic to the previous revision.

### Step 4 — Verify

```bash
# Health check — must return 200 with db + redis checks green
curl -s https://source.tailor.au/api/health | jq '.status, .checks'

# Confirm the active revision matches the expected SHA
az containerapp revision show \
  --revision <previous-revision-name> \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --query "properties.runningState"
```

A green `/api/health` response and `runningState: Running` confirm the rollback
is in effect.

**Expected post-rollback health response:**
```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok", "latencyMs": 52 },
    "redis": { "status": "ok", "latencyMs": 3 }
  },
  "region": "australiaeast"
}
```

---

## 3. Alternative path — re-deploy a specific SHA via GitHub Actions

If the ACA revision history has been exhausted (older revisions are
garbage-collected after 100 revisions by ACA default) or the above AZ CLI
commands are not available, re-deploy a known-good commit SHA directly:

```bash
# Trigger cd-source.yml against a specific commit
gh workflow run cd-source.yml \
  --ref <known-good-sha> \
  --repo TailorAU/tailor-app
```

Wait for the workflow to complete, then verify as in Step 4 above.

---

## 4. Post-rollback actions

Do not re-deploy the rolled-back code until root cause is identified.

1. **Open a GitHub issue** with the `incident` label. Title:
   `[Rollback] <brief description> — <date>`. Post the revision name,
   deploy SHA, and the trigger event (5xx rate, health degraded, manual)
   in the issue body.

2. **Assign severity** per [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md):
   - Active rollback in progress = Sev 1 (service was down or significantly
     degraded during the bad-deploy window).
   - Rollback completed within the 5xx window = potentially reclassify to
     Sev 2 if impact was brief and bounded.

3. **Investigate root cause.** Pull ACA logs for the bad revision:
   ```bash
   az containerapp logs show \
     --name source-web-prod \
     --resource-group rg-source-prod \
     --revision <bad-revision-name> \
     --follow false \
     --tail 200
   ```
   See [`OBSERVABILITY.md`](OBSERVABILITY.md) for structured log access.

4. **Do not re-deploy until root cause is confirmed** and a fix is in the
   PR targeting `main`. The next `cd-source.yml` run after the fix lands
   becomes the new active revision.

5. **Write the retrospective** within the timebox defined in
   [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — within 7 days for Sev 1/2,
   14 days for Sev 3.

---

## 5. Cross-references

- [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) — Postgres PITR restore, full cold-rebuild procedure, region-level outage posture
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — severity definitions, response SLAs, customer-comms template
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — `/api/health` contract, log access commands, structured log format
