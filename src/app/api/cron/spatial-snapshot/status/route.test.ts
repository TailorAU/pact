/**
 * tailor-group#38 — GET /api/cron/spatial-snapshot/status reports whether
 * the advisory lock is held and the job's cron_job_runs row as `lastRun`.
 * The snapshot has no log table of its own, so lastRun is the whole record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

const mockDb = {
  execute: vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  SPATIAL_SNAPSHOT_LOCK_KEY: 542505,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => {
    throw new Error("status must not check out a dedicated connection");
  },
}));

import { dynamic, GET } from "./route";
import { NextRequest } from "next/server";

function request(authorization: string | null = "Bearer cron-test-secret"): NextRequest {
  return new NextRequest("http://localhost/api/cron/spatial-snapshot/status", {
    headers: authorization ? { authorization } : undefined,
  });
}

const sqlOf = (stmt: string | { sql: string }) => (typeof stmt === "string" ? stmt : stmt.sql);

function armDb(held: boolean, lastRunRows: Record<string, unknown>[]) {
  mockDb.execute.mockImplementation(async (stmt) => {
    const sql = sqlOf(stmt);
    if (sql.includes("pg_locks")) return { rows: [{ held }] };
    if (sql.includes("cron_job_runs")) {
      expect((stmt as { args: unknown[] }).args).toEqual(["spatial-snapshot"]);
      return { rows: lastRunRows };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  mockDb.execute.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/spatial-snapshot/status", () => {
  it("is force-dynamic and answers 503 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request());

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it.each([null, "Bearer wrong"])("rejects a missing or mismatched bearer (%s)", async (authorization) => {
    const response = await GET(request(authorization));

    expect(response.status).toBe(401);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("probes the lock, then hands back lastRun with the per-layer summary — nothing else is read", async () => {
    armDb(false, [
      {
        job_id: "job-1",
        started_at: new Date("2026-09-22T02:00:00.000Z"),
        completed_at: new Date("2026-09-22T02:06:00.000Z"),
        ok: true,
        summary: { layersSynced: 5, layersErrored: 1, warning: true, results: [{ layerName: "flood", status: "error", featuresIngested: 0, errorDetail: "ArcGIS 503" }] },
      },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    expect(sqlOf(mockDb.execute.mock.calls[0][0])).toContain("pg_locks");
    expect(sqlOf(mockDb.execute.mock.calls[1][0])).toContain("cron_job_runs");
    await expect(response.json()).resolves.toEqual({
      running: false,
      lastRun: {
        jobId: "job-1",
        startedAt: "2026-09-22T02:00:00.000Z",
        completedAt: "2026-09-22T02:06:00.000Z",
        ok: true,
        summary: { layersSynced: 5, layersErrored: 1, warning: true, results: [{ layerName: "flood", status: "error", featuresIngested: 0, errorDetail: "ArcGIS 503" }] },
      },
    });
  });

  it("reports running:true and a lastRun still in flight (no completedAt, ok null)", async () => {
    armDb(true, [{ job_id: "job-2", started_at: "2026-09-22T02:00:00.000Z", completed_at: null, ok: null, summary: null }]);
    await expect((await GET(request())).json()).resolves.toEqual({
      running: true,
      lastRun: { jobId: "job-2", startedAt: "2026-09-22T02:00:00.000Z", completedAt: null, ok: null, summary: null },
    });
  });

  it("reports running:false and no lastRun on a fresh database", async () => {
    armDb(false, []);
    await expect((await GET(request())).json()).resolves.toEqual({ running: false, lastRun: null });
  });
});
