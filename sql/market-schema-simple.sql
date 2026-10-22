-- Simplified market schema for Azure Flexible Server (no TimescaleDB)
-- Creates the fuel tables that Source's /api/market/fuel/* routes query.

CREATE SCHEMA IF NOT EXISTS market;

-- Fuel Types
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

-- Fuel Brands
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

-- Fuel Stations
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

-- Fuel Prices (regular table, not hypertable)
CREATE TABLE IF NOT EXISTS market.fuel_prices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id      UUID NOT NULL REFERENCES market.fuel_stations(id),
    fuel_type       TEXT NOT NULL REFERENCES market.fuel_types(code),
    price_cpl       NUMERIC(6,1) NOT NULL,
    observed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_fuel_prices_station ON market.fuel_prices (station_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_fuel_prices_type ON market.fuel_prices (fuel_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_fuel_prices_station_type ON market.fuel_prices (station_id, fuel_type, observed_at DESC);

-- Latest fuel prices view (replaces materialized view for simplicity)
CREATE OR REPLACE VIEW market.latest_fuel_prices AS
SELECT DISTINCT ON (fp.station_id, fp.fuel_type)
    fp.station_id,
    fp.fuel_type,
    fp.price_cpl,
    fp.observed_at
FROM market.fuel_prices fp
ORDER BY fp.station_id, fp.fuel_type, fp.observed_at DESC;
