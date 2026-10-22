-- 1216 chunk B: price_observation_mining work type
--
-- Adds the defect table for outlier / cold-start submissions.
-- The work type itself needs no schema change — agent_work_assignments.work_type
-- is a free TEXT field (no enum/CHECK constraint).
--
-- See:
--   - sites/source/src/lib/work/validators.ts (validator implementation)
--   - sites/source/src/app/api/work/submit/route.ts (post-validation hook
--     inserts market.price_observations + market.item_key_product_links + this defects table)
--   - sites/source/src/app/api/cron/quote-rates-assignments/route.ts (daily generator)
--
-- Idempotent: every statement is CREATE IF NOT EXISTS. Safe to re-run.

CREATE TABLE IF NOT EXISTS market.price_observation_defects (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_key              TEXT NOT NULL REFERENCES market.item_key_mapping(item_key),
    retailer_id           UUID NOT NULL REFERENCES market.retailers(id),
    submitted_by          TEXT NOT NULL,
    assignment_id         TEXT,
    finding_kind          TEXT NOT NULL
                          CHECK (finding_kind IN (
                              'outlier_price',
                              'sanity_range',
                              'unit_mismatch',
                              'url_invalid',
                              'cold_start'
                          )),
    submitted_price_cents INTEGER,
    submitted_unit        TEXT,
    product_url           TEXT,
    reason                TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'accepted', 'dismissed')),
    resolved_by           TEXT,
    resolved_at           TIMESTAMPTZ,
    potential_credits     INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_price_defects_item_retailer
    ON market.price_observation_defects (item_key, retailer_id);
CREATE INDEX IF NOT EXISTS idx_market_price_defects_status
    ON market.price_observation_defects (status);
CREATE INDEX IF NOT EXISTS idx_market_price_defects_submitter
    ON market.price_observation_defects (submitted_by);
