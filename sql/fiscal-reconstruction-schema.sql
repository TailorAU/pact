-- Fiscal reconstruction schema (#3053)
-- QLD Budget as a temporal knowledge-graph node on Source: nightly-reconstructed
-- General Government operating-statement lines + the pre-registered forecast.
--
-- Loaded at module init via _loadSqlStatements("fiscal-reconstruction-schema.sql")
-- and applied inside initSchema(), the same loader pattern as legislation-schema.sql
-- and curriculum-schema.sql. All statements idempotent (CREATE ... IF NOT EXISTS).
-- Dollar figures are NUMERIC (never float). Soft-delete via deprecated_at, never
-- hard delete. topic_id is an FK-by-convention to topics(id) (not enforced) so a
-- line can be written before its topic row is seeded.

-- Per-line reconstruction: one row per operating-statement line per fiscal year.
CREATE TABLE IF NOT EXISTS fiscal_line (
  id                  TEXT PRIMARY KEY,
  line_key            TEXT NOT NULL,
  fiscal_year         TEXT NOT NULL,
  jurisdiction        TEXT NOT NULL DEFAULT 'QLD',
  authority           TEXT NOT NULL DEFAULT 'QLD Treasury',
  title               TEXT NOT NULL,
  reconstructed_value NUMERIC,
  audited_value       NUMERIC,
  err_pct             NUMERIC,
  method              TEXT NOT NULL,
  source_feed         TEXT NOT NULL,
  verdict             TEXT NOT NULL DEFAULT 'feed' CHECK (verdict IN ('automate','anchor','feed')),
  source_ref          TEXT,
  derived_from        JSONB NOT NULL DEFAULT '[]',
  limitations         JSONB NOT NULL DEFAULT '[]',
  topic_id            TEXT,
  deprecated_at       TIMESTAMPTZ,
  superseded_by       TEXT,
  retrieved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (line_key, fiscal_year)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_line_year ON fiscal_line (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_fiscal_line_verdict ON fiscal_line (verdict);
CREATE INDEX IF NOT EXISTS idx_fiscal_line_active ON fiscal_line (line_key) WHERE deprecated_at IS NULL;

-- Pre-registered forecast vector + confidence-over-time + scores.
-- The forecast node carries a confidence that rises as the official release nears;
-- on budget release the actual is recorded and accuracy_score computed.
CREATE TABLE IF NOT EXISTS fiscal_forecast (
  id                  TEXT PRIMARY KEY,
  line_key            TEXT NOT NULL,
  fiscal_year         TEXT NOT NULL,
  forecast_value      NUMERIC NOT NULL,
  forecast_low        NUMERIC,
  forecast_high       NUMERIC,
  confidence          NUMERIC,
  confidence_history  JSONB NOT NULL DEFAULT '[]',
  model_version       TEXT NOT NULL,
  lock_hash           TEXT NOT NULL,
  locked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actual_value        NUMERIC,
  accuracy_score      NUMERIC,
  derived_from        JSONB NOT NULL DEFAULT '[]',
  limitations         JSONB NOT NULL DEFAULT '[]',
  retrieved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (line_key, fiscal_year)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_forecast_year ON fiscal_forecast (fiscal_year);

-- Per-run audit log (mirrors legislation_sync_log + WS9 augment columns).
CREATE TABLE IF NOT EXISTS fiscal_sync_log (
  id               TEXT PRIMARY KEY,
  jurisdiction     TEXT NOT NULL DEFAULT 'QLD',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  feeds_fetched    JSONB NOT NULL DEFAULT '[]',
  lines_checked    INTEGER NOT NULL DEFAULT 0,
  lines_written    INTEGER NOT NULL DEFAULT 0,
  model_version    TEXT,
  anomaly_count    INTEGER NOT NULL DEFAULT 0,
  crash_count      INTEGER NOT NULL DEFAULT 0,
  silent_zero_flag BOOLEAN,
  errors           JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_fiscal_sync_log_completed ON fiscal_sync_log (jurisdiction, completed_at DESC NULLS LAST)
