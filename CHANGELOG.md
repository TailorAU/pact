# Changelog

All notable changes to Source (`source.tailor.au`) are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where versions apply (Source runs as a single rolling production deployment;
versions correspond to dated release entries below rather than tagged
releases).

## [Unreleased]

### Added

- **PACT v2.3 §6.4 provenance chain over the PACT operation log** (#5566).
  Every event written through `emitEvent` now carries a per-resource gapless
  `sequence_number`, a `prev_hash` linking it to the previous event's hash,
  its own `event_hash` (`base64url(SHA-256(RFC 8785 canonical event))`) and an
  explicit `hash_alg` (`sha256-jcs@1`). Assignment runs inside one database
  transaction with a per-resource advisory lock and a UNIQUE index on
  `(topic_id, sequence_number)`; a failure to chain fails the operation rather
  than writing an unchained row. Pre-#5566 rows are **not** backfilled — the
  chain starts at a declared genesis (`GENESIS`, or `GENESIS-UNCHAINED` where
  unchained history exists) and the verifier reports the uncovered rows.
  New `verifyResourceChain` / `verifyOrderedChain` walk a resource's chain and
  report the first break (gap, duplicate, tamper, broken link, missing hash,
  unknown algorithm) as a structured record rather than a boolean. The five
  columns are already published by `GET /api/pact/{topicId}/events`. Design +
  genesis record: `docs/PROVENANCE_CHAIN.md`.
- (placeholder — additions landing on `main` between dated releases will be listed here)

### Changed

- (placeholder)

### Deprecated

- (placeholder)

### Removed

- (placeholder)

### Fixed

- (placeholder)

### Security

- (placeholder)

## [2026-05-09] — Production-readiness sprint kickoff

This entry kicks off the changelog and captures the production-readiness
sprint that is in flight as of this date. It establishes the format for
future entries; substantive work landing in this sprint will be backfilled
into subsequent dated entries as it ships.

### Added

- `docs/SECURITY.md` — vulnerability disclosure policy, fix SLAs, threat
  model, in-scope and out-of-scope endpoints (WS5).
- `docs/INCIDENT_RESPONSE.md` — severity definitions, response SLAs,
  paging path, retrospective + customer-comms templates (WS5).
- `docs/COMPLIANCE.md` — Privacy Act mapping, IRAP-equivalent control
  mapping, explicit "not certified to" list, QGov procurement summary
  (WS5).
- `docs/SLA.md` — uptime targets, latency targets per surface,
  maintenance window (Sunday 04:00–05:00 AEST), service-credit posture
  (WS5).
- `docs/SOVEREIGNTY.md` — substrate residency table, no-cross-region-
  replication statement, Cloudflare edge sovereignty footnote, Azure
  OpenAI region disclosure, cross-border egress audit (WS5).
- `CHANGELOG.md` — this file (WS5).

### Changed

- `README.md` — Documentation section added linking to the new ops docs.

### Security

- No security changes in this entry. The new docs codify existing
  controls (TLS-only ingress, CSP/HSTS, rate limiting, audit logging,
  hashed actor keys, encryption at rest via Azure-managed keys); they do
  not introduce or change controls.

## [2026-04-26] — Tier-1 baseline (historical)

Captured for context; pre-dates this changelog. See
[`TIER1.md`](docs/TIER1.md) for the authoritative Tier-1 milestone record.

### Added

- Sovereign substrate migration: Redis Upstash → Azure Cache for Redis
  in `australiaeast` (#1310 / WS0b, commit `88d013a4e`). All three
  substrates (compute, DB, cache) now Azure-managed AU.
- Audit log baseline: `audit_log` table, `recordAudit()` helper,
  `GET /api/admin/audit` endpoint, Privacy Act mapping (#1308 / WS5).
- Observability baseline: structured JSON logger, `/api/health` endpoint
  with DB + Redis probes (#1307 / WS3).
- Performance baseline: read-through Redis cache (`cache.getOrSet`),
  cached `/api/hub/stats` (30s TTL), k6 baseline scripts (#1309 / WS8).

### Changed

- `/api/health` Redis probe latency: ~633 ms (Upstash cross-region) →
  ~3 ms (Azure Cache for Redis in-region) post-WS0b cutover.

[Unreleased]: https://github.com/tailorau/tailor-app/compare/main...HEAD
