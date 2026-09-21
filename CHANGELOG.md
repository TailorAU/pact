# Changelog

All notable changes to Source (`source.tailor.au`) are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where versions apply (Source runs as a single rolling production deployment;
versions correspond to dated release entries below rather than tagged
releases).

## [Unreleased]

### Added

- **In-process consensus heartbeat** (tailor-group#9). `instrumentation.ts`
  now starts `src/lib/consensus-heartbeat.ts` on every server boot, which
  calls `runConsensusSweep` every `CONSENSUS_SWEEP_INTERVAL_MINUTES` (default
  30, `0` disables, requires `DATABASE_URL`) after a 60-second boot delay.
  tailor-app#5954 retired the `cron-source.yml` workflow that had been the
  engine's only heartbeat since #5425, and a GitHub `schedule` fires from the
  default branch only, which the KG does not deploy from yet — so the engine
  had no clock at all from 2026-09-18. Same single entry point, same Postgres
  advisory lock; a tick that overlaps a running sweep is skipped and counted,
  a sweep that throws is logged (`consensus.heartbeat.failed`) and the next
  tick still fires. Fake-timer unit suite in `consensus-heartbeat.test.ts`.
- **`.github/workflows/cron.yml`** (tailor-group#9). tailor-app's
  `cron-source.yml` re-homed here job for job — cleanup, yield, staleness,
  legislation-sync, spatial-snapshot, gtfs-sync, fiscal-sync, auto-merge and
  the manual read-only `auth-check` — against `https://pact.tailor.au` with
  this repository's `CRON_SECRET` (the same secret `cd-kg.yml` deploys).
  Inert as a schedule until the default branch carries it; every job is
  dispatchable on `rehome-review` today (a `push` trigger on the file's own
  path gives GitHub the first run it needs to list the workflow — `gh workflow
  run` answered 404 before it). `docs/CRON_INVENTORY.md` rewritten to match.
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
- **`resource_chain_meta` — a durable presence latch for pre-chain history**
  (#5598). One row per resource, created by the retention purge in the same
  statement that deletes the rows it attests to, by a daily pre-pass ahead of
  the retention boundary, and by a one-shot backfill over the existing estate.
  A row means "this resource DID have unchained (pre-#5566) history"; **no row
  means UNKNOWN, never "had none"**. Presence-only and monotonic — nothing may
  ever delete from it, which is the only reason the writer may consult it when
  choosing a genesis sentinel it will stamp permanently. No foreign key to
  `topics`: evidence about a resource's pre-history has to outlive the
  resource.
- **`src/lib/retention.ts`** (#5598) — a pure module (zero database imports)
  that owns the 30-day unchained-event retention bound and builds the SQL that
  enforces it. It is the seam that lets `pact-profile.ts` derive its
  advertisement without acquiring a database dependency.
- The chain verification report gains `hadUnchainedHistory`,
  `purgedUnchainedPriorEvents` and `historyEvidence` (#5598), so a zero
  `unchainedPriorEvents` can be read as "unknown" rather than "no prior
  history". The served profile gains a `provenance` block (hash algorithm,
  first sequence number, genesis sentinels, and explicit `false` for signed
  root and transparency anchor), derived from `provenance-chain.ts`.
- (placeholder — additions landing on `main` between dated releases will be listed here)

### Changed

- **Open registration behind a proof-of-work cost; design rate limits with
  or without Redis** (tailor-group#7). The no-Redis limiter used to clamp
  every window to 10% of design, which on the single-replica knowledge graph
  (no Redis provisioned) meant 12 reads/min and one registration an hour.
  The in-memory limiter now enforces the design limits per replica
  (`RATE_LIMIT_REPLICA_HINT` divides them for scale-out). The 3/hour-per-IP
  registration quota is gone: `POST /api/pact/register` answers `428` with a
  signed SHA-256 challenge (`REGISTRATION_POW_BITS`, default 20 ≈ 1 s CPU),
  accepts the solved nonce once, and keeps a 60/hour-per-address flood
  backstop plus an env-tunable daily circuit breaker
  (`MAX_DAILY_REGISTRATIONS`, default 500). Every authenticated PACT
  mutation now draws from the same 30/min per-key write window (`join`,
  `done`, `dependencies`, `verify`, `approve`/`reject`/`object`, `escalate`,
  `bounty`, `salience`, `constraints`, `intents` were unmetered). Python
  clients: `scripts/pact_pow.py`; the seed helpers use it and default to
  `https://pact.tailor.au`.
- **`retentionPolicy` is now DERIVED from the module that enforces it**
  (#5598). `/.well-known/pact.json` serves
  `{ minimumDays: 30, indefinite: false, tombstoneAfter: null }`, computed from
  `retention.ts`'s constants rather than typed beside them. The §6.3 declared
  gap was rewritten to state the real split — unchained rows hard-deleted (not
  tombstoned) after 30 days, chained rows retained indefinitely — with the day
  count interpolated from the enforcing constant.
- **The §6.4 declared gap was retired and replaced, not deleted** (#5598). It
  used to say the event log "assigns no gapless sequence number and no
  prev_hash", which #5566/#5587 made false. It now names the five shortfalls
  that remain: the permanently uncorrectable pre-marker `GENESIS`, and the fact
  that judging a `GENESIS` sentinel is no longer fully re-derivable from the
  public feed — the latch that refutes it is server-side and unpublished, so an
  external verifier evaluates a strictly weaker test and can miss a break this
  server would report, never invent one. The
  `CONFORMANCE_LEVEL` rationale dropped the same stale reason; the level itself
  does not move, held at `core` by the §15.2 shortfalls.
- (placeholder)

### Deprecated

- (placeholder)

### Removed

- (placeholder)

### Fixed

- **`GET /api/cron/auto-merge` names its failure** (tailor-group#9). The
  scheduled caller saw bare HTTP 500s every 30 minutes on 17–18 Sep with no
  log line saying which phase threw. The route now catches the sweep's error,
  logs it as a structured `cron.auto-merge.failed` entry (stderr → Log
  Analytics) and returns a generic `{ error: "Consensus sweep failed" }` 500 —
  no driver text on the wire (#2881).
- **The weekly CTH legislation sync fetched zero titles on every run**
  (tailor-group#7). `status` and `collection` are OData enums on
  `api.prod.legislation.gov.au`; the parser's
  `collection eq 'Act' and status eq 'InForce'` filter answered 400
  ("Could not find a property named 'InForce'"), which the loop recorded as
  a single error string with `docs_checked = 0` — below the silent-zero
  alarm's threshold — so the corpus never refilled. The filter now uses
  `status in ('InForce')` (verified live: 4,768 in-force Acts), paging is
  stable (`year desc,number desc`), a Titles-fetch failure counts as a
  parser crash, the ceiling is env-tunable (`CTH_SYNC_MAX_ACTS`, default
  50), and `cth-parser@2.1.0` is stamped on the sync log.
- **Retention no longer flips an honest §6.4 chain to "tampered"** (#5598).
  The verifier re-derived the expected genesis sentinel from a LIVE count of
  unchained rows, and the daily purge deletes exactly those rows — so a
  resource that honestly wrote `GENESIS-UNCHAINED` failed with
  `missing-genesis` once its unchained rows aged out, on a chain that was
  byte-identical and untampered. `GENESIS` and `GENESIS-UNCHAINED` are
  asymmetric claims and are now tested asymmetrically: `GENESIS` ("nothing
  preceded this chain") is refuted by any surviving row **or** the latch;
  `GENESIS-UNCHAINED` ("something preceded this chain") is unfalsifiable by
  absence and never breaks on history grounds. Third-party impact: the
  verifier has no production caller, so the only consumer of the old rule was
  an external verifier re-deriving it from `GET /api/pact/{topicId}/events` —
  see `docs/PROVENANCE_CHAIN.md`.
- **A purge before a resource's first chained append no longer writes a false
  full-history claim** (#5598). With every unchained row already deleted, the
  writer counted 0 and stamped plain `GENESIS` — "the chain covers this
  resource's entire history" — about a resource whose pre-history had just
  been destroyed, and it then verified intact, silently and permanently. The
  writer now reads the durable latch instead of a live count. Resources
  already in that state before the latch existed cannot be corrected:
  `prev_hash` is bound into `event_hash`, so rewriting the sentinel would be
  fabrication. That residue is declared as item (iv) of the §6.4 gap.
- **The served `retentionPolicy` was false in production** (#5598). It
  advertised `{ minimumDays: 0, indefinite: true }` over a daily
  `DELETE FROM events`. The guard meant to catch it read `src/lib/db.ts`
  looking for `DELETE FROM events` — a string that has never been in that file
  — so it passed green over a live purge for as long as both existed. Replaced
  with a derivation check against the enforcing constants, plus a new
  document/wire interlock asserting `PACT_CONFORMANCE.md` states no retention
  number that differs from the served policy.
- **Writer and verifier now ask the same question** (#5598). The writer's
  unchained-history count omitted the `sequence_number IS NULL` predicate the
  verifier applied. Latent and never yet wrong — the branch was guarded by an
  empty-chain-head check that made the two counts provably equal at that
  instant — but both paths now share one statement rather than two that could
  drift apart again.
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
