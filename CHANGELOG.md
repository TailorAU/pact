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
  the `prod` environment's `CRON_SECRET` (the same secret `cd-kg.yml`
  deploys; every job declares `environment: prod` to read it).
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

- **A scheduled legislation sync can no longer overwrite a human-reviewed
  document** (tailor-group#35). `replaceLegislationDocuments` upserts
  `legislation_docs`, deletes the document's sections and re-inserts the
  caller's, and nothing recorded which documents a person had reviewed — so
  a scheduled QLD run whose `KEY_ACTS` overlapped a reviewed document (the
  "Planning Act 2016 destroyed by a re-run" regression) replaced the reviewed
  sections with parser output. `legislation_docs` gains `reviewed_at
  TIMESTAMPTZ` and `review_hash TEXT` (SHA-256 hex of the normalized
  document, computed server-side; equal to the canonical read's
  `legislation-payload-v1` digest when `relatedDocs` is explicit), in
  `sql/legislation-schema.sql` and as an idempotent boot-time augment
  (`sql/legislation-reviewed-augment.sql`) so existing databases get the
  columns. `replaceLegislationDocuments` and `ingestDocuments` now take an
  explicit source with no default: the admin `X-Admin-Key` ingest route is
  `reviewed` and stamps both columns on every document it writes; the CTH/QLD
  parsers are `scheduled` and the PACT proposal finalizer is `proposal`, and
  both exclude every marked document from every statement and return it as
  `skipped`, which the syncs record as `Skipped <id>: reviewed document
  (reviewed_at <iso>)` and count as parser anomalies (`docsUpdated` counts
  only written documents). The whole write is one transaction on one
  connection (`withTransaction`) that first locks the batch's existing rows
  (`SELECT … FOR UPDATE`, one fixed order) and reads the marker from the
  locked rows, so a concurrent reviewed write on the same documents
  serialises behind it or ahead of it and is never overwritten (Cursor
  Bugbot on pact#78: the earlier unlocked pre-select on a pooled connection
  let a marker stamped between it and the batch be replaced). Their upsert
  never assigns the marker columns and updates only while `reviewed_at IS
  NULL`, their section and relation statements are conditional the same way,
  and a marker read after the batch reports a document inserted and marked by
  a concurrent reviewed write (nothing existed to lock) as `skipped` rather
  than written. Real-Postgres canaries in
  `src/lib/legislation-reviewed-guard.itest.ts` pin both races and the
  mirrored one. A proposal whose one document was skipped still fails
  closed: the topic opens for debate, never `consensus`. `reviewed` is an
  assertion the caller makes, not a property of the route: the admin route
  writes as `reviewed` only when the request carries
  `X-Ingest-Source: reviewed`, which `scripts/run_reviewed_legislation_ingest.py`
  sends after binding the payload to an exact entry of
  `scripts/reviewed_legislation_builders.json`; an admin POST without it is
  `admin`, guarded like `scheduled` (never stamps, skips marked ids, reports
  them as `skipped` in its response), and any other header value is a 400.
  That matters because the deploy-time seeds in `cd-kg.yml` hit the admin
  route on every deploy, and `scripts/seed_seq_planning_regime.py` among them
  live-scrapes `qld/act-2016-025` — the Planning Act 2016 the issue names,
  which `KEY_ACTS` never touched: the actual re-run that destroyed it was the
  deploy, and it now skips the document once a reviewed ingest has marked it.
  The reviewed manifest is present at
  `scripts/reviewed_legislation_builders.json` (12 reviewed ids: one QLD,
  `qld/act-2016-025`, and 11 `cth/*`; the builder and batch files it pins
  are not in this repository), with the dispatcher, runner and contract
  beside it and tested by `pr-check.yml`. `KEY_ACTS` was compared against it
  and overlaps nothing (its nine acts map to `qld/act-1999-039`, `-1999-040`,
  `-2011-018`, `-1971-047`, `-1994-062`, `-2016-010`, `-1999-019`,
  `-2003-013`, `-2007-016`); of the CTH entries only `cth/act-1999-050` has
  an id the CTH sync can mint. Neither list overlaps a deploy-time seed, so
  no weekly skip anomaly is expected today. `review_hash` uses the manifest's
  recipe (compact JSON, sorted keys, UTF-8) and is intended to equal its
  `normalizedPayloadSha256`, which the contract already calls `review_hash`;
  equality could not be executed here because the pinned builders are
  absent. `docs/REVIEWED_LEGISLATION_INGEST.md` carries a dated note on what
  of the runbook is here and what was retired by tailor-app#5954. Unit
  suites pin the skip (no DELETE/INSERT for the marked id, the other
  documents written), the reviewed re-stamp, the untouched marker on a
  scheduled or admin upsert, the unasserted admin POST that skips a marked
  id, the exact reviewed envelope, the 400 on an unknown header and the
  fail-closed proposal; the runner's tests pin that it sends the assertion.
- **`GET /api/cron/legislation-sync` no longer dies in the proxy**
  (tailor-group#38). `pact.tailor.au` is served by the tailor-app frontend,
  which proxies every path to `pact-web` through a Next.js rewrite with a
  30 s `proxyTimeout`; the synchronous sync took 31 s at `CTH_SYNC_MAX_ACTS=3`
  and minutes at the default, so every scheduled run ended as a bare
  `500 Internal Server Error` with no application headers while the work
  ran on unobserved. The route now starts the sync detached under a Postgres
  advisory lock (`LEGISLATION_SYNC_LOCK_KEY = 542502`, held on one dedicated
  pooled connection for the whole run — single flight across replicas, no
  Redis needed) and answers `202 { started, jobId, startedAt, jurisdictions }`
  at once, or `202 { started: false, running: true, jurisdictions }` when a
  run already holds the lock; `?wait=1` keeps the synchronous 200 under the
  same lock, so it answers that 202 too while a run holds it. A sync that
  throws is logged as `cron.legislation-sync.failed` and releases the lock.
  New `GET /api/cron/legislation-sync/status` reports `running` (the lock,
  read from `pg_locks`) and the latest `legislation_sync_log` row per
  jurisdiction; `cron.yml` polls it every 30 s, to a 27-minute wall-clock
  deadline, until every targeted jurisdiction's row is at least as new as
  the trigger and completed, printing one summary line each, and fails at
  the first poll that finds the lock released without such a row. The
  helper (`src/lib/detached-jobs.ts`) is generic so the other long jobs can
  follow. Unit suites for the helper and both routes.
- **The weekly CTH legislation sync never wrote a document** (tailor-group#37).
  After tailor-group#7 the parser reached the Acts (10 checked, 0 anomalies)
  and then every ingest batch failed with "Legislation payload validation
  failed": an amending Act's schedule amends one section of the principal Act
  several times (s 308 five times in `cth/act-2026-082`), `parseActHtml`
  emits one section per heading, and `normalizeLegislationDocuments` rejects
  repeated section ids — for the whole five-document batch, in one
  transaction. Newest-first paging makes amending Acts the majority of every
  batch, so the live graph had CTH = 0. Two changes: both parsers now pass
  their sections through one shared `uniqueSectionIds` rule (first
  occurrence unchanged, later ones `s 308 [2]`, `s 308 [3]`, …; nothing
  dropped, order kept), and `ingestDocuments` validates each document on
  its own, writes the valid ones together and returns the rejected ones,
  which the sync records as `Rejected <id>: <path> <message>` and counts as
  parser anomalies; `docsUpdated` now counts only documents actually
  written. Stamps `cth-parser@2.2.0` / `qld-parser@1.6.0`. Verified live on
  21 Sep 2026 with `CTH_SYNC_MAX_ACTS=3` (the ceiling rounds up to one page
  of 10): docsChecked 10, docsUpdated 10, 147 sections, no errors. The
  single-document PACT proposal path (`finalizeApprovedTopic`) stays
  fail-closed: because `ingestDocuments` now returns a rejection instead of
  throwing, the finalizer throws itself when its one document was not
  written, so the savepoint catch opens the topic for debate as before and
  a rejected proposal is never promoted to 'consensus' or reported as
  `pact.legislation.ingested`. A suffixed id is a storage key, not a
  pinpoint: `isCitableSectionId` now rejects a trailing ` [n]`, so
  `GET /api/axiom/legislation/search` serves `s 308 [2]` as
  `sectionKind: "extract"` with the document-level `sourceRef` instead of
  `"<Act> s 308 [2]"`; the bare `s 308` stays a pinpoint. `syncQld` is
  pinned by a new test in the same shape as the `syncCth` one.
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
