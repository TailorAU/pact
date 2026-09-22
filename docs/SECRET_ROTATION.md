# Secret Rotation — Source Knowledge Graph

> **Knox-action document.** The procedures here require access to GitHub
> Secrets, the Azure portal, and the relevant upstream systems. Agent
> executors write and maintain this document; the rotation ceremony itself
> is a Knox-only action. See the Knox-action checklist at the bottom.

---

## Overview

Source uses the following credentials. Production application secrets are
stored in protected GitHub environments and injected as Container App
environment variables at deploy time via `cd-source.yml`. Scheduled Source
jobs read their cron credential only from the protected `source-prod-cron`
environment.

The canonical secret enumeration is `cd-source.yml` — this document tracks
every `${{ secrets.* }}` reference in that file plus the two WS3 Cloudflare
secrets not yet wired but policy-active.

**Incident remediation in progress (2026-08-21):** the legacy value populated
both `ADMIN_SECRET` and `CRON_SECRET` and was accidentally rendered during an
authorised audit, so both runtime slots must be treated as exposed. A distinct
admin replacement is staged in the main-restricted `prod` and
`source-prod-ingest` environments. Immediately before the reviewed deployment,
stage a distinct fresh cron value in both `prod` and the main-restricted
`source-prod-cron` environment. The deployment must rotate both Azure slots;
then verify a cron workflow and delete the repository-level
`SOURCE_CRON_SECRET`. Verify admin ingest separately before marking the admin
rotation complete; neither rotation is complete without its production proof.
Never copy the admin key into a repository-level secret or collapse the two
runtime slots again. Delete only the Source repository secret named
`SOURCE_CRON_SECRET`; the unrelated `PACT_CRON_SECRET` is not part of this
incident and must remain untouched.

---

## Secret inventory

### Tier A — Rotate every 90 days

| Secret name (GitHub) | Runtime env var | Purpose | Next due |
|---|---|---|---|
| `SOURCE_CRON_SECRET` | `CRON_SECRET` | Authenticates cron routes (`/api/cron/*`). Store the fresh value only in main-restricted `prod` and `source-prod-cron`; delete the legacy repository secret after production proof. | Immediate — incident rotation; then 2026-11-19 |
| `SOURCE_INGEST_ADMIN_KEY` | `ADMIN_SECRET` | Authenticates protected admin ingestion. Stored only in main-restricted `prod` and `source-prod-ingest`. | Production proof pending; then 2026-11-19 |
| `CF_API_TOKEN` | — (CI only) | Cloudflare API token used by `cd-source.yml` purge step (WS3). Not yet wired in workflow; policy-active from WS3 go-live. | 2026-08-07 |
| `ORIGIN_SHARED_SECRET` | `ORIGIN_SHARED_SECRET` | Shared secret between Cloudflare Workers and the Container App origin-check middleware (`src/middleware.ts`). Not yet wired; policy-active from WS3 go-live. | 2026-08-07 |
| `GOOGLE_MAPS_API_KEY` | Build-time `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API key injected at Docker build time. | 2026-08-07 |

### Tier B — Rotate every 180 days

| Secret name (GitHub) | Runtime env var | Purpose | Next due |
|---|---|---|---|
| `SOURCE_PG_PASSWORD` | Part of `DATABASE_URL` | Postgres Flexible Server password for the `source` database. Combined with `SOURCE_PG_USER` to form the `DATABASE_URL` connection string. | 2026-11-05 |
| `AZURE_REDIS_PASSWORD` | `AZURE_REDIS_PASSWORD` | Azure Cache for Redis access key. Hostname is held separately in `AZURE_REDIS_HOSTNAME` (not a secret — no rotation needed). | 2026-11-05 |
| `AZURE_OPENAI_KEY` | `AZURE_OPENAI_KEY` | Azure OpenAI Service API key. Two keys are provisioned per deployment; rotate via key swap (activate key 2, regenerate key 1, revert to key 1) to achieve zero downtime. | 2026-11-05 |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `APPLICATIONINSIGHTS_CONNECTION_STRING` | Application Insights instrumentation connection string. This is **not rotated** — it is Microsoft-managed and does not contain a secret you can cycle. The string encodes the instrumentation key (IKey) which Azure manages. If the workspace is ever deleted and recreated, update this value. | N/A — Microsoft-managed |

### Tier C — Rotate annually or on-event (coordinate with upstream)

| Secret name (GitHub) | Runtime env var | Purpose | Next due |
|---|---|---|---|
| `QLD_LEGISLATION_USERNAME` | `QLD_LEGISLATION_USERNAME` | Username for the Queensland legislation API (`legislation.qld.gov.au`). Rotate with advance notice to QLD Digital — their API team controls account management. | 2027-05-09 |
| `QLD_LEGISLATION_PASSWORD` | `QLD_LEGISLATION_PASSWORD` | Password for the QLD legislation API account. Rotate together with username. | 2027-05-09 |
| `AMAZON_AFFILIATE_TAG` | `AMAZON_AFFILIATE_TAG` | Amazon Associates affiliate tag for market pricing module. Rotate only if tag is suspected compromised; otherwise leave stable. | 2027-05-09 |
| `CF_COLES_TAG` | `CF_COLES_TAG` | Commission Factory affiliate tag — Coles. | 2027-05-09 |
| `CF_WOOLWORTHS_TAG` | `CF_WOOLWORTHS_TAG` | Commission Factory affiliate tag — Woolworths. | 2027-05-09 |
| `CF_CHEMIST_TAG` | `CF_CHEMIST_TAG` | Commission Factory affiliate tag — Chemist Warehouse. | 2027-05-09 |
| `CF_KMART_TAG` | `CF_KMART_TAG` | Commission Factory affiliate tag — Kmart. | 2027-05-09 |
| `EBAY_CAMPAIGN_ID` | `EBAY_CAMPAIGN_ID` | eBay Partner Network campaign ID for market pricing. | 2027-05-09 |

### Tier D — No rotation (policy-documented)

| Secret name (GitHub) | Purpose | Policy |
|---|---|---|
| `AZURE_CLIENT_ID` | Azure OIDC federated identity — used by `azure/login@v2`. Rotated by Azure identity lifecycle, not by Source ops. | Azure-managed. Rotate if service principal is compromised. |
| `SOURCE_PG_USER` | Postgres username (not a secret — a principal identifier). | Not a credential; no rotation cadence. |
| `AZURE_REDIS_HOSTNAME` | Redis hostname (not a secret). | Not a credential; changes only if the Redis instance is replaced. |
| Cosign signing | Image signing uses keyless OIDC via GitHub Actions. No private key exists to rotate. | Keyless OIDC — ephemeral cert per CI run, trust anchored in `token.actions.githubusercontent.com`. |

---

## Rotation procedures

### General pattern — every rotation follows these four steps

1. **Generate** a new value in the source system.
2. **Update the GitHub Secret** (`Settings → Secrets and variables → Actions → prod environment → edit`).
3. **Trigger a new deploy** (`gh workflow run cd-source.yml -f environment=prod --ref main`) to inject the new value into the Container App.
4. **Verify** that the application is healthy after the new secret is live.

The deploy is the distribution mechanism — GitHub Secrets flow to Container App env vars only on a deploy run.

---

### SOURCE_CRON_SECRET (90 days; immediate incident rotation pending)

**Where generated:** any cryptographically secure random generator.

```bash
# Generate 32 random bytes locally. Never emit the value in CI/agent logs.
openssl rand -hex 32
```

**Update steps:**
1. Generate one fresh value without printing it in captured output.
2. Immediately before the reviewed merge, set that same value as
   `SOURCE_CRON_SECRET` in both the protected `prod` and
   `source-prod-cron` environments. Keep the repository-level secret until
   the deployment and cron proof succeed.
3. Merge the reviewed change so `cd-source.yml` injects the fresh value into
   Azure `CRON_SECRET`; avoid an unrelated delay between steps 2 and 3.
4. Wait for deployment, confirm `/api/health`, and confirm the deployed Source
   version is the reviewed `main` commit.
5. Dispatch the manual-only, read-only authentication proof from `main` and
   record its green Action run without recording the credential:
   `gh workflow run cron-source.yml -f job=auth-check --ref main`. Do not use a
   mutating maintenance job to prove a credential rotation.
6. Confirm cron and admin authentication remain distinct. After the cron
   production proof succeeds, delete the repository-level
   `SOURCE_CRON_SECRET` and mark the cron rotation complete. Leave the unrelated
   repository-level `PACT_CRON_SECRET` untouched. Admin completion remains
   gated on its separate exact-ingest proof.

---

### SOURCE_INGEST_ADMIN_KEY (90 days)

**Where generated:** any cryptographically secure random generator.

```bash
# Generate a 32-byte hex secret. Never print it in CI logs or issue evidence.
openssl rand -hex 32
```

**Update steps:**
1. Generate one new value without deleting the currently active value.
2. Update `SOURCE_INGEST_ADMIN_KEY` in both the `prod` and
   `source-prod-ingest` GitHub environments. Both environments must remain
   restricted to protected branches; `main` is the protected branch.
3. Trigger `cd-source.yml` from `main` so Azure receives the new
   `ADMIN_SECRET`. Routine admin rotations do not change `CRON_SECRET`; the
   2026-08-21 shared-value incident is the explicit coordinated exception.
4. Verify health and a bounded canonical read, then run one reviewed ingest
   through `source-legislation-ingest.yml`.
5. Confirm cron auth still succeeds with `SOURCE_CRON_SECRET` and does not use
   the new admin value.
6. Only after all verification succeeds, retire superseded admin-only
   credential material. For the 2026-08-21 incident, do not mark this rotation
   complete until the separate cron rotation and proof also succeed.

---

### CF_API_TOKEN (90 days — active post WS3)

**Where generated:** Cloudflare dashboard → Profile → API Tokens → Create Token.

Use the "Edit Zone DNS" template scoped to the `source.tailor.au` zone. Add "Cache Purge" permission.

**Update steps:**
1. Create new token (do not delete the old one yet).
2. Update `CF_API_TOKEN` GitHub Secret.
3. Trigger a test deploy (or manually run the purge step in a workflow `workflow_dispatch`).
4. Confirm purge succeeded (non-4xx response from Cloudflare cache-purge API in workflow logs).
5. Delete the old token.

---

### ORIGIN_SHARED_SECRET (90 days — active post WS3)

**Where generated:**

```bash
openssl rand -hex 32
```

**Update steps:**
1. Generate new value.
2. Update `ORIGIN_SHARED_SECRET` GitHub Secret.
3. Update the same value in the Cloudflare Worker / Transform Rule that injects `X-Origin-Secret` on requests to the Container App origin. This must be an **atomic swap** — update both sides in the same change window to avoid origin rejecting legitimate Cloudflare traffic.
4. Deploy: `gh workflow run cd-source.yml -f environment=prod --ref main`.
5. Verify Cloudflare → origin path works: `curl -sI https://source.tailor.au/api/health` should still return 200.

---

### SOURCE_PG_PASSWORD (180 days)

**Where generated:** Azure portal → PostgreSQL Flexible Server → `source-pg-prod` → Server parameters → generate new password, or use:

```bash
openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32
```

**Update steps:**
1. In the Azure portal, update the admin password for `source-pg-prod.postgres.database.azure.com`. Record the new password immediately.
2. Update `SOURCE_PG_PASSWORD` GitHub Secret.
3. `gh workflow run cd-source.yml -f environment=prod --ref main`.
4. Monitor deploy logs — if `DATABASE_URL` is stale in the running revision, the Container App will fail health checks. The deploy updates the env var and restarts.
5. Health check: `curl -s https://source.tailor.au/api/health | jq '.checks.database'` — should show `ok` and sub-100ms latency.

---

### AZURE_REDIS_PASSWORD (180 days)

**Where generated:** Azure portal → Azure Cache for Redis → `source-redis-prod` (or equivalent) → Access keys → Regenerate.

Azure provides two keys (primary/secondary). Use the **key swap** pattern for zero downtime:

1. Update Container App to use **secondary key** (set `AZURE_REDIS_PASSWORD` to the secondary value → deploy).
2. Regenerate the **primary key** in the Azure portal.
3. Update Container App back to the new **primary key** → deploy.
4. (Optional) regenerate secondary key for hygiene.

**Verification:** `curl -s https://source.tailor.au/api/health | jq '.checks.cache'` — should show `ok`.

---

### AZURE_OPENAI_KEY (180 days)

**Where generated:** Azure portal → Azure OpenAI Service → `oai-tailor-source-prod` → Keys and Endpoint.

Use the key swap pattern (two keys provisioned):

1. Update `AZURE_OPENAI_KEY` to **Key 2** → deploy.
2. Regenerate **Key 1** in the portal.
3. Update `AZURE_OPENAI_KEY` back to the new **Key 1** → deploy.
4. Verification: trigger an LLM-backed request (e.g. scenario matching) and confirm it succeeds in App Insights traces.

---

### APPLICATIONINSIGHTS_CONNECTION_STRING (no rotation)

This value is Microsoft-managed. You cannot and should not cycle it unless
you are recreating the Application Insights workspace. If the workspace is
ever deleted and recreated:

1. The Azure portal will show a new connection string.
2. Update the GitHub Secret.
3. Deploy.

---

### QLD_LEGISLATION_USERNAME + QLD_LEGISLATION_PASSWORD (annual)

**Coordination required:** Contact the QLD Digital team (account manager or
API support) to arrange a password change. Do not reset unilaterally — the
account must remain active for the legislation scraper.

**Steps:**
1. Arrange new credentials with QLD Digital.
2. Test new credentials against the QLD Legislation API before updating production.
3. Update `QLD_LEGISLATION_USERNAME` and `QLD_LEGISLATION_PASSWORD` GitHub Secrets.
4. Deploy.
5. Verify scraper: `curl -s -H "X-Admin-Key: $ADMIN_SECRET" https://source.tailor.au/api/admin/freshness | jq '.sources.qld'`.

---

### Affiliate tags (annual or on-event)

Affiliate tags (`AMAZON_AFFILIATE_TAG`, `CF_COLES_TAG`, `CF_WOOLWORTHS_TAG`, `CF_CHEMIST_TAG`, `CF_KMART_TAG`, `EBAY_CAMPAIGN_ID`) are not security credentials — they are business identifiers. Rotate only if:

- The affiliate account is compromised or closed.
- A new affiliate programme account is opened.
- The annual review determines the tag should change.

Update via GitHub Secrets → deploy. No zero-downtime ceremony needed.

---

### GOOGLE_MAPS_API_KEY (90 days)

**Where generated:** Google Cloud Console → APIs & Services → Credentials → API Keys → create a new key, restrict to Maps JavaScript API + geocoding.

**Steps:**
1. Create new restricted key.
2. Update `GOOGLE_MAPS_API_KEY` GitHub Secret.
3. Deploy — the key is baked into the Docker image at build time (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`), so a build is required.
4. Delete or disable the old key after confirming the new build is healthy.

---

## Calendar SOP

Run this checklist at the start of each calendar quarter and at annual review:

| Cadence | Secrets to rotate | Next due |
|---|---|---|
| **Q3 2026 (2026-08-07)** | `SOURCE_CRON_SECRET`, `CF_API_TOKEN` (post-WS3), `ORIGIN_SHARED_SECRET` (post-WS3), `GOOGLE_MAPS_API_KEY` | 2026-08-07 |
| **Q4 2026 (2026-11-19)** | `SOURCE_INGEST_ADMIN_KEY` | 2026-11-19 |
| **End of 2026-H1 (2026-11-05)** | `SOURCE_PG_PASSWORD`, `AZURE_REDIS_PASSWORD`, `AZURE_OPENAI_KEY` | 2026-11-05 |
| **Annual 2027 (2027-05-09)** | `QLD_LEGISLATION_USERNAME/PASSWORD`, all affiliate tags | 2027-05-09 |
| **Q1 2027 (2027-02-05)** | `SOURCE_CRON_SECRET` (90d cycle from Q3), `GOOGLE_MAPS_API_KEY` | 2027-02-05 |

After each rotation, update the "Next due" column in the inventory table above and commit the change.

---

## Verification after any rotation

```bash
# Health — confirms DB and Redis are accepting the new credentials
curl -s https://source.tailor.au/api/health | jq '.checks'

# Admin auth — confirms SOURCE_INGEST_ADMIN_KEY (ADMIN_SECRET slot)
curl -s -H "X-Admin-Key: $ADMIN_SECRET" https://source.tailor.au/api/admin/freshness | jq '.overallStatus'

# Cron auth — read-only proof of SOURCE_CRON_SECRET (CRON_SECRET slot)
gh workflow run cron-source.yml -f job=auth-check --ref main

# Azure OpenAI — confirm LLM path still works (scenario matching proxy)
curl -s -H "X-Source-Agent-Key: $AGENT_KEY" \
  "https://source.tailor.au/api/scenarios/match" \
  -H "Content-Type: application/json" \
  -d '{"predicates":{"jurisdiction":"AU","industry":"construction"}}' | jq '.count'
```

---

## Knox-action checklist — first rotation ceremony

The following secrets have **never been rotated** since Source launched. Knox
should complete this ceremony at the next available opportunity (recommended:
within 30 days of this document being committed, i.e. before 2026-06-09).

- [ ] `SOURCE_CRON_SECRET` — exposed legacy value remains live; stage a fresh value in protected `prod` + `source-prod-cron` immediately before #5309 merge, deploy, verify the read-only `auth-check` Action, then delete only this repository secret; leave unrelated `PACT_CRON_SECRET` untouched
- [ ] `SOURCE_INGEST_ADMIN_KEY` — distinct replacement staged in protected `prod` + `source-prod-ingest`; mark complete only after deployment and exact-ingest proof under #5309
- [ ] `SOURCE_PG_PASSWORD` — update Azure PG password, update GitHub Secret, deploy, verify DB health check
- [ ] `AZURE_REDIS_PASSWORD` — key-swap pattern (secondary → regenerate primary → swap back), verify cache health check
- [ ] `AZURE_OPENAI_KEY` — key-swap pattern, verify LLM scenario match
- [ ] `QLD_LEGISLATION_USERNAME` + `QLD_LEGISLATION_PASSWORD` — coordinate with QLD Digital, test before deploying
- [ ] `GOOGLE_MAPS_API_KEY` — create new restricted key, deploy, delete old
- [ ] Affiliate tags — review whether current tags are the correct ones; rotate if any account has changed
- [ ] After ceremony: update "Next due" dates in the inventory table above and commit
- [ ] After ceremony: post evidence comment on the issue/PR tracking this document

---

## Cross-references

- [`SECURITY.md`](SECURITY.md) — vulnerability disclosure, defence-in-depth
- [`COMPLIANCE.md`](COMPLIANCE.md) — procurement posture, Privacy Act mapping
- [`SUPPLY_CHAIN.md`](SUPPLY_CHAIN.md) — Cosign keyless signing, SBOM, CVE scan (no secret rotation)
- [`SOVEREIGNTY.md`](SOVEREIGNTY.md) — substrate residency and cross-border egress
- [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) — what to do if a secret is compromised before rotation

---

*Document created: 2026-05-09. Review cycle: quarterly.*
