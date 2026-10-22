/**
 * tailor-group#38 — GET /api/cron/gtfs-sync answers 202 at once and runs the
 * sync behind the response under the GTFS_SYNC_LOCK_KEY advisory lock,
 * recording ok = no errors in cron_job_runs; ?wait=1 keeps the synchronous
 * 200 under the SAME lock. The detached-job helper runs for real against a
 * mocked dedicated connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db";
import type { GtfsSyncResult } from "@/lib/gtfs-sync";

const mockDb = { execute: vi.fn(), batch: vi.fn() };
const mockClient = {
  query: vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
  release: vi.fn<(err?: Error) => void>(),
};

vi.mock("@/lib/db", () => ({
  GTFS_SYNC_LOCK_KEY: 542503,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => mockClient,
}));

const runGtfsSync = vi.fn<(db: DbClient) => Promise<GtfsSyncResult>>();
vi.mock("@/lib/gtfs-sync", () => ({
  runGtfsSync: (db: DbClient) => runGtfsSync(db),
}));

const logInfo = vi.fn();
const logError = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: {
    info: (...args: unknown[]) => logInfo(...args),
    warn: vi.fn(),
    error: (...args: unknown[]) => logError(...args),
  },
}));

import { dynamic, GET } from "./route";
import { NextRequest } from "next/server";

const STARTED = new Date("2026-09-21T17:00:00.000Z");

function request(query = "", authorization: string | null = "Bearer cron-test-secret"): NextRequest {
  return new NextRequest(`http://localhost/api/cron/gtfs-sync${query}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

function armClient(acquired: boolean) {
  mockClient.query.mockImplementation(async (text: string) => {
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired }] };
    if (text.includes("INSERT INTO cron_job_runs")) return { rows: [{ started_at: STARTED }] };
    if (text.includes("UPDATE cron_job_runs")) return { rows: [] };
    if (text.includes("pg_advisory_unlock")) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
}

function recordedCompletion(): { jobId: string; ok: boolean; summary: unknown } | null {
  const call = mockClient.query.mock.calls.find(([text]) => text.includes("UPDATE cron_job_runs"));
  if (!call) return null;
  const [, values] = call;
  return { jobId: String(values?.[0]), ok: values?.[1] as boolean, summary: JSON.parse(String(values?.[2])) };
}

function syncResult(errors: string[] = []): GtfsSyncResult {
  return {
    stopsIngested: 8200,
    routesIngested: 410,
    tripsIngested: 52000,
    stopTimesIngested: 1400000,
    keyStations: [{ name: "Central", stopId: "600000", lat: -27.4659, lon: 153.0261 }],
    errors,
  };
}

const flushImmediates = () => new Promise<void>(resolve => setImmediate(resolve));

function expectLockedThenReleased() {
  const texts = mockClient.query.mock.calls.map(([text]) => text);
  expect(texts.findIndex(t => t.includes("pg_try_advisory_lock"))).toBeLessThan(texts.findIndex(t => t.includes("pg_advisory_unlock")));
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_try_advisory_lock($1) AS acquired", [542503]);
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542503]);
  expect(mockClient.release).toHaveBeenCalledTimes(1);
  expect(mockClient.release.mock.calls[0]).toEqual([]);
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  mockDb.execute.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  runGtfsSync.mockReset();
  runGtfsSync.mockResolvedValue(syncResult());
  logInfo.mockReset();
  logError.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/gtfs-sync", () => {
  it("is force-dynamic and answers 503 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request());

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "CRON_SECRET not configured" });
    expect(runGtfsSync).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it.each([null, "Bearer wrong"])("rejects a missing or mismatched bearer (%s)", async (authorization) => {
    const response = await GET(request("", authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(runGtfsSync).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("answers 202 started:false when a sync already holds the lock", async () => {
    armClient(false);

    const response = await GET(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ started: false, running: true });
    await flushImmediates();
    expect(runGtfsSync).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("answers 202 started:true, runs the sync once after the response, and records ok:true with the counts", async () => {
    armClient(true);

    const response = await GET(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      started: true,
      jobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      startedAt: "2026-09-21T17:00:00.000Z",
    });
    expect(runGtfsSync).not.toHaveBeenCalled();

    await flushImmediates();
    await flushImmediates();
    expect(runGtfsSync).toHaveBeenCalledTimes(1);
    expect(runGtfsSync).toHaveBeenCalledWith(mockDb);
    expectLockedThenReleased();
    expect(recordedCompletion()).toEqual({
      jobId: expect.any(String),
      ok: true,
      summary: { stopsIngested: 8200, routesIngested: 410, tripsIngested: 52000, stopTimesIngested: 1400000, keyStations: 1, errors: [] },
    });
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.gtfs-sync.completed" }), expect.any(String));
  });

  it("records ok:false with the error strings when the sync caught a failure (it never throws for a bad feed)", async () => {
    armClient(true);
    runGtfsSync.mockResolvedValue({ ...syncResult(["fetch https://gtfsrt.api.translink.com.au/... 503"]), stopsIngested: 0 });

    await GET(request());
    await flushImmediates();
    await flushImmediates();

    expect(recordedCompletion()).toMatchObject({ ok: false, summary: { stopsIngested: 0, errors: ["fetch https://gtfsrt.api.translink.com.au/... 503"] } });
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs cron.gtfs-sync.failed and releases the lock when the sync throws", async () => {
    armClient(true);
    runGtfsSync.mockRejectedValue(new Error("relation transit_stops does not exist"));

    const response = await GET(request());
    expect(response.status).toBe(202);

    await flushImmediates();
    await flushImmediates();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.gtfs-sync.failed" }), expect.any(String));
    expect(recordedCompletion()).toMatchObject({ ok: false, summary: { error: "relation transit_stops does not exist" } });
    expectLockedThenReleased();
  });

  it("?wait=1 keeps the synchronous 200 with the counts and takes and releases the lock", async () => {
    armClient(true);

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "GTFS sync complete: 8200 stops, 410 routes, 52000 trips, 1400000 stop_times",
      stopsIngested: 8200,
      routesIngested: 410,
      tripsIngested: 52000,
      stopTimesIngested: 1400000,
      keyStations: [{ name: "Central", stopId: "600000", lat: -27.4659, lon: 153.0261 }],
      errors: [],
    });
    expect(runGtfsSync).toHaveBeenCalledTimes(1);
    expectLockedThenReleased();
    expect(recordedCompletion()).toMatchObject({ ok: true });
  });

  it("?wait=1 answers 202 started:false and runs nothing while a sync holds the lock", async () => {
    armClient(false);

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ started: false, running: true });
    expect(runGtfsSync).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), expect.anything());
  });

  it("?wait=1 answers 500 when the synchronous sync throws, after releasing the lock", async () => {
    armClient(true);
    runGtfsSync.mockRejectedValue(new Error("boom"));

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "GTFS sync failed: boom" });
    expectLockedThenReleased();
  });
});
