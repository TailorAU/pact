-- Phase-0 retailer half — minimal subset to unblock #1192 chunk A on prod
--
-- Background: prod source-pg-prod has the fuel half of phase-0
-- (fuel_brands, fuel_prices, fuel_stations, fuel_types, latest_fuel_prices)
-- but NOT the retailer half (retailers, products, price_observations, etc.)
-- which #1192 chunk A depends on. This migration backfills the minimum subset.
--
-- Differences from phase-0-timescaledb-setup.sql:
--   * Skips extension installs (timescaledb / pg_cron / pg_trgm need server-level
--     config + restart; not in scope for this migration).
--   * price_observations is a regular table, not a TimescaleDB hypertable.
--     Convertible later via SELECT create_hypertable(..., migrate_data => true)
--     once timescaledb is enabled at the server level.
--   * Skips name_trgm GIN indexes (depend on pg_trgm extension); regular B-tree
--     used instead.
--   * Skips manufacturer_evidence, affiliate_conversions, agents,
--     agent_contributions, product_reviews, retailer_accounts, search_events
--     — none required by chunk A.
--   * latest_prices materialised view created without pg_cron auto-refresh
--     (chunk A queries the underlying table directly via LATERAL; the MV is
--     present so existing /api/market/products/* routes that reference it
--     also start working after this migration).
--
-- Idempotent: every statement is CREATE IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- Safe to re-run.

-- Schema (exists already on prod, but defensive)
CREATE SCHEMA IF NOT EXISTS market;

-- ── Retailers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market.retailers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL UNIQUE,
    base_url          TEXT NOT NULL,
    affiliate_network TEXT,
    affiliate_tag     TEXT,
    logo_url          TEXT,
    active            BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO market.retailers (name, slug, base_url, affiliate_network) VALUES
    ('Coles',             'coles',          'https://www.coles.com.au',             'Commission Factory'),
    ('Woolworths',        'woolworths',     'https://www.woolworths.com.au',        'Commission Factory'),
    ('Amazon AU',         'amazon-au',      'https://www.amazon.com.au',            'Amazon Associates'),
    ('IGA',               'iga',            'https://www.iga.com.au',               NULL),
    ('Chemist Warehouse', 'chemist-wh',     'https://www.chemistwarehouse.com.au',  'Commission Factory'),
    ('Bunnings',          'bunnings',       'https://www.bunnings.com.au',          NULL),
    ('Kmart',             'kmart',          'https://www.kmart.com.au',             'Commission Factory'),
    ('Big W',             'bigw',           'https://www.bigw.com.au',              'Impact'),
    ('eBay AU',           'ebay-au',        'https://www.ebay.com.au',              'eBay Partner Network'),
    ('Target',            'target',         'https://www.target.com.au',            'Commission Factory'),
    ('Mitre 10',          'mitre-10',       'https://www.mitre10.com.au',           NULL),
    ('Reece',             'reece',          'https://www.reece.com.au',             NULL),
    ('Beaumont Tiles',    'beaumont-tiles', 'https://www.beaumont-tiles.com.au',    NULL),
    ('Tradelink',         'tradelink',      'https://www.tradelink.com.au',         NULL)
ON CONFLICT (slug) DO NOTHING;

-- ── Manufacturers (minimal — products references this) ─────────────
CREATE TABLE IF NOT EXISTS market.manufacturers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    country             TEXT,
    factory_city        TEXT,
    factory_country     TEXT,
    abn                 TEXT,
    acn                 TEXT,
    gs1_prefix          TEXT,
    verification_level  TEXT NOT NULL DEFAULT 'Inferred'
                        CHECK (verification_level IN ('Inferred', 'Corroborated', 'Confirmed', 'Audited')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_manufacturers_gs1
    ON market.manufacturers (gs1_prefix) WHERE gs1_prefix IS NOT NULL;

-- ── Products ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market.products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ean             TEXT UNIQUE,
    name            TEXT NOT NULL,
    brand           TEXT,
    category        TEXT,
    subcategory     TEXT,
    unit_of_measure TEXT,
    unit_size       NUMERIC,
    image_url       TEXT,
    manufacturer_id UUID REFERENCES market.manufacturers(id),
    origin_country  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_products_ean ON market.products (ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_products_category ON market.products (category);
CREATE INDEX IF NOT EXISTS idx_market_products_brand ON market.products (brand);
CREATE INDEX IF NOT EXISTS idx_market_products_manufacturer ON market.products (manufacturer_id);
-- Regular B-tree on name (pg_trgm GIN deferred until extension is installed)
CREATE INDEX IF NOT EXISTS idx_market_products_name ON market.products (name);

-- ── Price Observations (regular table, not hypertable) ─────────────
-- When timescaledb is later enabled at the server level, convert via:
--   SELECT create_hypertable('market.price_observations', 'observed_at',
--                            migrate_data => true, if_not_exists => true);
CREATE TABLE IF NOT EXISTS market.price_observations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       UUID NOT NULL REFERENCES market.products(id),
    retailer_id      UUID NOT NULL REFERENCES market.retailers(id),
    price_cents      INTEGER NOT NULL,
    was_price_cents  INTEGER,
    unit_price_cents INTEGER,
    unit_price_unit  TEXT,
    in_stock         BOOLEAN NOT NULL DEFAULT true,
    product_url      TEXT NOT NULL,
    delivery_cents   INTEGER,
    promotion_text   TEXT,
    observed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_prices_product
    ON market.price_observations (product_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_prices_retailer
    ON market.price_observations (retailer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_prices_product_retailer
    ON market.price_observations (product_id, retailer_id, observed_at DESC);

-- ── latest_prices materialised view ─────────────────────────────────
-- Chunk A queries the underlying table via LATERAL; this MV exists so the
-- pre-existing /api/market/products/* routes that reference it also work.
-- No pg_cron schedule (extension not installed). Refresh manually:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY market.latest_prices;
-- A future migration can add pg_cron + the schedule.
CREATE MATERIALIZED VIEW IF NOT EXISTS market.latest_prices AS
SELECT DISTINCT ON (po.product_id, po.retailer_id)
    po.product_id,
    po.retailer_id,
    po.price_cents,
    po.unit_price_cents,
    po.in_stock,
    po.product_url,
    po.delivery_cents,
    po.promotion_text,
    po.observed_at
FROM market.price_observations po
ORDER BY po.product_id, po.retailer_id, po.observed_at DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_latest_prices_pk
    ON market.latest_prices (product_id, retailer_id);

-- ── Chunk A schema (re-applied for idempotency on fresh databases) ──
-- See sites/source/sql/quote-rates-1192-schema.sql for canonical definition.
-- Replicated here so a single migration fully bootstraps a clean DB.

INSERT INTO market.retailers (name, slug, base_url, affiliate_network) VALUES
    ('Mitre 10',         'mitre-10',       'https://www.mitre10.com.au',         NULL),
    ('Reece',            'reece',          'https://www.reece.com.au',           NULL),
    ('Beaumont Tiles',   'beaumont-tiles', 'https://www.beaumont-tiles.com.au',  NULL),
    ('Tradelink',        'tradelink',      'https://www.tradelink.com.au',       NULL)
ON CONFLICT (slug) DO NOTHING;

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
