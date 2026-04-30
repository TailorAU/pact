import { v4 as uuid } from "uuid";
import type { DbClient } from "./db";

// Translink SEQ GTFS static feed (CC BY 4.0 — Queensland Government Open Data)
const GTFS_FEED_URL =
  process.env.GTFS_FEED_URL ||
  "https://www.data.qld.gov.au/dataset/general-transit-feed-specification-gtfs-seq/resource/e43b6b9f-fc2a-4c08-8b25-97a3f92de5e3/download/SEQ_GTFS.zip";

// Rail route type (GTFS spec: 2 = Rail)
const RAIL_ROUTE_TYPE = 2;

// The 7 SEQ stations required for QIC v1 TOD catchment evidence.
// Names matched case-insensitively against GTFS stop_name.
export const SEQ_KEY_STATIONS = [
  "Loganlea",
  "Beenleigh",
  "Trinder Park",
  "Woodridge",
  "Bethania",
  "Kuraby",
  "Kingston",
];

export interface GtfsSyncResult {
  stopsIngested: number;
  routesIngested: number;
  tripsIngested: number;
  stopTimesIngested: number;
  keyStations: Array<{ name: string; stopId: string; lat: number; lon: number }>;
  errors: string[];
}

// Minimal CSV parser — handles quoted fields with embedded commas.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? "").trim(); });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      result.push(current); current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function fetchZipEntries(url: string): Promise<Map<string, string>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`GTFS fetch failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();

  // Parse ZIP using the end-of-central-directory approach
  const bytes = new Uint8Array(buf);
  const entries = new Map<string, string>();
  const decoder = new TextDecoder("utf-8");

  // Find end-of-central-directory (EOCD) signature: 0x06054b50
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4b && bytes[i+2] === 0x05 && bytes[i+3] === 0x06) {
      eocdOffset = i; break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid ZIP: EOCD not found");

  const view = new DataView(buf);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);

  let pos = centralDirOffset;
  for (let e = 0; e < totalEntries; e++) {
    // Central directory signature: 0x02014b50
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const filenameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const filename = decoder.decode(bytes.slice(pos + 46, pos + 46 + filenameLen));
    pos += 46 + filenameLen + extraLen + commentLen;

    // Only parse the CSV files we need
    const base = filename.split("/").pop() ?? filename;
    if (!["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"].includes(base)) continue;

    // Read local file header
    const lh = localHeaderOffset;
    if (view.getUint32(lh, true) !== 0x04034b50) continue;
    const compression = view.getUint16(lh + 8, true);
    const compressedSize = view.getUint32(lh + 18, true);
    const uncompressedSize = view.getUint32(lh + 22, true);
    const lhFilenameLen = view.getUint16(lh + 26, true);
    const lhExtraLen = view.getUint16(lh + 28, true);
    const dataOffset = lh + 30 + lhFilenameLen + lhExtraLen;

    let content: Uint8Array;
    if (compression === 0) {
      // Stored
      content = bytes.slice(dataOffset, dataOffset + uncompressedSize);
    } else if (compression === 8) {
      // Deflated — use DecompressionStream
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const chunks: Uint8Array[] = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const out = new Uint8Array(uncompressedSize);
      let off = 0;
      for (const chunk of chunks) { out.set(chunk, off); off += chunk.length; }
      content = out;
    } else {
      continue; // unsupported compression
    }
    entries.set(base, decoder.decode(content));
  }
  return entries;
}

async function batchUpsert(
  db: DbClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictCols: string | string[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const colSet = Array.isArray(conflictCols) ? conflictCols : [conflictCols];
  const keys = Object.keys(rows[0]);
  const cols = keys.join(", ");
  const updates = keys.filter((k) => !colSet.includes(k)).map((k) => `${k} = excluded.${k}`).join(", ");
  let count = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk.map((_, ri) =>
      `(${keys.map((__, ki) => `$${ri * keys.length + ki + 1}`).join(", ")})`
    ).join(", ");
    const args = chunk.flatMap((r) => keys.map((k) => r[k]));
    await db.execute({
      sql: `INSERT INTO ${table} (${cols}) VALUES ${placeholders}
            ON CONFLICT (${colSet.join(", ")}) DO UPDATE SET ${updates}`,
      args,
    });
    count += chunk.length;
  }
  return count;
}

export async function runGtfsSync(db: DbClient): Promise<GtfsSyncResult> {
  const logId = uuid();
  const now = new Date().toISOString();
  await db.execute({
    sql: "INSERT INTO gtfs_sync_log (id, feed_url, started_at) VALUES (?, ?, ?)",
    args: [logId, GTFS_FEED_URL, now],
  });

  const result: GtfsSyncResult = {
    stopsIngested: 0, routesIngested: 0, tripsIngested: 0, stopTimesIngested: 0,
    keyStations: [], errors: [],
  };

  try {
    const entries = await fetchZipEntries(GTFS_FEED_URL);
    const retrievedAt = new Date().toISOString();

    // 1. Stops — all stops
    if (entries.has("stops.txt")) {
      const rows = parseCsv(entries.get("stops.txt")!);
      const stopRows = rows
        .filter((r) => r.stop_id && r.stop_lat && r.stop_lon)
        .map((r) => ({
          stop_id: r.stop_id,
          stop_name: r.stop_name ?? "",
          stop_lat: parseFloat(r.stop_lat),
          stop_lon: parseFloat(r.stop_lon),
          stop_timezone: r.stop_timezone ?? null,
          retrieved_at: retrievedAt,
          effective_date: retrievedAt.slice(0, 10),
        }));
      result.stopsIngested = await batchUpsert(db, "transit_stops", stopRows, "stop_id");

      // Identify key stations
      for (const stationName of SEQ_KEY_STATIONS) {
        const match = stopRows.find((s) =>
          s.stop_name.toLowerCase().includes(stationName.toLowerCase()) &&
          s.stop_name.toLowerCase().includes("station")
        ) ?? stopRows.find((s) =>
          s.stop_name.toLowerCase().includes(stationName.toLowerCase())
        );
        if (match) {
          result.keyStations.push({
            name: stationName,
            stopId: match.stop_id,
            lat: match.stop_lat,
            lon: match.stop_lon,
          });
        }
      }
    }

    // 2. Routes — rail only (type=2)
    if (entries.has("routes.txt")) {
      const rows = parseCsv(entries.get("routes.txt")!);
      const railRows = rows
        .filter((r) => parseInt(r.route_type ?? "99") === RAIL_ROUTE_TYPE && r.route_id)
        .map((r) => ({
          route_id: r.route_id,
          route_short_name: r.route_short_name ?? "",
          route_long_name: r.route_long_name ?? "",
          route_type: RAIL_ROUTE_TYPE,
          retrieved_at: retrievedAt,
        }));
      result.routesIngested = await batchUpsert(db, "transit_routes", railRows, "route_id");
    }

    // 3. Trips — for rail routes only
    const railRouteIds = new Set(
      (await db.execute("SELECT route_id FROM transit_routes WHERE route_type = 2")).rows.map(
        (r) => r.route_id as string
      )
    );
    if (entries.has("trips.txt") && railRouteIds.size > 0) {
      const rows = parseCsv(entries.get("trips.txt")!);
      const tripRows = rows
        .filter((r) => r.trip_id && railRouteIds.has(r.route_id))
        .map((r) => ({
          trip_id: r.trip_id,
          route_id: r.route_id,
          service_id: r.service_id ?? "",
          trip_headsign: r.trip_headsign ?? null,
          retrieved_at: retrievedAt,
        }));
      result.tripsIngested = await batchUpsert(db, "transit_trips", tripRows, "trip_id");
    }

    // 4. Stop times — only for key station stops to keep storage bounded
    const keyStopIds = new Set(result.keyStations.map((s) => s.stopId));
    // Also include platform variants (stops whose name contains a key station name)
    if (entries.has("stops.txt")) {
      const allStops = parseCsv(entries.get("stops.txt")!);
      for (const stationName of SEQ_KEY_STATIONS) {
        allStops
          .filter((s) => s.stop_name?.toLowerCase().includes(stationName.toLowerCase()))
          .forEach((s) => keyStopIds.add(s.stop_id));
      }
    }

    const railTripIds = new Set(
      (await db.execute("SELECT trip_id FROM transit_trips")).rows.map((r) => r.trip_id as string)
    );

    if (entries.has("stop_times.txt") && keyStopIds.size > 0) {
      const rows = parseCsv(entries.get("stop_times.txt")!);
      const stRows = rows
        .filter((r) => r.trip_id && r.stop_id && keyStopIds.has(r.stop_id) && railTripIds.has(r.trip_id))
        .map((r) => ({
          trip_id: r.trip_id,
          stop_id: r.stop_id,
          arrival_time: r.arrival_time ?? "",
          departure_time: r.departure_time ?? "",
          stop_sequence: parseInt(r.stop_sequence ?? "0"),
        }));
      result.stopTimesIngested = await batchUpsert(db, "transit_stop_times", stRows, ["trip_id", "stop_sequence"]);
    }

    await db.execute({
      sql: `UPDATE gtfs_sync_log SET
        stops_ingested = ?, routes_ingested = ?, trips_ingested = ?,
        stop_times_ingested = ?, completed_at = NOW()
        WHERE id = ?`,
      args: [
        result.stopsIngested, result.routesIngested, result.tripsIngested,
        result.stopTimesIngested, logId,
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await db.execute({
      sql: "UPDATE gtfs_sync_log SET errors = ?, completed_at = NOW() WHERE id = ?",
      args: [msg, logId],
    });
  }

  return result;
}

// Haversine distance in metres between two lat/lon points
export function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface TodCatchmentFact {
  stationName: string;
  stopId: string;
  stationLat: number;
  stationLon: number;
  parcelLat: number;
  parcelLon: number;
  distanceMetres: number;
  within400m: boolean;
  within800m: boolean;
  derivedFrom: string[];
  effectiveDate: string;
  retrievedAt: string;
  limitations: string[];
}

// Deterministic TOD catchment membership for a parcel centroid against all key stations.
// derivedFrom[] cites the GTFS stop record.
export async function computeTodCatchment(
  db: DbClient,
  parcelLat: number,
  parcelLon: number,
): Promise<TodCatchmentFact[]> {
  const syncLog = await db.execute(
    "SELECT completed_at FROM gtfs_sync_log WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1"
  );
  const lastSync = syncLog.rows[0]?.completed_at as string | undefined;
  const retrievedAt = new Date().toISOString();

  const facts: TodCatchmentFact[] = [];
  for (const stationName of SEQ_KEY_STATIONS) {
    const res = await db.execute({
      sql: `SELECT stop_id, stop_name, stop_lat, stop_lon, retrieved_at
            FROM transit_stops
            WHERE stop_name ILIKE ? AND stop_name ILIKE '%Station%'
            LIMIT 1`,
      args: [`%${stationName}%`],
    });
    if (res.rows.length === 0) continue;
    const stop = res.rows[0];
    const stLat = stop.stop_lat as number;
    const stLon = stop.stop_lon as number;
    const dist = haversineMetres(parcelLat, parcelLon, stLat, stLon);

    facts.push({
      stationName,
      stopId: stop.stop_id as string,
      stationLat: stLat,
      stationLon: stLon,
      parcelLat,
      parcelLon,
      distanceMetres: Math.round(dist),
      within400m: dist <= 400,
      within800m: dist <= 800,
      derivedFrom: [
        `transit_stops.stop_id:${stop.stop_id}`,
        `gtfs_sync:${lastSync ?? "unknown"}`,
      ],
      effectiveDate: (stop.retrieved_at as string)?.slice(0, 10) ?? retrievedAt.slice(0, 10),
      retrievedAt,
      limitations: [
        "Distance computed from parcel centroid to station platform stop; does not account for pedestrian routing.",
        "GTFS stop coordinates reflect platform location, not station entrance.",
        "TOD catchment boundaries (400m/800m) are policy designations; confirm against current ShapingSEQ or local planning scheme.",
        lastSync ? `GTFS feed last refreshed: ${lastSync.slice(0, 10)}` : "GTFS feed not yet synced — coordinates may be stale.",
      ],
    });
  }
  return facts;
}
