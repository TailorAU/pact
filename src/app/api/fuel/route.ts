import { NextResponse } from "next/server";
import { getMarketPool } from "@/lib/market/db";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_FUEL_TYPES = new Set(["U91", "E10", "U95", "U98", "Diesel", "PremDSL", "LPG"]);
const VALID_STATES = new Set(["NSW", "VIC", "QLD", "WA", "SA", "ACT", "TAS", "NT"]);
const MAX_TYPES = 7;
const CACHE_SEC = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const typesParam = searchParams.get("types") ?? searchParams.get("type") ?? "U91";
  const stateParam = searchParams.get("state");

  const types = typesParam
    .split(",")
    .map((t) => t.trim())
    .filter((t) => VALID_FUEL_TYPES.has(t))
    .slice(0, MAX_TYPES);

  if (types.length === 0) {
    return NextResponse.json(
      { error: "Invalid fuel types", types: [...VALID_FUEL_TYPES] },
      { status: 400 }
    );
  }

  const state = stateParam && VALID_STATES.has(stateParam) ? stateParam : null;

  try {
    const pool = getMarketPool();
    const params: unknown[] = [types];
    let stateFilter = "";
    if (state) {
      stateFilter = "AND fs.state = $2";
      params.push(state);
    }

    const { rows } = await pool.query<{
      stationId: string;
      name: string;
      brand: string | null;
      address: string | null;
      suburb: string | null;
      state: string;
      lat: number | null;
      lng: number | null;
      fuelType: string;
      priceCpl: number;
      observedAt: Date;
    }>(
      `SELECT DISTINCT ON (fp.station_id, fp.fuel_type)
        fs.id AS "stationId",
        fs.name,
        fb.name AS brand,
        fs.address,
        fs.suburb,
        fs.state,
        fs.latitude AS lat,
        fs.longitude AS lng,
        fp.fuel_type AS "fuelType",
        fp.price_cpl AS "priceCpl",
        fp.observed_at AS "observedAt"
      FROM market.fuel_prices fp
      JOIN market.fuel_stations fs ON fs.id = fp.station_id
      LEFT JOIN market.fuel_brands fb ON fb.id = fs.brand_id
      WHERE fp.fuel_type = ANY($1)
        AND fs.latitude IS NOT NULL
        AND fs.longitude IS NOT NULL
        AND fp.observed_at > NOW() - INTERVAL '4 hours'
        AND fp.price_cpl BETWEEN 50 AND 350
        ${stateFilter}
      ORDER BY fp.station_id, fp.fuel_type, fp.observed_at DESC`,
      params
    );

    const stationMap = new Map<string, {
      id: string; name: string; brand: string | null;
      address: string | null; suburb: string | null; state: string;
      lat: number; lng: number;
      prices: { type: string; price: number; observedAt: string }[];
    }>();

    for (const r of rows) {
      if (!r.lat || !r.lng) continue;
      let station = stationMap.get(r.stationId);
      if (!station) {
        station = {
          id: r.stationId, name: r.name, brand: r.brand,
          address: r.address, suburb: r.suburb, state: r.state,
          lat: r.lat, lng: r.lng, prices: [],
        };
        stationMap.set(r.stationId, station);
      }
      station.prices.push({
        type: r.fuelType,
        price: Number(r.priceCpl),
        observedAt: new Date(r.observedAt).toISOString(),
      });
    }

    const rawStations = Array.from(stationMap.values());

    // Grid-cell dedup: round coords to ~55m cells, keep newest per cell
    const cellMap = new Map<string, { station: typeof rawStations[0]; newest: number }>();
    for (const s of rawStations) {
      const cellKey = `${Math.round(s.lat * 2000)}:${Math.round(s.lng * 2000)}`;
      const newest = Math.max(...s.prices.map(p => new Date(p.observedAt).getTime()));
      const existing = cellMap.get(cellKey);
      if (!existing || newest > existing.newest) {
        cellMap.set(cellKey, { station: s, newest });
      }
    }
    const stations = Array.from(cellMap.values()).map(v => v.station);

    const allPrices = stations.flatMap((s) => s.prices.map((p) => p.price));
    const min = allPrices.length > 0 ? Math.min(...allPrices) : 0;
    const max = allPrices.length > 0 ? Math.max(...allPrices) : 0;
    const avg = allPrices.length > 0
      ? Math.round((allPrices.reduce((a, b) => a + b, 0) / allPrices.length) * 10) / 10
      : 0;

    const allDates = stations.flatMap((s) => s.prices.map((p) => new Date(p.observedAt).getTime()));
    const newestAt = allDates.length > 0 ? new Date(Math.max(...allDates)).toISOString() : null;
    const oldestAt = allDates.length > 0 ? new Date(Math.min(...allDates)).toISOString() : null;

    const resp = NextResponse.json({
      types, state: state ?? "all", stations,
      stats: { min, max, avg, count: stations.length },
      freshness: { newestAt, oldestAt, fetchedAt: new Date().toISOString() },
    });

    resp.headers.set("Cache-Control", `public, s-maxage=${CACHE_SEC}, stale-while-revalidate=${CACHE_SEC * 2}`);
    return resp;
  } catch (err) {
    log.error({ op: "market.fuel.map.error", err }, "[fuel-api] query failed");
    return NextResponse.json(
      { error: "Service temporarily unavailable", stations: [], stats: { min: 0, max: 0, avg: 0, count: 0 } },
      { status: 503 }
    );
  }
}
