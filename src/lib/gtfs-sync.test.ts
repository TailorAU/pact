/**
 * tailor-group#38 — the GTFS ingest must not hold the SEQ feed's stop_times.txt
 * (~220 MB uncompressed, millions of rows) in memory: the first real detached
 * run killed the 1 GiB pact replica. These tests pin the streamed, filtered
 * parse on an in-memory ZIP that is deflated exactly as a real feed is.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { deflateRawSync } from "node:zlib";
import type { DbClient } from "./db";
import { csvRowsFromChunks, indexZip, runGtfsSync, zipEntryChunks } from "./gtfs-sync";

/** A minimal ZIP writer: local headers, central directory, EOCD (CRC left 0; the reader ignores it). */
function makeZip(files: Array<{ name: string; text: string; stored?: boolean }>): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const data = f.stored ? raw : new Uint8Array(deflateRawSync(raw));
    const method = f.stored ? 0 : 8;
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes,
    ]);
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset), ...nameBytes,
    ]);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);
  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(new ArrayBuffer(total));
  let pos = 0;
  for (const part of [...locals, ...centrals, eocd]) { out.set(part, pos); pos += part.length; }
  return out;
}

async function* chunked(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  for (let off = 0; off < bytes.length; off += size) yield bytes.subarray(off, Math.min(off + size, bytes.length));
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("csvRowsFromChunks — streamed CSV", () => {
  it("parses rows split across chunk boundaries, CRLF, quoted commas, a BOM header and a last line without a newline", async () => {
    const text = "﻿trip_id,stop_id,arrival_time,note\r\nT1,S1,08:00:00,\"a, quoted\"\r\nT2,S2,08:05:00,plain\nT3,S3,08:10:00,last";
    for (const size of [1, 3, 7, 1024]) {
      const rows = await collect(csvRowsFromChunks(chunked(text, size)));
      expect(rows).toEqual([
        { trip_id: "T1", stop_id: "S1", arrival_time: "08:00:00", note: "a, quoted" },
        { trip_id: "T2", stop_id: "S2", arrival_time: "08:05:00", note: "plain" },
        { trip_id: "T3", stop_id: "S3", arrival_time: "08:10:00", note: "last" },
      ]);
    }
  });

  it("yields nothing for a header-only or empty file", async () => {
    expect(await collect(csvRowsFromChunks(chunked("a,b\n", 4)))).toEqual([]);
    expect(await collect(csvRowsFromChunks(chunked("", 4)))).toEqual([]);
  });
});

describe("indexZip + zipEntryChunks", () => {
  it("indexes entries by base name with central-directory sizes and streams deflated and stored data", async () => {
    const zip = makeZip([
      { name: "feed/stops.txt", text: "stop_id,stop_name\nS1,Loganlea station\n" },
      { name: "notes.txt", text: "stored bytes", stored: true },
    ]);
    const index = indexZip(zip);
    expect([...index.keys()]).toEqual(["stops.txt", "notes.txt"]);
    expect(index.get("stops.txt")).toMatchObject({ compression: 8, uncompressedSize: 38 });
    expect(index.get("notes.txt")).toMatchObject({ compression: 0, uncompressedSize: 12, compressedSize: 12 });
    const dec = new TextDecoder();
    const deflated = (await collect(zipEntryChunks(zip, index.get("stops.txt")!))).map((c) => dec.decode(c)).join("");
    expect(deflated).toBe("stop_id,stop_name\nS1,Loganlea station\n");
    const stored = (await collect(zipEntryChunks(zip, index.get("notes.txt")!))).map((c) => dec.decode(c)).join("");
    expect(stored).toBe("stored bytes");
  });

  it("streams a large deflated entry in many chunks and every row survives the chunk boundaries", async () => {
    const lines = ["trip_id,stop_id,arrival_time,departure_time,stop_sequence"];
    const N = 200_000;
    for (let i = 0; i < N; i++) lines.push(`T${i % 500},S${i % 37},08:00:00,08:00:30,${i}`);
    const zip = makeZip([{ name: "stop_times.txt", text: lines.join("\n") + "\n" }]);
    const entry = indexZip(zip).get("stop_times.txt")!;
    const chunks = await collect(zipEntryChunks(zip, entry));
    expect(chunks.length).toBeGreaterThan(1);
    let count = 0;
    let last: Record<string, string> | undefined;
    for await (const row of csvRowsFromChunks(zipEntryChunks(zip, entry))) { count++; last = row; }
    expect(count).toBe(N);
    expect(last).toEqual({ trip_id: `T${(N - 1) % 500}`, stop_id: `S${(N - 1) % 37}`, arrival_time: "08:00:00", departure_time: "08:00:30", stop_sequence: String(N - 1) });
  });
});

describe("runGtfsSync — filtered ingest of the streamed feed (tailor-group#38)", () => {
  const STOPS = [
    "stop_id,stop_name,stop_lat,stop_lon,stop_timezone",
    "600001,Loganlea station,-27.67,153.14,",
    "600002,\"Loganlea station, platform 2\",-27.67,153.14,",
    "600100,Central station,-27.47,153.03,",
  ].join("\n");
  const ROUTES = [
    "route_id,route_short_name,route_long_name,route_type",
    "BNGY,BNGY,Beenleigh line,2",
    "555,555,Some bus,3",
  ].join("\n");
  const TRIPS = [
    "trip_id,route_id,service_id,trip_headsign",
    "T-rail,BNGY,weekday,Beenleigh",
    "T-bus,555,weekday,Somewhere",
  ].join("\n");
  const STOP_TIMES = [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
    "T-rail,08:00:00,08:00:30,600001,1",
    "T-rail,08:10:00,08:10:30,600002,2",
    "T-rail,08:30:00,08:30:30,600100,3",
    "T-bus,08:00:00,08:00:30,600001,1",
    ...Array.from({ length: 5000 }, (_, i) => `T-other-${i},09:00:00,09:00:30,${700000 + i},1`),
  ].join("\n");

  function mockDb(): { db: DbClient; upserts: Map<string, number>; sql: string[] } {
    const upserts = new Map<string, number>();
    const sql: string[] = [];
    const execute = vi.fn(async (stmt: string | { sql: string; args: unknown[] }) => {
      const text = typeof stmt === "string" ? stmt : stmt.sql;
      const args = typeof stmt === "string" ? [] : stmt.args;
      sql.push(text);
      const m = text.match(/INSERT INTO (transit_\w+) \(([^)]+)\)/);
      if (m) {
        const cols = m[2].split(",").length;
        upserts.set(m[1], (upserts.get(m[1]) ?? 0) + args.length / cols);
        return { rows: [] };
      }
      if (text.includes("FROM transit_routes")) return { rows: [{ route_id: "BNGY" }] };
      if (text.includes("FROM transit_trips")) return { rows: [{ trip_id: "T-rail" }] };
      return { rows: [] };
    });
    return { db: { execute, batch: async () => undefined } as unknown as DbClient, upserts, sql };
  }

  it("ingests all stops, rail routes and trips, and only the key stations' rail stop times", async () => {
    const zip = makeZip([
      { name: "stops.txt", text: STOPS },
      { name: "routes.txt", text: ROUTES },
      { name: "trips.txt", text: TRIPS },
      { name: "stop_times.txt", text: STOP_TIMES },
      { name: "shapes.txt", text: "shape_id,lat\nX,1\n" },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => zip.buffer })));
    const { db, upserts, sql } = mockDb();

    const result = await runGtfsSync(db);

    expect(result.errors).toEqual([]);
    expect(result.stopsIngested).toBe(3);
    expect(result.routesIngested).toBe(1);
    expect(result.tripsIngested).toBe(1);
    // The two Loganlea rows of the rail trip; not Central, not the bus trip, not the 5000 other trips.
    expect(result.stopTimesIngested).toBe(2);
    expect(upserts.get("transit_stop_times")).toBe(2);
    expect(result.keyStations.map((s) => s.name)).toContain("Loganlea");
    expect(sql.some((s) => s.startsWith("INSERT INTO gtfs_sync_log"))).toBe(true);
    expect(sql.some((s) => s.includes("UPDATE gtfs_sync_log SET") && s.includes("stop_times_ingested"))).toBe(true);
  });

  it("reports a feed that cannot be fetched as an error and completes the log row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })));
    const { db, sql } = mockDb();
    const result = await runGtfsSync(db);
    expect(result.errors[0]).toMatch(/^GTFS fetch failed: 404 /);
    expect(sql.some((s) => s.includes("UPDATE gtfs_sync_log SET errors"))).toBe(true);
  });
});
