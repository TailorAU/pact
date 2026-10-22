-- Fiscal compute meter (#3053 follow-up) — the cost side of the EV/AV story.
-- Idempotent ALTERs + one new table. Loaded after fiscal-reconstruction-schema.sql
-- via _loadSqlStatements + initSchema spread.
--
-- Two distinct cost surfaces, kept separate so an ESTIMATE is never shown as MEASURED:
--  1. fiscal_sync_log per-run token columns — MEASURED cost of each nightly cron run
--     (tiny: the cron is a deterministic upsert, no LLM call, but real and metered).
--  2. fiscal_compute_ledger — the one-time exercise cost (reconstruction + research +
--     build). Subagent tokens are exact; main-thread + energy are estimates. Flagged.

-- Per-run token/cost columns on the existing audit log (idempotent).
ALTER TABLE fiscal_sync_log ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE fiscal_sync_log ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE fiscal_sync_log ADD COLUMN IF NOT EXISTS cost_usd NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE fiscal_sync_log ADD COLUMN IF NOT EXISTS kwh NUMERIC NOT NULL DEFAULT 0;

-- One-time / cumulative exercise compute ledger.
-- kind: 'exercise' (the one-time build/research) | 'cron_cumulative' (rolled-up nightly runs).
-- basis: 'measured' | 'estimated' — never conflate the two.
CREATE TABLE IF NOT EXISTS fiscal_compute_ledger (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'exercise' CHECK (kind IN ('exercise','cron_cumulative')),
  basis           TEXT NOT NULL DEFAULT 'estimated' CHECK (basis IN ('measured','estimated')),
  total_tokens    BIGINT NOT NULL DEFAULT 0,
  measured_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd        NUMERIC NOT NULL DEFAULT 0,
  kwh             NUMERIC NOT NULL DEFAULT 0,
  kwh_low         NUMERIC,
  kwh_high        NUMERIC,
  assumptions     JSONB NOT NULL DEFAULT '{}',
  human_compare   JSONB NOT NULL DEFAULT '{}',
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
