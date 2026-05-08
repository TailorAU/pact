# Source — Sovereignty Posture

> **Status:** All three substrates locked to Azure `australiaeast`. Honest about edge / LLM caveats and cross-border egress.
> **Audience:** Procurement reviewers, AU sovereign-AI counterparties (QGov, Foxleigh, Nyrstar), data-residency reviewers.

---

## Headline

Source's runtime substrate is **Microsoft Azure, region `australiaeast`,
end-to-end**. Compute, database, and cache are all Azure-managed AU
services. There is no cross-region replication of customer data. There is
no fallback to a non-AU substrate.

This was achieved as part of [`TIER1.md`](TIER1.md) WS0b on 2026-04-26
(commit `88d013a4e`, handoff #1310): the Redis substrate moved from
Upstash (cross-region) to Azure Cache for Redis in `australiaeast`. The
post-cutover `/api/health` Redis probe latency dropped from ~633ms to
~3ms — the same data point that confirmed the substrate move also confirms
the latency benefit of being genuinely in-region.

## Substrate residency table

| Tier | Service | Resource | Region | Notes |
|---|---|---|---|---|
| Compute | Azure Container Apps | `source-web-prod` (ACA) in `rg-source-prod` / env `source-env-prod` | `australiaeast` | 1 min, 3 max replicas; see `cd-source.yml`. |
| Database | Azure Database for PostgreSQL Flexible Server | `source-pg-prod.postgres.database.azure.com` | `australiaeast` | TLS-required (`sslmode=require`). PITR enabled. |
| Cache | Azure Cache for Redis | `source-redis-prod` (Basic C0, 250 MB, Redis 6.0) | `australiaeast` | SSL-only port 6380. Provisioned 2026-04-26 per #1310. |
| Container registry | Azure Container Registry | `tailorprodacr` | `australiaeast` (per `cd-source.yml` env block) | Source images pulled at deploy time. |
| Object storage | None used by Source today | — | — | Source does not store binary blobs or uploaded files. |

There are no customer-data substrates outside `australiaeast`. Backups,
PITR snapshots, and Redis instance state all live in-region. Microsoft
Azure's geo-redundant backup options have not been enabled for Source —
this is intentional under the procurement posture (no cross-region copies
of customer data, even by Microsoft).

## No cross-region replication of customer data

We make a positive statement and a negative statement.

**Positive:** every byte of customer data Source writes lives in
`australiaeast`. Postgres Flexible Server tables, Redis cache + rate-limit
keys, audit log rows, scenario tables, legislation tables, agent identity
records — all in-region.

**Negative:** there is no replica, mirror, snapshot copy, log shipping
target, or analytics export of customer data outside `australiaeast`. We
have not configured Azure geo-redundant storage. We do not export to
non-Azure analytics platforms. We do not stream production logs to a
non-AU SIEM.

If a contracted counterparty requires cross-region DR replication into
another AU region (e.g. `australiasoutheast` for active-active), that is a
per-contract conversation and lands as a separate Requirement.

## LLM provider region

Source uses Azure OpenAI for the LLM-fallback path on
`/api/scenarios/match` (and a small set of scoring helpers under
`src/lib/scenarios/llm-match.ts`). The endpoint is:

```
https://oai-tailor-app-prod.openai.azure.com/
```

This is the **`oai-tailor-app-prod` Azure OpenAI deployment hosted in
`australiaeast`**, shared with Tailor's main app. Inference happens
in-region on Microsoft-operated infrastructure.

Caveats:

- We are dependent on Microsoft's OpenAI region commitment. If Microsoft
  changes the region for this deployment, we will move.
- Prompt + completion content is subject to Microsoft's Azure OpenAI
  abuse-monitoring policy. Customers who require Azure OpenAI
  abuse-monitoring opt-out (Microsoft form-gated) are accommodated on a
  per-contract basis.
- Source does not call non-Azure OpenAI endpoints. There is no path to
  OpenAI public API, no Anthropic, no Google, no third-party LLM
  provider. The `openai` npm package is used only as a SDK to talk to
  the Azure-hosted endpoint.

## Cloudflare-edge sovereignty footnote

When Cloudflare is wired in front of `source.tailor.au` (Phase 1 WS3, not
yet shipped), the sovereignty story acquires one nuance.

[`PERFORMANCE.md`](PERFORMANCE.md):74–75 documents this: Cloudflare's edge
network is **global**. Cached responses can be served from a Cloudflare
Point-of-Presence outside Australia. The data classes that hit the edge
cache are:

- Public legislation reads (`/api/axiom/legislation*`)
- Static page assets (`_next/static/**`)
- Public scenario reads (where cached)

These data classes are **public knowledge** by definition. There is no
customer-private data in any cached path. A Cloudflare edge cache hit in
Singapore or Frankfurt serves the same public legislation text that is
freely downloadable from `legislation.gov.au` itself.

Cloudflare WAF and DDoS protection apply at the edge regardless of cache
behaviour. Cloudflare's own SOC 2 / ISO 27001 certifications cover the
edge platform.

A reviewer who requires "no edge POPs outside AU under any circumstance"
can deploy without Cloudflare; the origin posture remains 100% AU.

## Cross-border egress audit

Every outbound network call Source makes that could leave Australia is
catalogued below. The columns are:

- **Destination** — the upstream
- **Direction** — `outbound` (we call them) only; Source is purely
  inbound for traffic from clients
- **Trigger** — what causes the call
- **Data sent** — what we put in the request
- **Leaves AU?** — sovereignty determination
- **Notes**

| Destination | Direction | Trigger | Data sent | Leaves AU? | Notes |
|---|---|---|---|---|---|
| `maps.googleapis.com` | outbound | Browser-side; CSP allow-list at [`next.config.ts:11-15`](../next.config.ts) | None from Source server. The CSP permits the **client browser** to call Google Maps; Source's own server does not. | **Server: no.** Browser: yes (Google's region). | Source's CSP permits `script-src` and `connect-src` to Google's domains for client-rendered maps in some pages. The Source backend never calls Google Maps. If a customer's browser is in AU, the request still hits Google's geo-DNS-routed endpoint, which may be served from Google's AU region or US/SG. |
| `https://oai-tailor-app-prod.openai.azure.com/` | outbound | Server-side, on `/api/scenarios/match` LLM-fallback path | Predicate text + scenario context | **No.** Endpoint is in `australiaeast`. | See § LLM provider region above. Microsoft platform; in-region. |
| `https://www.legislation.gov.au/` (CTH) | outbound | Server-side, weekly cron `cron/legislation-sync` | None — read-only fetch | **No.** AU government API. | CTH legislation parser; see `src/lib/parsers/cth-parser.ts`. Public dataset, no API key required. |
| `https://www.legislation.qld.gov.au/` (QLD) | outbound | Server-side, weekly cron `cron/legislation-sync` | Basic auth credentials (`QLD_LEGISLATION_USERNAME` / `QLD_LEGISLATION_PASSWORD`) | **No.** QLD government API. | QLD legislation parser; see `src/lib/parsers/qld-parser.ts`. Authenticated read. |
| Translink SEQ GTFS feed (`www.data.qld.gov.au/dataset/general-transit-feed-specification-gtfs-seq/...`) | outbound | Server-side, on GTFS sync invocations | None — read-only fetch | **No.** QLD government open data. CC BY 4.0. | See `src/lib/gtfs-sync.ts:6-7`. |

There is no other production-path outbound API call. Specifically, Source
does **not** call:

- Non-Azure OpenAI (no `api.openai.com`)
- Anthropic, Google Gemini, or any other LLM provider
- Stripe, payment processors, or billing APIs (Source is not the billing surface)
- US-based analytics (no Google Analytics, no Mixpanel, no Segment)
- Slack / PagerDuty / external alerting (none configured)
- npm registry at runtime (build-time only; no runtime npm pulls)

This list is verifiable via a static scan of the `sites/source/src/`
codebase plus the next.config.ts CSP allow-list. If a future code change
adds a new outbound destination, it must update this table in the same
PR — the cross-border egress audit is a living document, not a one-time
snapshot.

## What residency does and does not guarantee

Residency in `australiaeast` guarantees:

- Customer data at rest is physically in Microsoft's AU datacentres.
- Microsoft's IRAP PROTECTED-assessed regions cover the platform.
- Cross-border disclosure under APP 8 is not triggered by default.

Residency does **not** guarantee:

- Microsoft staff outside Australia have no logical access. Microsoft
  publishes its global access controls; we do not override them.
- Australian law enforcement cannot compel disclosure of customer data
  via Microsoft. We are subject to AU jurisdiction, not exempt from it.
- A US CLOUD Act demand on Microsoft cannot reach data physically in AU.
  CLOUD Act is a US legal mechanism; whether it would prevail against an
  Australian counterparty's data is an unresolved legal question.

These caveats apply to every Australian-resident-data product on Azure.
Source is not unusual on this dimension.

## Cross-references

- [`COMPLIANCE.md`](COMPLIANCE.md) — IRAP-equivalent control mapping, "what we are not certified to"
- [`PERFORMANCE.md`](PERFORMANCE.md):74–75 — Cloudflare CDN strategy, edge caveat
- [`AUDIT.md`](AUDIT.md) — APP 8 cross-border disclosure mapping
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — `/api/health` exposes `region` field for verification
- [`TIER1.md`](TIER1.md) — substrate migration history (#1310 / WS0b)
- `DISASTER_RECOVERY.md` (placeholder, WS4) — backup residency, restore procedure
