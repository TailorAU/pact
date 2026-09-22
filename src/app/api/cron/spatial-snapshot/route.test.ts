/**
 * tailor-group#38 — GET|POST /api/cron/spatial-snapshot answers 202 at once
 * and refreshes the layers behind the response under the
 * SPATIAL_SNAPSHOT_LOCK_KEY advisory lock. The cron_job_runs row keeps the
 * synchronous route's verdict: ok is false only when nothing synced and
 * something errored; summary.warning is true whenever a layer errored.
 * ?wait=1 keeps the synchronous 200/500 under the SAME lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db";
import type { LayerRefreshResult } from "@/lib/spatial-snapshot";

const mockDb = { execute: vi.fn(), batch: vi.fn() };
const mockClient = {
  query: vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
  release: vi.fn<(err?: Error) => void>(),
};

vi.mock("@/lib/db", () => ({
  SPATIAL_SNAPSHOT_LOCK_KEY: 542505,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => mockClient,
}));

const refreshLayer = vi.fn<(db: DbClient, name: string) => Promise<LayerRefreshResult>>();
vi.mock("@/lib/spatial-snapshot", () => ({
  LOGAN_LAYERS: {
    zoning: { url: "https://example.invalid/zoning", spatialBasis: "polygon", limitations: [] },
    flood: { url: "https://example.invalid/flood", spatialBasis: "polygon", limitations: [] },
  },
  refreshLayer: (db: DbClient, name: string) => refreshLayer(db, name),
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

import { dynamic, GET, POST } from "./route";
import { NextRequest } from "next/server";

const STARTED = new Date("2026-09-22T02:00:00.000Z");

function request(query = "", authorization: string | null = "Bearer cron-test-secret", method = "GET"): NextRequest {
  return new NextRequest(`http://localhost/api/cron/spatial-snapshot${query}`, {
    method,
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

const synced = (layerName: string, featuresIngested = 100): LayerRefreshResult => ({ layerName, status: "synced", featuresIngested });
const errored = (layerName: string, errorDetail: string): LayerRefreshResult => ({ layerName, status: "error", featuresIngested: 0, errorDetail });

/** Per-layer outcomes; a layer whose promise REJECTS (not an error result) is `reject: <reason>`. */
function armLayers(outcomes: Record<string, LayerRefreshResult | { reject: string }>) {
  refreshLayer.mockImplementation(async (_db, name) => {
    const outcome = outcomes[name];
    if (!outcome) throw new Error(`unexpected layer: ${name}`);
    if ("reject" in outcome) throw new Error(outcome.reject);
    return outcome;
  });
}

const flushImmediates = () => new Promise<void>(resolve => setImmediate(resolve));

function expectLockedThenReleased() {
  const texts = mockClient.query.mock.calls.map(([text]) => text);
  expect(texts.findIndex(t => t.includes("pg_try_advisory_lock"))).toBeLessThan(texts.findIndex(t => t.includes("pg_advisory_unlock")));
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_try_advisory_lock($1) AS acquired", [542505]);
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542505]);
  expect(mockClient.release).toHaveBeenCalledTimes(1);
  expect(mockClient.release.mock.calls[0]).toEqual([]);
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  mockDb.execute.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  refreshLayer.mockReset();
  armLayers({ zoning: synced("zoning", 120), flood: synced("flood", 40) });
  logInfo.mockReset();
  logError.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/spatial-snapshot", () => {
  it("is force-dynamic and answers 503 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request());

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(503);
    expect(refreshLayer).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it.each([null, "Bearer wrong"])("rejects a missing or mismatched bearer (%s)", async (authorization) => {
    const response = await GET(request("", authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(refreshLayer).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("answers 202 started:false with the target layers when a snapshot already holds the lock", async () => {
    armClient(false);

    const response = await GET(request("?layer=flood"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ started: false, running: true, layers: ["flood"] });
    await flushImmediates();
    expect(refreshLayer).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("answers 202 started:true, refreshes every layer after the response, and records ok:true without a warning", async () => {
    armClient(true);

    const response = await POST(request("", "Bearer cron-test-secret", "POST"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      started: true,
      jobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      startedAt: "2026-09-22T02:00:00.000Z",
      layers: ["zoning", "flood"],
    });
    expect(refreshLayer).not.toHaveBeenCalled();

    await flushImmediates();
    await flushImmediates();
    expect(refreshLayer).toHaveBeenCalledTimes(2);
    expect(refreshLayer).toHaveBeenCalledWith(mockDb, "zoning");
    expect(refreshLayer).toHaveBeenCalledWith(mockDb, "flood");
    expectLockedThenReleased();
    expect(recordedCompletion()).toEqual({
      jobId: expect.any(String),
      ok: true,
      summary: {
        layersSynced: 2,
        layersErrored: 0,
        warning: false,
        results: [synced("zoning", 120), synced("flood", 40)],
      },
    });
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.spatial-snapshot.completed" }), expect.any(String));
  });

  it("records ok:true with warning:true and the layer's errorDetail when SOME layers errored (ArcGIS throttle)", async () => {
    armClient(true);
    armLayers({ zoning: synced("zoning"), flood: errored("flood", "ArcGIS 503 Service Unavailable") });

    await GET(request());
    await flushImmediates();
    await flushImmediates();

    expect(recordedCompletion()).toMatchObject({
      ok: true,
      summary: { layersSynced: 1, layersErrored: 1, warning: true, results: [synced("zoning"), errored("flood", "ArcGIS 503 Service Unavailable")] },
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it("records ok:false with warning:true when EVERY layer errored, folding a rejected refresh into an error result", async () => {
    armClient(true);
    armLayers({ zoning: errored("zoning", "ArcGIS 503"), flood: { reject: "socket hang up" } });

    await GET(request());
    await flushImmediates();
    await flushImmediates();

    expect(recordedCompletion()).toMatchObject({
      ok: false,
      summary: {
        layersSynced: 0,
        layersErrored: 2,
        warning: true,
        results: [errored("zoning", "ArcGIS 503"), { layerName: "unknown", status: "error", featuresIngested: 0, errorDetail: "Error: socket hang up" }],
      },
    });
    expect(logError).not.toHaveBeenCalled(); // the run itself completed; the layers are the story
    expectLockedThenReleased();
  });

  it("?wait=1 keeps the synchronous 200 with the results and takes and releases the lock", async () => {
    armClient(true);

    const response = await GET(request("?wait=1&layer=zoning"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Spatial snapshot complete: 1 layers synced, 0 errors",
      results: [synced("zoning", 120)],
      timestamp: expect.any(String),
    });
    expect(refreshLayer).toHaveBeenCalledTimes(1);
    expect(refreshLayer).toHaveBeenCalledWith(mockDb, "zoning");
    expectLockedThenReleased();
    expect(recordedCompletion()).toMatchObject({ ok: true });
  });

  it("?wait=1 keeps the synchronous 500 when nothing synced and something errored", async () => {
    armClient(true);
    armLayers({ zoning: errored("zoning", "ArcGIS 503"), flood: errored("flood", "ArcGIS 503") });

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).toBe("Spatial snapshot complete: 0 layers synced, 2 errors");
    expectLockedThenReleased();
    expect(recordedCompletion()).toMatchObject({ ok: false, summary: { warning: true } });
  });

  it("?wait=1 answers 202 started:false and refreshes nothing while a snapshot holds the lock", async () => {
    armClient(false);

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ started: false, running: true, layers: ["zoning", "flood"] });
    expect(refreshLayer).not.toHaveBeenCalled();
  });
});
