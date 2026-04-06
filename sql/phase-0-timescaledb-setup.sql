-- Phase 0: TimescaleDB Setup for Azure Flexible Server
-- 
-- PREREQUISITES:
-- 1. Enable timescaledb in shared_preload_libraries (Azure Portal) → server restart required
-- 2. Enable pg_cron extension (no restart needed)
--
-- Run this AFTER the server restart completes.

-- Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Dedicated schema for market data (keeps PACT public schema clean)
CREATE SCHEMA IF NOT EXISTS market;

-- ── Retailers ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market.retailers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    base_url    TEXT NOT NULL,
    affiliate_network TEXT,
    affiliate_tag     TEXT,
    logo_url    TEXT,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO market.retailers (name, slug, base_url, affiliate_network) VALUES
    ('Coles',               'coles',        'https://www.coles.com.au',             'Commission Factory'),
    ('Woolworths',          'woolworths',   'https://www.woolworths.com.au',        'Commission Factory'),
    ('Amazon AU',           'amazon-au',    'https://www.amazon.com.au',            'Amazon Associates'),
    ('IGA',                 'iga',          'https://www.iga.com.au',               NULL),
    ('Chemist Warehouse',   'chemist-wh',   'https://www.chemistwarehouse.com.au',  'Commission Factory'),
    ('Bunnings',            'bunnings',     'https://www.bunnings.com.au',          NULL),
    ('Kmart',               'kmart',        'https://www.kmart.com.au',             'Commission Factory'),
    ('Big W',               'bigw',         'https://www.bigw.com.au',              'Impact'),
    ('eBay AU',             'ebay-au',      'https://www.ebay.com.au',              'eBay Partner Network'),
    ('Target',              'target',       'https://www.target.com.au',            'Commission Factory')
ON CONFLICT (slug) DO NOTHING;

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
    manufacturer_id UUID,
    origin_country  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_products_ean ON market.products (ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_products_name_trgm ON market.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_market_products_category ON market.products (category);
CREATE INDEX IF NOT EXISTS idx_market_products_brand ON market.products (brand);
CREATE INDEX IF NOT EXISTS idx_market_products_manufacturer ON market.products (manufacturer_id);

-- ── Manufacturers ──────────────────────────────────────────────────

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

ALTER TABLE market.products
    ADD CONSTRAINT IF NOT EXISTS fk_market_products_manufacturer
    FOREIGN KEY (manufacturer_id) REFERENCES market.manufacturers(id);

CREATE INDEX IF NOT EXISTS idx_market_manufacturers_name_trgm ON market.manufacturers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_market_manufacturers_gs1 ON market.manufacturers (gs1_prefix) WHERE gs1_prefix IS NOT NULL;

CREATE TABLE IF NOT EXISTS market.manufacturer_evidence (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id     UUID NOT NULL REFERENCES market.manufacturers(id),
    product_id          UUID REFERENCES market.products(id),
    source              TEXT NOT NULL,
    detail              TEXT NOT NULL,
    evidence_url        TEXT,
    verification_level  TEXT NOT NULL DEFAULT 'Inferred'
                        CHECK (verification_level IN ('Inferred', 'Corroborated', 'Confirmed', 'Audited')),
    submitted_by        TEXT,
    verified_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_evidence_manufacturer ON market.manufacturer_evidence (manufacturer_id);

-- ── Price Observations (TimescaleDB hypertable) ────────────────────

CREATE TABLE IF NOT EXISTS market.price_observations (
    id              UUID DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES market.products(id),
    retailer_id     UUID NOT NULL REFERENCES market.retailers(id),
    price_cents     INTEGER NOT NULL,
    was_price_cents INTEGER,
    unit_price_cents INTEGER,
    unit_price_unit TEXT,
    in_stock        BOOLEAN NOT NULL DEFAULT true,
    product_url     TEXT NOT NULL,
    delivery_cents  INTEGER,
    promotion_text  TEXT,
    observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, observed_at)
);

SELECT create_hypertable('market.price_observations', 'observed_at', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_market_prices_product ON market.price_observations (product_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_prices_retailer ON market.price_observations (retailer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_prices_product_retailer ON market.price_observations (product_id, retailer_id, observed_at DESC);

-- ── Affiliate Conversions ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market.affiliate_conversions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retailer_id         UUID NOT NULL REFERENCES market.retailers(id),
    product_id          UUID REFERENCES market.products(id),
    clicked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    converted_at        TIMESTAMPTZ,
    order_value_cents   INTEGER,
    commission_cents    INTEGER,
    session_id          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_conversions_retailer ON market.affiliate_conversions (retailer_id, clicked_at DESC);

-- ── Agent Economy (market-specific agents, links to PACT agents) ───

CREATE TABLE IF NOT EXISTS market.agents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id         TEXT UNIQUE,
    pact_agent_id       TEXT REFERENCES agents(id),
    name                TEXT,
    credits_balance     INTEGER NOT NULL DEFAULT 0,
    total_contributions INTEGER NOT NULL DEFAULT 0,
    contributor_tier    TEXT NOT NULL DEFAULT 'anonymous'
                        CHECK (contributor_tier IN ('anonymous', 'active', 'trusted', 'verified')),
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_agents_external ON market.agents (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_agents_pact ON market.agents (pact_agent_id) WHERE pact_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS market.agent_contributions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            UUID NOT NULL REFERENCES market.agents(id),
    contribution_type   TEXT NOT NULL
                        CHECK (contribution_type IN (
                            'price_verification', 'price_correction',
                            'new_product', 'manufacturer_info', 'product_review'
                        )),
    product_id          UUID REFERENCES market.products(id),
    retailer_id         UUID REFERENCES market.retailers(id),
    data                JSONB NOT NULL DEFAULT '{}',
    credits_earned      INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_contributions_agent ON market.agent_contributions (agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market.product_reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID NOT NULL REFERENCES market.agents(id),
    product_id  UUID NOT NULL REFERENCES market.products(id),
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    signal      TEXT NOT NULL CHECK (signal IN ('excellent', 'good', 'average', 'poor', 'defective')),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_reviews_product ON market.product_reviews (product_id);

-- ── Retailer Intelligence Portal ───────────────────────────────────

CREATE TABLE IF NOT EXISTS market.retailer_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retailer_id     UUID NOT NULL REFERENCES market.retailers(id),
    contact_email   TEXT NOT NULL,
    tier            TEXT NOT NULL DEFAULT 'free'
                    CHECK (tier IN ('free', 'pro', 'enterprise')),
    api_key_hash    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Search Events (TimescaleDB hypertable) ─────────────────────────

CREATE TABLE IF NOT EXISTS market.search_events (
    id                  UUID DEFAULT gen_random_uuid(),
    query               TEXT NOT NULL,
    category            TEXT,
    result_count        INTEGER NOT NULL DEFAULT 0,
    winning_retailer_id UUID REFERENCES market.retailers(id),
    agent_id            UUID REFERENCES market.agents(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
);

SELECT create_hypertable('market.search_events', 'created_at', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_market_search_category ON market.search_events (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_search_winner ON market.search_events (winning_retailer_id, created_at DESC);

-- ── Fuel Types ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market.fuel_types (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO market.fuel_types (code, name, sort_order) VALUES
    ('E10',     'Ethanol 10 (E10)',    1),
    ('U91',     'Unleaded 91',         2),
    ('U95',     'Premium 95',          3),
    ('U98',     'Premium 98',          4),
    ('Diesel',  'Diesel',              5),
    ('LPG',     'LPG (Autogas)',       6),
    ('E85',     'Ethanol 85 (E85)',    7),
    ('AdBlue',  'AdBlue (DEF)',        8),
    ('PremDSL', 'Premium Diesel',      9)
ON CONFLICT (code) DO NOTHING;

-- ── Fuel Brands ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market.fuel_brands (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    logo_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO market.fuel_brands (name) VALUES
    ('7-Eleven'), ('Ampol'), ('BP'), ('Caltex'), ('Costco'),
    ('Liberty'), ('Metro'), ('Mobil'), ('Puma'), ('Shell'),
    ('United'), ('Vibe'), ('Woolworths'), ('Coles Express'),
    ('Independent'), ('OTR'), ('Burk'), ('Gull'), ('Peak'),
    ('X Convenience'), ('Lowes'), ('Matilda'), ('Budget'),
    ('Freedom'), ('Speedway'), ('EG Ampol'), ('Enhance')
ON CONFLICT (name) DO NOTHING;

-- ── Fuel Stations ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market.fuel_stations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       TEXT NOT NULL,
    source          TEXT NOT NULL,
    brand_id        UUID REFERENCES market.fuel_brands(id),
    name            TEXT NOT NULL,
    address         TEXT,
    suburb          TEXT,
    state           TEXT NOT NULL,
    postcode        TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    phone           TEXT,
    features        TEXT,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_market_fuel_stations_brand ON market.fuel_stations (brand_id);
CREATE INDEX IF NOT EXISTS idx_market_fuel_stations_state ON market.fuel_stations (state);
CREATE INDEX IF NOT EXISTS idx_market_fuel_stations_location ON market.fuel_stations USING gist (
    point(longitude, latitude)
) WHERE latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_fuel_stations_name_trgm ON market.fuel_stations USING gin (name gin_trgm_ops);

-- ── Fuel Prices (TimescaleDB hypertable) ───────────────────────────

CREATE TABLE IF NOT EXISTS market.fuel_prices (
    id              UUID DEFAULT gen_random_uuid(),
    station_id      UUID NOT NULL REFERENCES market.fuel_stations(id),
    fuel_type       TEXT NOT NULL REFERENCES market.fuel_types(code),
    price_cpl       NUMERIC(6,1) NOT NULL,
    observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, observed_at)
);

SELECT create_hypertable('market.fuel_prices', 'observed_at', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_market_fuel_prices_station ON market.fuel_prices (station_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_fuel_prices_type ON market.fuel_prices (fuel_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_fuel_prices_station_type ON market.fuel_prices (station_id, fuel_type, observed_at DESC);

-- ── Materialized Views (replacing TimescaleDB continuous aggregates) ──
-- Azure Flexible Server only supports TimescaleDB Apache 2 Edition.
-- Continuous aggregates are a Community License feature.
-- We use standard MATERIALIZED VIEWs refreshed by pg_cron instead.

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

CREATE MATERIALIZED VIEW IF NOT EXISTS market.latest_fuel_prices AS
SELECT DISTINCT ON (fp.station_id, fp.fuel_type)
    fp.station_id,
    fp.fuel_type,
    fp.price_cpl,
    fp.observed_at
FROM market.fuel_prices fp
ORDER BY fp.station_id, fp.fuel_type, fp.observed_at DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_latest_fuel_prices_pk
    ON market.latest_fuel_prices (station_id, fuel_type);

CREATE MATERIALIZED VIEW IF NOT EXISTS market.search_trends AS
SELECT
    category,
    date_trunc('day', created_at) AS day,
    count(*) AS query_count,
    count(DISTINCT agent_id) AS unique_agents
FROM market.search_events
WHERE category IS NOT NULL
GROUP BY category, date_trunc('day', created_at);

-- ── pg_cron Refresh Schedules ──────────────────────────────────────

SELECT cron.schedule('refresh-market-latest-prices', '*/5 * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY market.latest_prices');

SELECT cron.schedule('refresh-market-latest-fuel-prices', '*/5 * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY market.latest_fuel_prices');

SELECT cron.schedule('refresh-market-search-trends', '*/15 * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY market.search_trends');
