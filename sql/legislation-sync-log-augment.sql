-- Legislation sync-log augmentation — WS9 (parser hardening + silent-zero alarm).
-- Idempotent: every statement is ALTER TABLE ... ADD COLUMN IF NOT EXISTS so the
-- file is safe to re-run on every cold start. Applied at startup by initSchema()
-- in sites/source/src/lib/db.ts after the base legislation schema loads.
--
-- Background: the audit found CTH last_amended_date stuck at 2024-12-01 and QLD
-- at 2024-10-01 — months stale — but legislation_sync_log showed docs_updated=0
-- with no errors raised. Root cause was indistinguishable in the log: parser
-- silent-drop vs upstream API returning no new amendments looked identical.
--
-- The three new columns make the two cases distinguishable going forward:
--   silent_zero_flag   — TRUE iff docs_checked > 0 AND docs_updated = 0
--                        AND parser_anomaly_count > 0. Set in code at sync end.
--                        TRUE means "ran but parsed nothing usable" — actionable.
--                        FALSE/NULL means "ran cleanly, found no new amendments"
--                        — still expected to surface via #1401 freshness probe.
--   parser_version     — Free-form string like "cth-parser@2.0.0". Stamped by the
--                        parser itself. Bumped when a parser changes semantics so
--                        a future regression can be tied back to a specific
--                        parser version. NULL on existing rows (no backfill).
--   parser_crash_count — Number of per-act exceptions caught during the run.
--                        Distinct from `errors` (free text); this is a numeric
--                        counter that downstream alarms can threshold cheaply.

ALTER TABLE legislation_sync_log
  ADD COLUMN IF NOT EXISTS silent_zero_flag BOOLEAN;

ALTER TABLE legislation_sync_log
  ADD COLUMN IF NOT EXISTS parser_version TEXT;

ALTER TABLE legislation_sync_log
  ADD COLUMN IF NOT EXISTS parser_crash_count INTEGER NOT NULL DEFAULT 0;

-- Optional integer column used to count per-doc parse anomalies (e.g. zero
-- sections returned, fallback chunker invoked, version metadata missing).
-- Mirrors parser_crash_count's shape so both telemetry counters live as
-- first-class columns rather than being buried in JSON `errors`.
ALTER TABLE legislation_sync_log
  ADD COLUMN IF NOT EXISTS parser_anomaly_count INTEGER NOT NULL DEFAULT 0;

-- No backfill: existing rows keep silent_zero_flag = NULL, parser_version = NULL,
-- and the *count* columns get the default of 0. The dashboard view (future WS)
-- treats NULL silent_zero_flag as "pre-WS9, unknown" and surfaces it as
-- not-actionable rather than green.
