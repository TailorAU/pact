-- BestPrice → Source Market Data Migration
--
-- IMPORTANT: Do NOT use a naive pg_dump/restore with TimescaleDB hypertables.
-- Standard pg_dump tries to restore internal chunk tables as regular tables.
--
-- Procedure:
-- 1. Ensure double-write has been running for 1-2 weeks (Phase 3)
-- 2. Run validation queries below to compare both databases
-- 3. Backfill historical data using the safe procedure
-- 4. Cut over scrapers to Source-only writes
-- 5. Sunset BestPrice infrastructure
--
-- Table mapping (BestPrice public schema → Source market schema):
--   retailers              → market.retailers
--   products               → market.products
--   manufacturers          → market.manufacturers
--   manufacturer_evidence  → market.manufacturer_evidence
--   agents                 → market.agents
--   agent_contributions    → market.agent_contributions
--   product_reviews        → market.product_reviews
--   retailer_accounts      → market.retailer_accounts
--   affiliate_conversions  → market.affiliate_conversions
--   fuel_types             → market.fuel_types
--   fuel_brands            → market.fuel_brands
--   fuel_stations          → market.fuel_stations
--   fuel_prices            → market.fuel_prices        (hypertable — use COPY backfill)
--   price_observations     → market.price_observations (hypertable — use COPY backfill)
--   search_events          → market.search_events      (hypertable — use COPY backfill)

-- ── Step 1: Validate double-write period ──────────────────
-- Run these on BOTH databases and compare:

-- On bestprice-pg-prod:
-- SELECT COUNT(*) FROM fuel_prices WHERE observed_at >= now() - INTERVAL '7 days';
-- SELECT COUNT(*) FROM price_observations WHERE observed_at >= now() - INTERVAL '7 days';

-- On pact-pg-prod:
-- SELECT COUNT(*) FROM market.fuel_prices WHERE observed_at >= now() - INTERVAL '7 days';
-- SELECT COUNT(*) FROM market.price_observations WHERE observed_at >= now() - INTERVAL '7 days';

-- ── Step 2: Prepare target for restore ────────────────────
SELECT timescaledb_pre_restore();

-- ── Step 3: Backfill from BestPrice (run from a host with access to both DBs) ──
-- pg_dump --data-only --table=retailers --table=products --table=manufacturers \
--   --table=manufacturer_evidence --table=agents --table=agent_contributions \
--   --table=product_reviews --table=retailer_accounts --table=affiliate_conversions \
--   --table=fuel_types --table=fuel_brands --table=fuel_stations \
--   -h bestprice-pg-prod.postgres.database.azure.com -U admin bestprice \
-- | sed 's/public\./market./g' \
-- | psql -h pact-pg-prod.postgres.database.azure.com -U admin pact

-- For hypertables (fuel_prices, price_observations, search_events), use COPY:
-- psql bestprice -c "\copy (SELECT * FROM fuel_prices WHERE observed_at < '<double-write-start>') TO '/tmp/fuel_prices.csv' CSV"
-- psql pact -c "\copy market.fuel_prices FROM '/tmp/fuel_prices.csv' CSV"

-- ── Step 4: Finalize restore ──────────────────────────────
SELECT timescaledb_post_restore();

-- ── Step 5: Refresh materialized views ────────────────────
REFRESH MATERIALIZED VIEW CONCURRENTLY market.latest_prices;
REFRESH MATERIALIZED VIEW CONCURRENTLY market.latest_fuel_prices;
REFRESH MATERIALIZED VIEW CONCURRENTLY market.search_trends;

-- ── Step 6: Verify counts match ───────────────────────────
SELECT 'fuel_stations' AS tbl, COUNT(*) FROM market.fuel_stations
UNION ALL SELECT 'fuel_prices', COUNT(*) FROM market.fuel_prices
UNION ALL SELECT 'products', COUNT(*) FROM market.products
UNION ALL SELECT 'price_observations', COUNT(*) FROM market.price_observations
UNION ALL SELECT 'retailers', COUNT(*) FROM market.retailers;
