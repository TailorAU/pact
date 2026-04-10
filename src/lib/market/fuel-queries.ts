/**
 * Market fuel queries — ported from @bestprice/db fuel-queries.ts
 * All table references use the market.* schema.
 */

import { marketQuery, marketQueryOne, marketExec } from "./db";
import type { FuelStationInput, FuelPriceResult } from "./types";

// ── Brand Resolution ─────────────────────────────────────

const brandCache = new Map<string, string>();

async function resolveBrandId(brandName: string): Promise<string> {
  if (brandCache.has(brandName)) return brandCache.get(brandName)!;

  const existing = await marketQueryOne<{ id: string }>(
    "SELECT id FROM market.fuel_brands WHERE name = $1 LIMIT 1",
    [brandName]
  );
  if (existing) {
    brandCache.set(brandName, existing.id);
    return existing.id;
  }

  const created = await marketQueryOne<{ id: string }>(
    `INSERT INTO market.fuel_brands (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [brandName]
  );
  brandCache.set(brandName, created!.id);
  return created!.id;
}

// ── Station Upsert ───────────────────────────────────────

export async function upsertFuelStation(input: FuelStationInput): Promise<string> {
  const brandId = input.brandName ? await resolveBrandId(input.brandName) : null;

  const row = await marketQueryOne<{ id: string }>(
    `INSERT INTO market.fuel_stations (source_id, source, brand_id, name, address, suburb, state, postcode, latitude, longitude, phone, features)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (source, source_id) DO UPDATE SET
      brand_id = COALESCE(EXCLUDED.brand_id, market.fuel_stations.brand_id),
      name = EXCLUDED.name,
      address = COALESCE(EXCLUDED.address, market.fuel_stations.address),
      suburb = COALESCE(EXCLUDED.suburb, market.fuel_stations.suburb),
      postcode = COALESCE(EXCLUDED.postcode, market.fuel_stations.postcode),
      latitude = COALESCE(EXCLUDED.latitude, market.fuel_stations.latitude),
      longitude = COALESCE(EXCLUDED.longitude, market.fuel_stations.longitude),
      phone = COALESCE(EXCLUDED.phone, market.fuel_stations.phone),
      features = COALESCE(EXCLUDED.features, market.fuel_stations.features),
      updated_at = now()
    RETURNING id`,
    [
      input.sourceId, input.source, brandId,
      input.name, input.address, input.suburb,
      input.state, input.postcode,
      input.latitude, input.longitude,
      input.phone, input.features,
    ]
  );

  return row!.id;
}

// ── Price Insert ─────────────────────────────────────────

export async function insertFuelPrice(
  stationId: string,
  fuelType: string,
  priceCpl: number
): Promise<void> {
  await marketExec(
    "INSERT INTO market.fuel_prices (station_id, fuel_type, price_cpl) VALUES ($1::uuid, $2, $3)",
    [stationId, fuelType, priceCpl]
  );
}

export async function insertFuelPriceBatch(
  rows: { stationId: string; fuelType: string; priceCpl: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  const BATCH = 500;
  const pool = (await import("./db")).getMarketPool();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;
    for (const r of chunk) {
      values.push(`($${paramIdx}::uuid, $${paramIdx + 1}, $${paramIdx + 2})`);
      params.push(r.stationId, r.fuelType, r.priceCpl);
      paramIdx += 3;
    }
    await pool.query(
      `INSERT INTO market.fuel_prices (station_id, fuel_type, price_cpl) VALUES ${values.join(", ")}`,
      params
    );
  }
}

// ── Fuel Queries ─────────────────────────────────────────

export async function getCheapestFuel(
  fuelType: string,
  state?: string,
  limit: number = 20
): Promise<FuelPriceResult[]> {
  const params: unknown[] = [fuelType];
  let stateFilter = "";
  if (state) {
    stateFilter = "AND fs.state = $2";
    params.push(state);
  }
  params.push(limit);
  const limitParam = `$${params.length}`;

  return marketQuery<FuelPriceResult>(
    `WITH latest AS (
      SELECT DISTINCT ON (fp.station_id)
        fp.station_id, fp.fuel_type, fp.price_cpl, fp.observed_at
      FROM market.fuel_prices fp
      JOIN market.fuel_stations fs ON fs.id = fp.station_id
      WHERE fp.fuel_type = $1 ${stateFilter}
      ORDER BY fp.station_id, fp.observed_at DESC
    )
    SELECT
      l.station_id AS "stationId",
      fs.name AS "stationName",
      fb.name AS "brandName",
      fs.address,
      fs.suburb,
      fs.state,
      l.fuel_type AS "fuelType",
      l.price_cpl AS "priceCpl",
      fs.latitude,
      fs.longitude,
      l.observed_at AS "observedAt"
    FROM latest l
    JOIN market.fuel_stations fs ON fs.id = l.station_id
    LEFT JOIN market.fuel_brands fb ON fb.id = fs.brand_id
    ORDER BY l.price_cpl ASC
    LIMIT ${limitParam}`,
    params
  );
}

export async function getFuelPriceHistory(
  stationId: string,
  fuelType: string,
  days: number = 30
): Promise<{ priceCpl: number; observedAt: Date }[]> {
  return marketQuery<{ priceCpl: number; observedAt: Date }>(
    `SELECT
      price_cpl AS "priceCpl",
      observed_at AS "observedAt"
    FROM market.fuel_prices
    WHERE station_id = $1::uuid
      AND fuel_type = $2
      AND observed_at >= now() - ($3 || ' days')::interval
    ORDER BY observed_at ASC`,
    [stationId, fuelType, String(days)]
  );
}

export async function getStationPrices(stationId: string): Promise<FuelPriceResult[]> {
  return marketQuery<FuelPriceResult>(
    `SELECT DISTINCT ON (fp.fuel_type)
      fp.station_id AS "stationId",
      fs.name AS "stationName",
      fb.name AS "brandName",
      fs.address,
      fs.suburb,
      fs.state,
      fp.fuel_type AS "fuelType",
      fp.price_cpl AS "priceCpl",
      fs.latitude,
      fs.longitude,
      fp.observed_at AS "observedAt"
    FROM market.fuel_prices fp
    JOIN market.fuel_stations fs ON fs.id = fp.station_id
    LEFT JOIN market.fuel_brands fb ON fb.id = fs.brand_id
    WHERE fp.station_id = $1::uuid
    ORDER BY fp.fuel_type, fp.observed_at DESC`,
    [stationId]
  );
}

export async function searchFuelStations(
  fuelType: string,
  options: { state?: string; suburb?: string; limit?: number } = {}
): Promise<FuelPriceResult[]> {
  const { state, suburb, limit = 20 } = options;
  const conditions: string[] = ["fp.fuel_type = $1"];
  const params: unknown[] = [fuelType];
  let paramIdx = 2;

  if (state) {
    conditions.push(`fs.state = $${paramIdx}`);
    params.push(state);
    paramIdx++;
  }
  if (suburb) {
    conditions.push(`(fs.suburb ILIKE $${paramIdx} OR fs.address ILIKE $${paramIdx})`);
    params.push(`%${suburb}%`);
    paramIdx++;
  }

  params.push(limit);
  const limitParam = `$${paramIdx}`;

  return marketQuery<FuelPriceResult>(
    `WITH latest AS (
      SELECT DISTINCT ON (fp.station_id)
        fp.station_id, fp.fuel_type, fp.price_cpl, fp.observed_at
      FROM market.fuel_prices fp
      JOIN market.fuel_stations fs ON fs.id = fp.station_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY fp.station_id, fp.observed_at DESC
    )
    SELECT
      l.station_id AS "stationId",
      fs.name AS "stationName",
      fb.name AS "brandName",
      fs.address,
      fs.suburb,
      fs.state,
      l.fuel_type AS "fuelType",
      l.price_cpl AS "priceCpl",
      fs.latitude,
      fs.longitude,
      l.observed_at AS "observedAt"
    FROM latest l
    JOIN market.fuel_stations fs ON fs.id = l.station_id
    LEFT JOIN market.fuel_brands fb ON fb.id = fs.brand_id
    ORDER BY l.price_cpl ASC
    LIMIT ${limitParam}`,
    params
  );
}

export async function getFuelNearMe(
  latitude: number,
  longitude: number,
  fuelType: string,
  radiusKm: number = 10,
  limit: number = 10
): Promise<(FuelPriceResult & { distanceKm: number })[]> {
  return marketQuery<FuelPriceResult & { distanceKm: number }>(
    `WITH nearby AS (
      SELECT id, name, brand_id, address, suburb, state, latitude, longitude,
        (point($1, $2) <-> point(fs.longitude, fs.latitude)) * 111.32 AS dist_km
      FROM market.fuel_stations fs
      WHERE fs.latitude IS NOT NULL
        AND (point($1, $2) <-> point(fs.longitude, fs.latitude)) * 111.32 <= $3
      ORDER BY dist_km
    )
    SELECT DISTINCT ON (fp.station_id)
      fp.station_id AS "stationId",
      n.name AS "stationName",
      fb.name AS "brandName",
      n.address,
      n.suburb,
      n.state,
      fp.fuel_type AS "fuelType",
      fp.price_cpl AS "priceCpl",
      n.latitude,
      n.longitude,
      fp.observed_at AS "observedAt",
      ROUND(n.dist_km::numeric, 1) AS "distanceKm"
    FROM market.fuel_prices fp
    JOIN nearby n ON n.id = fp.station_id
    LEFT JOIN market.fuel_brands fb ON fb.id = n.brand_id
    WHERE fp.fuel_type = $4
    ORDER BY fp.station_id, fp.observed_at DESC`,
    [longitude, latitude, radiusKm, fuelType]
  ).then(rows => rows.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit));
}

export async function getFuelSummary(state?: string): Promise<{
  fuelType: string;
  avgPriceCpl: number;
  minPriceCpl: number;
  maxPriceCpl: number;
  stationCount: number;
}[]> {
  const conditions = state ? "AND fs.state = $1" : "";
  const params = state ? [state] : [];

  return marketQuery(
    `SELECT
      fp.fuel_type AS "fuelType",
      ROUND(AVG(fp.price_cpl)::numeric, 1) AS "avgPriceCpl",
      MIN(fp.price_cpl) AS "minPriceCpl",
      MAX(fp.price_cpl) AS "maxPriceCpl",
      COUNT(DISTINCT fp.station_id)::int AS "stationCount"
    FROM market.fuel_prices fp
    JOIN market.fuel_stations fs ON fs.id = fp.station_id
    WHERE fp.observed_at >= now() - INTERVAL '24 hours'
    ${conditions}
    GROUP BY fp.fuel_type
    ORDER BY fp.fuel_type`,
    params
  );
}
