-- Legislation reviewed-document marker augmentation — tailor-group#35.
-- Idempotent: every statement is ALTER TABLE ... ADD COLUMN IF NOT EXISTS so the
-- file is safe to re-run on every cold start. Applied at startup by initSchema()
-- in src/lib/db.ts after the base legislation schema loads, so databases created
-- before legislation-schema.sql carried these columns get them at boot.
--
-- Background: replaceLegislationDocuments upserts legislation_docs, deletes the
-- document's legislation_sections and re-inserts the caller's sections, and
-- nothing recorded which documents a human had reviewed. A scheduled QLD sync
-- whose KEY_ACTS overlapped a reviewed document therefore replaced the reviewed
-- sections with parser output on its next run.
--
-- The two columns make a reviewed document durable:
--   reviewed_at  — TIMESTAMPTZ, set to NOW() only by the admin ingest route
--                  (POST /api/axiom/legislation/ingest, X-Admin-Key). NULL means
--                  the document has never been through the reviewed path.
--   review_hash  — TEXT, lowercase SHA-256 hex of the normalized document as
--                  compact JSON with code-point-sorted keys, computed server-side
--                  from the normalized document (reviewHashForDocument in
--                  src/lib/legislation-ingest.ts). Equals the canonical read's
--                  legislation-payload-v1 digest when relatedDocs is explicit.
--
-- The scheduled syncs (source "scheduled") and the PACT proposal finalizer
-- (source "proposal") select the batch's ids WHERE reviewed_at IS NOT NULL
-- before writing, exclude them from every statement and report them as
-- skipped; their ON CONFLICT upsert never names either column, so an existing
-- marker survives. Only a later reviewed ingest replaces and re-stamps.

ALTER TABLE legislation_docs
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE legislation_docs
  ADD COLUMN IF NOT EXISTS review_hash TEXT;

-- No backfill: existing rows keep reviewed_at = NULL / review_hash = NULL until
-- the admin ingest route writes them. A NULL marker is "not reviewed here";
-- the guard only protects rows the reviewed path has stamped.
