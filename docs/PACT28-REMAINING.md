# pact#28 — remaining asks (3, 5, 6): pointers for the next agent

Status note for [TailorAU/pact#28](https://github.com/TailorAU/pact/issues/28)
("Tailor Living Document consumer requirements — citation ownership").

Shipped in this delivery:

- **Ask 1** — `scripts/seed_workplace_testing_standards.py` (AS/NZS 4308:2008,
  AS/NZS 4760:2019, AS 3547:2019, ISO 45001:2018 as institutional topics +
  context-topic dependency edges; metadata only, operator-run, idempotent).
- **Ask 2** — designation-aware search + exact-title ranking:
  `src/lib/legislation-ranking.ts` (pure primitives + unit tests) wired into
  `src/app/api/axiom/legislation/search/route.ts` (title-tier dominance,
  designation tokens, exact-title-first SQL fetch window).
- **Ask 4** — `GET /api/axiom/resolve?citation=…`:
  `src/app/api/axiom/resolve/route.ts` + `src/lib/citation.ts` (parser),
  documented in `public/openapi.json`. Never-fuzzy contract; 404-style miss
  with `citation_not_resolved` / `citation_ambiguous`.

NOT shipped (deliberately deferred). Precise pointers below so the next agent
lands them fast.

---

## Ask 3 — Privacy Act 1988 (Cth) ingestion

The Privacy Act is referenced constantly by consumers (and by other docs'
body text — the very noise ask 2 had to outrank) but is not in
`legislation_docs`.

- **Where ingestion lives:** admin bulk-ingest endpoint
  `POST /api/axiom/legislation/ingest`
  (`src/app/api/axiom/legislation/ingest/route.ts`, `X-Admin-Key` /
  `ADMIN_SECRET`, body shape documented in the route header — canonical doc
  id, jurisdiction, sections with real `sectionId`s like `"s 302"`).
- **Script pattern to copy:** `scripts/seed_cth_nsw_legislation.py` — already
  ingests CTH acts (e.g. `cth/act-2011-137` WHS Act) with canonical section
  IDs and summarised content. Add a `cth/act-1988-119` document ("Privacy Act
  1988", `jurisdiction: "CTH"`). Sibling examples:
  `scripts/seed_qld_legislation.py`, `scripts/seed_sa_tas_legislation.py`.
- **Prefer real section IDs over chunks:** ingest s 6 (interpretation),
  s 6C/6D (organisation / small business operator), s 13 (interferences with
  privacy), s 15 (APP compliance), Schedule 1 (the 13 APPs, one section row
  per APP is the useful granularity for citation consumers). Real
  `sectionId`s make ask-4's `sectionRef` resolution exact instead of
  chunk-marker-based.
- **Ongoing currency:** the scheduled sync lives at
  `src/app/api/cron/legislation-sync/route.ts` → `src/lib/legislation-sync.ts`
  → per-jurisdiction parsers in `src/lib/parsers/cth-parser.ts` (and
  `qld-parser.ts`). If the Privacy Act should track amendments automatically,
  add it to the CTH parser's doc set; otherwise the one-shot ingest script is
  enough to unblock consumers.
- **Content rule:** summarised/structured content for agent consumption (the
  existing scripts' convention) — Commonwealth legislation text itself is
  public, but keep the summarisation convention for consistency.

## Ask 5 — richer section addressing

Live rows for scraped docs store `section_id` values like `"chunk-1"` —
citation consumers want `s 6(1)`-grade addressing.

- **Where chunking happens:** the sync parsers
  (`src/lib/parsers/cth-parser.ts`, `src/lib/parsers/qld-parser.ts`) and the
  ingest payloads produced by `scripts/seed_*_legislation.py`. The schema
  itself needs NO migration — `legislation_sections.section_id` is free text
  and `parent_section` / `depth` already exist
  (`sql/legislation-schema.sql`).
- **What would change:**
  1. Parser/chunker: split scraped text on section-heading markers
     (`(^|\n)\s*(\d+[A-Z]{0,3})\s+<Title>` — the same marker regex family
     used by the resolve route's chunk verification in
     `src/app/api/axiom/resolve/route.ts`) and emit one row per section with
     `section_id = "s <n>"`, keeping `parent_section` for Parts/Divisions.
  2. Backfill: a one-shot re-chunk script over existing `chunk-N` docs
     (operator-run against Neon, ADMIN_SECRET ingest re-POST is the safe
     path — the ingest route upserts by doc id).
  3. Consumers that get better for free: the `section/[sectionId]` fuzzy
     lookup (`src/app/api/axiom/legislation/section/[sectionId]/route.ts`),
     ask-4 `sectionRef` (its exact-section_id branch starts hitting), and
     `cross_references`.
- **Subsection addressing** (`s 6(1)` below section level): would need either
  a `subsection` column or marker-offset metadata in `notes` — decide when a
  consumer actually needs sub-section anchors; `sectionRef` currently
  resolves to the containing section/chunk which is what Tailor's Living
  Document consumer (#4007) needs first.

## Ask 6 — currency / version metadata (`asAt`)

Consumers want "is this citation current, as at when?".

- **Where the data already exists:** `legislation_docs.in_force_date`,
  `last_amended_date`, `repealed_date` (`sql/legislation-schema.sql`; already
  surfaced by `GET /api/axiom/legislation/{id}` and used for ask-4's
  `inForce`). Per-section: `legislation_sections.status`
  (`in_force|repealed|not_yet_commenced`) and `amended_by`.
- **Where fresh values come from:** the legislation-sync cron
  (`src/app/api/cron/legislation-sync/route.ts` → `src/lib/legislation-sync.ts`),
  which stamps runs into `legislation_sync_log` (incl. `parser_version`,
  `completed_at`). `scripts/monitor_legislation_updates.py` is the
  out-of-band watcher.
- **What to add:**
  1. A `verifiedAsAt` field on search/resolve responses = the doc's last
     successful sync (`legislation_sync_log.completed_at` for the doc's
     jurisdiction, or `legislation_docs.created_at` fallback). No schema
     change needed for v1.
  2. Optionally a `point_in_time`/`version` column on `legislation_docs` if
     historical versions are ever stored — today the table holds current
     consolidations only, so an `asAt=<date>` QUERY parameter cannot be
     honoured and should 400/`not_supported` rather than silently answering
     from the current version.
  3. Wire into ask-4: extend the resolve response with
     `{ verifiedAsAt, lastAmendedDate }` — both already selected in the
     route's doc query (`in_force_date`, `repealed_date`) or one column away.
