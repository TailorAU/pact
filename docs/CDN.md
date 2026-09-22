# Source — CDN, Cache, WAF (Cloudflare)

> **Status:** Code-side ready (`agent/ws3-cloudflare`, plan
> `playful-baking-hummingbird` § Phase 1 WS3). DNS cutover + Cloudflare
> zone provisioning are Knox-actions; see § Knox-action checklist.
> **Audience:** Knox (operations), procurement reviewers, on-call.

---

## Headline

Cloudflare sits in front of `source.tailor.au` as the public edge:

- **Cache** — API response caching is disabled fail-closed at the origin
  while the public-route allowlist and edge bypass policy are audited.
  Build-hashed static assets remain eligible for normal immutable caching.
- **WAF + DDoS** — Cloudflare's managed OWASP ruleset, bot management,
  and L3/L4 + L7 DDoS protection apply at the edge before traffic
  reaches Azure Container Apps.
- **Origin lock-down** — every request that reaches ACA must carry the
  shared `x-origin-secret` header injected by a Cloudflare Transform
  Rule. Direct hits to the ACA FQDN that miss the header are rejected
  with 403 by `src/proxy.ts`.
- **Cache purge on deploy** — `cd-source.yml` calls Cloudflare's
  `/purge_cache` API after a successful image deploy, so callers see
  the new build without waiting for TTLs to expire.

Sovereignty caveat: Cloudflare's edge network is **global**. API
responses are currently ineligible for edge cache; only static assets
may be cached. See § Sovereignty posture and
[`SOVEREIGNTY.md`](SOVEREIGNTY.md):84–108.

---

## Knox-action checklist

These steps are gated on Knox; the code in this PR is forward-compatible
and skips/no-ops cleanly until each is complete. Order doesn't matter
strictly, but ① and ② block the cutover, while ③–⑤ unlock the
production benefits.

### ① Provision the Cloudflare zone

1. Add `tailor.au` (or just `source.tailor.au` as a partial / CNAME
   setup) to Cloudflare. Use the **Free** plan to start; upgrade to Pro
   when bot-management features are required.
2. Set the zone to **Full (strict)** SSL/TLS — Cloudflare must validate
   the ACA TLS certificate. The ACA FQDN is already TLS-only.
3. Enable **Always Use HTTPS** + **HSTS preload** consistent with the
   `Strict-Transport-Security: max-age=31536000; includeSubDomains` Source
   already sets at `next.config.ts:31`.
4. Enable **HTTP/3 (with QUIC)** and **0-RTT Connection Resumption** for
   latency.

### ② DNS cutover (NS or proxied CNAME)

1. **Option A — full NS delegation:** point the `tailor.au` registrar's
   nameservers at Cloudflare's assigned pair. All Tailor subdomains move
   together.
2. **Option B — partial / CNAME:** keep current NS, add a proxied CNAME
   `source.tailor.au -> source-web-prod.<acaenv>.azurecontainerapps.io`.
   Smaller blast radius; keeps Tailor's other subdomains on their
   existing path.
3. Verify with `dig source.tailor.au` — answer should be Cloudflare-IP
   space and `cdn-cgi/trace` should respond.

### ③ Generate `CF_API_TOKEN` and add as a GitHub secret

1. In Cloudflare → **My Profile → API Tokens → Create Token**.
2. Use the **Custom token** template with **only**:
   - Permission: `Zone → Cache Purge → Purge`
   - Zone Resources: `Include → Specific zone → tailor.au`
   - Account Resources: `Include → All accounts` (read-only is fine here)
3. Copy the token. Add to GitHub:
   `gh secret set CF_API_TOKEN --repo TailorAU/tailor-app`.
4. Also capture the zone ID (Cloudflare → zone overview → API → Zone ID)
   and set it: `gh secret set CF_ZONE_ID --repo TailorAU/tailor-app`.
5. The next `cd-source.yml` run will execute the **Cloudflare — purge
   edge cache** step. Until then it skips cleanly with a step-summary
   note.

### ④ Generate `ORIGIN_SHARED_SECRET` and wire it both ways

The same value must be set in two places: (a) ACA env block (so the
proxy can validate it), and (b) a Cloudflare Transform Rule (so every
proxied request carries the header).

1. Generate: `openssl rand -hex 32` (32 bytes / 64 hex chars).
2. **GitHub secret (origin side):**
   `gh secret set ORIGIN_SHARED_SECRET --repo TailorAU/tailor-app`.
   `cd-source.yml` already wires this into ACA's env block under both
   `containerapp update` and `containerapp create`.
3. **Cloudflare Transform Rule (edge side):** Cloudflare → zone →
   **Rules → Transform Rules → Modify Request Header → Create**.
   - Rule name: `Origin lock-down: x-origin-secret`
   - Match: `(http.host eq "source.tailor.au")`
   - Then: `Set static → x-origin-secret → <value from step 1>`
4. Restart the ACA revision (it will get the new env on the next `cd`
   run, or via `az containerapp restart --name source-web-prod
   --resource-group rg-source-prod`).
5. Verify: `curl -I https://source.tailor.au/api/health` → 200. Then
   `curl -I https://<aca-fqdn>/api/health` → 403 (direct-to-origin
   blocked).

Until step ④ completes, the proxy is forward-compatible and allows all
requests (`ORIGIN_SHARED_SECRET` is unset → no enforcement). This is
the explicit pre-cutover behaviour.

### ⑤ Configure cache rules + WAF

Apply the rules in § Cache rules and § WAF rules below as Cloudflare
Page Rules or, preferably, the newer **Cache Rules** + **WAF custom
rules** product. The Free plan supports the essentials; Pro is required
for bot-management JS challenges.

---

## Cache rules

Source sets a fail-closed API policy at `next.config.ts`: every
`/api/:path*` response carries `Cache-Control: no-store` plus explicit
generic-CDN and Cloudflare-CDN no-store headers. There is currently no
public API cache allowlist. Cloudflare must use **Respect Existing
Headers** and an explicit `/api/*` bypass rule so an edge configuration
cannot broaden the origin contract.

| Match | Cache behaviour | Why |
|---|---|---|
| `/api/*` | Bypass cache | Default-deny until every candidate public GET has a route-level data/auth audit and production-shape tests. |
| `/_next/static/**` | Cache 1 year, immutable | Build-hashed assets — content-addressed, never mutate. |
| `/_next/image/**` | Cache 1 day | Optimised images; safe to cache, infrequent change. |
| `/favicon.ico`, `/robots.txt`, `/sitemap.xml` | Cache 1 day | Static, low-churn. |
| Everything else (HTML pages, e.g. `/`, `/topics/*`, `/map`) | Bypass cache, edge proxy only | RSC payloads + per-request rendering; not safely cacheable without sign-out cohort handling. |

### Cache **bypass** rules (must not cache)

| Match | Why |
|---|---|
| `/api/*` | All API responses are no-store until an audited allowlist is deliberately introduced. This includes admin, audit, PACT, work, usage, cron, health, and currently-public reads. |
| Any path with a request body (POST/PUT/PATCH/DELETE) | Cloudflare bypasses by default; pin explicitly. |
| Any request carrying `Authorization`, `X-Admin-Key`, or `X-Source-Agent-Key` | Cookie-equivalent — never cache cross-tenant. |

Implementation note: Cloudflare's **Cache Rules** (replacement for Page
Rules) use the wirefilter syntax. Example for the bypass set:

```
(starts_with(http.request.uri.path, "/api/"))
or (any(http.request.headers.names[*] in {"authorization" "x-admin-key" "x-source-agent-key"}))
```

→ **Then: Cache eligibility = Bypass cache**.

### Purge on deploy

`cd-source.yml` runs the **Cloudflare — purge edge cache** step at the
end of every successful deploy:

```yaml
curl -fsS -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Whole-zone purge remains acceptable: API responses are bypassed, so
Source's cache footprint is limited to static/content-addressed assets,
and the purge runs once per deploy. The step is `continue-on-error:
true` so a transient Cloudflare API blip doesn't fail the workflow —
the deploy has already succeeded by this point.

---

## Origin lock-down

The ACA Container App keeps a public FQDN
(`source-web-prod.<env>.<region>.azurecontainerapps.io`) which would
bypass Cloudflare entirely if a caller knew it. The shared-header check
in `src/proxy.ts` closes that gap.

| Component | Behaviour |
|---|---|
| `src/proxy.ts` (Edge runtime) | Reads `process.env.ORIGIN_SHARED_SECRET`. If unset → allow all. If set → require `x-origin-secret` header to match exactly; otherwise return `403`. |
| Cloudflare Transform Rule | Injects `x-origin-secret: <value>` on every request matching `http.host eq "source.tailor.au"`. |
| `cd-source.yml` env block | Wires `ORIGIN_SHARED_SECRET` into both `az containerapp update` and `az containerapp create` env-vars blocks. |

The header is stripped from the response (it's set only on the request
side). Clients never see it.

**Failure modes and recovery:**

| Symptom | Cause | Fix |
|---|---|---|
| Every request returns 403 after cutover | Transform Rule not deployed or matches wrong hostname | Re-check § ④ step 3; the rule must match `http.host eq "source.tailor.au"`, not the apex. |
| Direct-to-ACA hits succeed (lock-down not enforced) | `ORIGIN_SHARED_SECRET` not yet set as ACA env | Re-run `cd-source.yml` after setting the secret; check `az containerapp show` env block. |
| `curl -I https://source.tailor.au/api/health` returns 502 | Cloudflare can't reach ACA, or ACA is rejecting Cloudflare TLS | Check zone TLS mode is **Full (strict)**; check ACA ingress is `external` and TLS-enabled. |
| Mismatched secret (rotation drift) | Rotated one side but not the other | Update both Cloudflare Transform Rule AND the GitHub `ORIGIN_SHARED_SECRET` secret in the same operation; trigger a `cd-source.yml` run. |

---

## WAF rules

Apply Cloudflare's **Managed Rules** at the standard level, plus the
custom rules below.

| Rule | Purpose |
|---|---|
| **Cloudflare Managed Ruleset** (OWASP) | XSS, SQLi, command injection, LFI/RFI on every request. Set sensitivity = **Medium** initially; review false positives at week 1. |
| **Cloudflare Free Managed Ruleset** (or Pro+: **Bot Fight Mode**) | Block known bad bots; don't challenge AU-residential ASNs by default — Source is for AU agents. |
| **Custom rule: rate-limit API** | 60 requests / minute / IP on `/api/*`. Source already rate-limits agent keys at `src/lib/rate-limit.ts` (sliding window). The edge rule defends the unauthenticated reads. |
| **Custom rule: block known-bad UAs** | `(http.user_agent contains "sqlmap") or (http.user_agent contains "nikto")` → block. Free-tier acceptable. |
| **Custom rule: block requests missing User-Agent on `/api/*`** | Empty UA on programmatic API calls is a bot smell. Soft-block with a managed challenge for first offence. |
| **Custom rule: enforce `Cf-Connecting-Ip` exists** | Defence-in-depth — requests reaching ACA without `Cf-Connecting-Ip` after the cutover are anomalies (the ORIGIN_SHARED_SECRET check already catches this; the WAF rule surfaces it earlier). |

DDoS posture: Cloudflare's L3/L4 + L7 DDoS Protection is **always on,
free tier included**. No configuration required. Volumetric attacks
absorb at the Cloudflare edge before reaching ACA. Monitor via
Cloudflare → **Security → Events**.

---

## Sovereignty posture

Cloudflare's edge network is **global**, but API response caching is
currently disabled fail-closed. Only static assets such as
`_next/static/**` are eligible for edge cache; no legislation, scenario,
agent, admin, audit, work, usage, cron, health, or PACT API payload is
cacheable. An API allowlist requires a separate route-level data/auth
audit, matching origin and edge rules, and production-shape tests.

This is the position documented in [`SOVEREIGNTY.md`](SOVEREIGNTY.md):84–108
and [`PERFORMANCE.md`](PERFORMANCE.md):57–78. Cloudflare WAF, DDoS
protection, TLS, and origin proxying remain active independently of
cache eligibility.

A reviewer who requires "no edge POPs outside AU under any circumstance"
can be served by **Cloudflare's Regional Services** (paid feature, AU
region only) — file a `/requirement` if a contractually-bound counterparty
asks for it. Until then, the global edge is the default.

WAF and DDoS protection apply at the edge regardless of cache
behaviour. Cloudflare's own SOC 2 / ISO 27001 / IRAP-equivalent
certifications cover the edge platform itself; see Cloudflare's
public Trust Hub.

---

## Verification commands (post-cutover)

Run these as a quick health check after Knox completes § ① – ⑤. Each
should pass without any extra configuration on the caller's side.

```bash
# 1. Health endpoint succeeds via Cloudflare
curl -s https://source.tailor.au/api/health | jq '.region, .checks'
# Expected: "australiaeast" + db/redis/region all green.

# 2. Cloudflare is in the path (cf-cache-status header present)
curl -sIL https://source.tailor.au/_next/static/chunks/main-* \
  | grep -i 'cf-cache-status\|cf-ray\|server'
# Expected: cf-cache-status (HIT|MISS|EXPIRED|REVALIDATED) + cf-ray.

# 3. API responses fail closed against origin and edge caching
curl -sS -D - -o /dev/null \
  "https://pact.tailor.au/api/axiom/legislation?id=qld%2Freg-2017-165&format=canonical&cb=cache-policy-check"
# Expected: Cache-Control, CDN-Cache-Control, and
# Cloudflare-CDN-Cache-Control all prohibit storage.

# 4. Origin lock-down is enforced (direct ACA hit returns 403)
ACA_FQDN=$(az containerapp show \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --query "properties.configuration.ingress.fqdn" -o tsv)
curl -sIL "https://${ACA_FQDN}/api/health" | head -1
# Expected: HTTP/2 403  (after § ④ ORIGIN_SHARED_SECRET wiring is live)

# 5. Direct ACA hit with the right header works (smoke for ops)
ORIGIN_SECRET=$(az containerapp show \
  --name source-web-prod \
  --resource-group rg-source-prod \
  --query "properties.template.containers[0].env[?name=='ORIGIN_SHARED_SECRET'].value | [0]" -o tsv)
curl -sI "https://${ACA_FQDN}/api/health" \
  -H "x-origin-secret: ${ORIGIN_SECRET}" | head -1
# Expected: HTTP/2 200

# 6. WAF rule blocks a sqlmap-style probe
curl -sI "https://source.tailor.au/api/health?id=' OR 1=1--" | head -1
# Expected: HTTP/2 403 (Cloudflare Managed Rules)

# 7. The latest Source deployment completed (purge still protects static assets)
gh run list --workflow cd-source.yml --limit 1 \
  --repo TailorAU/tailor-app --json databaseId,conclusion,status
```

---

## Local development

`ORIGIN_SHARED_SECRET` is **not set** in local dev (`.env.example`
documents the var as commented-out by default). The proxy's check
no-ops and every request is allowed. `cf-cache-status` headers are
absent because nothing is in front of `next dev` locally.

To exercise the lock-down behaviour locally:

```bash
cd sites/source
ORIGIN_SHARED_SECRET=test-secret-do-not-use npm run dev
# Now in another terminal:
curl -i http://localhost:4000/api/health                          # → 403
curl -i http://localhost:4000/api/health -H "x-origin-secret: test-secret-do-not-use"   # → 200
unset ORIGIN_SHARED_SECRET   # (or restart the dev server)
```

---

## Cross-references

- [`SECURITY.md`](SECURITY.md) — vulnerability disclosure address, threat model, defence-in-depth control table.
- [`SOVEREIGNTY.md`](SOVEREIGNTY.md) — substrate residency, Cloudflare edge footnote, cross-border egress audit.
- [`PERFORMANCE.md`](PERFORMANCE.md) — Tier-1 SLA targets, cache layer, capacity estimates.
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — `/api/health` contract, structured-log schema (the `cf-ray` header is a useful correlation handle for cross-system traces).
- [`COMPLIANCE.md`](COMPLIANCE.md) — IRAP-equivalent control mapping; the WAF + DDoS posture above contributes to the "boundary protection" controls.
- [`docs/operations/production-runbook.md`](../../../docs/operations/production-runbook.md) — Tailor monorepo runbook (sibling pattern; Source's runbook lives in this `sites/source/docs/` tree).
- `cd-source.yml` § Cloudflare — purge edge cache — the workflow step this document underpins.
- `src/proxy.ts` — the origin-secret enforcement code; comments cross-reference back to this file.
