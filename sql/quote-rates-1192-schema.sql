-- 1192 chunk A: Quote-rates schema for Traide integration
--
-- Adds an item-key abstraction over market.products + market.price_observations
-- so consumers (Traide and other Source clients) can request canonical material
-- rates by stable key, without retailer-specific knowledge.
--
-- Read path: GET /api/market/quote-rates?items=k1,k2,...
-- Write path: chunk B will land the price_observation_mining work type and
-- consensus validator that populates market.price_observations.

-- ── Hardware retailers ───────────────────────────────────────────
-- Bunnings is already seeded in phase-0-timescaledb-setup.sql.
-- Add the trade-supply retailers needed for v1 quote coverage.
INSERT INTO market.retailers (name, slug, base_url, affiliate_network) VALUES
    ('Mitre 10',         'mitre-10',       'https://www.mitre10.com.au',         NULL),
    ('Reece',            'reece',          'https://www.reece.com.au',           NULL),
    ('Beaumont Tiles',   'beaumont-tiles', 'https://www.beaumont-tiles.com.au',  NULL),
    ('Tradelink',        'tradelink',      'https://www.tradelink.com.au',       NULL)
ON CONFLICT (slug) DO NOTHING;

-- ── Item-key catalog ─────────────────────────────────────────────
-- Stable keys consumed by Traide's TRADE_TEMPLATES. Each key fixes
-- the unit (m², lm, L, item, kg) and a sanity range used by the
-- chunk-B validator to reject outlier submissions.
CREATE TABLE IF NOT EXISTS market.item_key_mapping (
    item_key            TEXT PRIMARY KEY,
    description         TEXT NOT NULL,
    unit                TEXT NOT NULL,
    category            TEXT NOT NULL,
    jurisdiction        TEXT NOT NULL DEFAULT 'AU',
    sanity_min_cents    INTEGER,
    sanity_max_cents    INTEGER,
    notes               TEXT,
    deprecated_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_item_key_category
    ON market.item_key_mapping (category)
    WHERE deprecated_at IS NULL;

-- ── Item-key → Product links (per retailer, per tier) ────────────
-- Curator-maintained mapping of "this product satisfies this key at this
-- retailer at this tier." Multiple links per (item_key, retailer) allowed
-- to support budget/standard/premium tiers (refinement layer in Traide).
-- Agents observe prices on the linked product; chunk B's consensus runs
-- over price values for the same (product_id, retailer_id) pair.
CREATE TABLE IF NOT EXISTS market.item_key_product_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_key        TEXT NOT NULL REFERENCES market.item_key_mapping(item_key),
    retailer_id     UUID NOT NULL REFERENCES market.retailers(id),
    product_id      UUID NOT NULL REFERENCES market.products(id),
    tier            TEXT NOT NULL DEFAULT 'standard'
                    CHECK (tier IN ('budget', 'standard', 'premium')),
    is_canonical    BOOLEAN NOT NULL DEFAULT true,
    curator_notes   TEXT,
    deprecated_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_key, retailer_id, product_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_market_item_key_links_lookup
    ON market.item_key_product_links (item_key, retailer_id)
    WHERE deprecated_at IS NULL AND is_canonical;

CREATE INDEX IF NOT EXISTS idx_market_item_key_links_product
    ON market.item_key_product_links (product_id, retailer_id)
    WHERE deprecated_at IS NULL;

-- ── 14 v1 item keys ──────────────────────────────────────────────
-- Material-only retail rates. Sanity ranges are wide on purpose; the
-- consensus validator narrows them via cluster-of-N submissions.
INSERT INTO market.item_key_mapping
    (item_key, description, unit, category, sanity_min_cents, sanity_max_cents, notes) VALUES
    ('wall-tile-porcelain',         '600x600 porcelain wall tile',                 'm²',   'tiling',     1000,   30000,  'Mid-range glazed porcelain'),
    ('floor-tile-porcelain',        '600x600 porcelain floor tile',                'm²',   'tiling',     1000,   30000,  'Standard rectified floor tile'),
    ('waterproofing-membrane',      'Wet-area waterproofing membrane',             'm²',   'tiling',     500,    20000,  'Davco / Ardex equivalent'),
    ('grout-floor',                 'Floor grout per kit',                         'item', 'tiling',     500,    8000,   'Davco TileGrout 1.5kg or equivalent'),
    ('silicone-sealant',            'Sanitary-grade silicone, single tube',        'item', 'tiling',     500,    3000,   'Selleys or equivalent'),
    ('interior-paint-low-sheen',    'Dulux Wash & Wear Low Sheen or equivalent',   'L',    'paint',      1500,   12000,  'Premium interior paint'),
    ('ceiling-paint-flat',          'Flat ceiling paint',                          'L',    'paint',      1000,   8000,   'Standard ceiling white'),
    ('paint-primer',                'All-purpose primer',                          'L',    'paint',      1000,   10000,  'Multi-surface primer'),
    ('treated-pine-90x45',          'Treated pine framing 90x45',                  'lm',   'timber',     400,    2500,   'H2 / H3 treated'),
    ('hardwood-decking-90x19',      'Hardwood decking 90x19',                      'lm',   'timber',     800,    6000,   'Merbau or equivalent'),
    ('colorbond-roof-sheet',        'Colorbond corrugated roof sheet',             'm²',   'roofing',    2000,   15000,  '0.42mm BMT'),
    ('ridge-cap-colorbond',         'Colorbond ridge cap',                         'lm',   'roofing',    1500,   8000,   'Standard 12-30 deg pitch'),
    ('plasterboard-10mm',           'Standard 10mm plasterboard sheet',            'm²',   'plaster',    500,    5000,   '1200x2400 standard sheet'),
    ('skirting-mdf-pre-primed',     'Pre-primed MDF skirting',                     'lm',   'finishing',  300,    3000,   '67mm or 92mm pre-primed')
ON CONFLICT (item_key) DO NOTHING;
