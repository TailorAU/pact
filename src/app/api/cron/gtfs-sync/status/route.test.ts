/**
 * tailor-group#38 — GET /api/cron/gtfs-sync/status reports whether the
 * advisory lock is held, the job's cron_job_runs row as `lastRun`, and the
 * latest gtfs_sync_log row in camelCase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

const mockDb = {
  execute: vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  GTFS_SYNC_LOCK_KEY: 542503,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => {
    throw new Error("status must not check out a dedicated connection");
  },
}));

import { dynamic, GET } from "./route";
import { NextRequest } from "next/server";

function request(authorization: string | null = "Bearer cron-test-secret"): NextRequest {
  return new NextRequest("http://localhost/api/cron/gtfs-sync/status", {
    headers: authorization ? { authorization } : undefined,
  });
}

const sqlOf = (stmt: string | { sql: string }) => (typeof stmt === "string" ? stmt : stmt.sql);

function armDb(held: boolean, lastRunRows: Record<string, unknown>[], logRows: Record<string, unknown>[]) {
  mockDb.execute.mockImplementation(async (stmt) => {
    const sql = sqlOf(stmt);
    if (sql.includes("pg_locks")) return { rows: [{ held }] };
    if (sql.includes("cron_job_runs")) {
      expect((stmt as { args: unknown[] }).args).toEqual(["gtfs-sync"]);
      return { rows: lastRunRows };
    }
    if (sql.includes("gtfs_sync_log")) {
      expect(sql).toContain("ORDER BY started_at DESC");
      expect(sql).toContain("LIMIT 1");
      return { rows: logRows };
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

describe("GET /api/cron/gtfs-sync/status", () => {
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
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("probes the lock, then maps lastRun and the latest log row", async () => {
    armDb(
      false,
      [
        {
          job_id: "job-1",
          started_at: new Date("2026-09-21T17:00:00.000Z"),
          completed_at: new Date("2026-09-21T17:14:00.000Z"),
          ok: true,
          summary: { stopsIngested: 8200, errors: [] },
        },
      ],
      [
        {
          id: "log-1",
          feed_url: "https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip",
          started_at: new Date("2026-09-21T17:00:00.500Z"),
          completed_at: new Date("2026-09-21T17:14:00.000Z"),
          stops_ingested: 8200,
          routes_ingested: 410,
          trips_ingested: 52000,
          stop_times_ingested: 1400000,
          errors: null,
        },
      ]
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
    expect(sqlOf(mockDb.execute.mock.calls[0][0])).toContain("pg_locks");
    expect(sqlOf(mockDb.execute.mock.calls[1][0])).toContain("cron_job_runs");
    expect(sqlOf(mockDb.execute.mock.calls[2][0])).toContain("gtfs_sync_log");
    await expect(response.json()).resolves.toEqual({
      running: false,
      lastRun: {
        jobId: "job-1",
        startedAt: "2026-09-21T17:00:00.000Z",
        completedAt: "2026-09-21T17:14:00.000Z",
        ok: true,
        summary: { stopsIngested: 8200, errors: [] },
      },
      runs: [
        {
          id: "log-1",
          feedUrl: "https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip",
          startedAt: "2026-09-21T17:00:00.500Z",
          completedAt: "2026-09-21T17:14:00.000Z",
          stopsIngested: 8200,
          routesIngested: 410,
          tripsIngested: 52000,
          stopTimesIngested: 1400000,
          errors: [],
        },
      ],
    });
  });

  it("reports the log row's free-text error as a one-element list and running:true while the lock is held", async () => {
    armDb(true, [], [
      {
        id: "log-2",
        feed_url: "https://example.invalid/feed.zip",
        started_at: "2026-09-21T17:00:00.000Z",
        completed_at: "2026-09-21T17:00:05.000Z",
        stops_ingested: 0,
        routes_ingested: 0,
        trips_ingested: 0,
        stop_times_ingested: 0,
        errors: "fetch failed: 503",
      },
    ]);

    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ running: true, lastRun: null });
    expect(body.runs[0].errors).toEqual(["fetch failed: 503"]);
  });

  it("reports running:false, no lastRun and no runs on a fresh database", async () => {
    armDb(false, [], []);
    await expect((await GET(request())).json()).resolves.toEqual({ running: false, lastRun: null, runs: [] });
  });
});
