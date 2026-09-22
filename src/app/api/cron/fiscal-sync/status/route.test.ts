/**
 * tailor-group#38 — GET /api/cron/fiscal-sync/status reports whether the
 * advisory lock is held, the job's cron_job_runs row as `lastRun`, and the
 * latest fiscal_sync_log row per jurisdiction in camelCase, with `errors`
 * accepted as parsed JSONB or as its JSON text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

const mockDb = {
  execute: vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  FISCAL_SYNC_LOCK_KEY: 542504,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => {
    throw new Error("status must not check out a dedicated connection");
  },
}));

import { dynamic, GET } from "./route";
import { NextRequest } from "next/server";

function request(authorization: string | null = "Bearer cron-test-secret"): NextRequest {
  return new NextRequest("http://localhost/api/cron/fiscal-sync/status", {
    headers: authorization ? { authorization } : undefined,
  });
}

const sqlOf = (stmt: string | { sql: string }) => (typeof stmt === "string" ? stmt : stmt.sql);

function armDb(held: boolean, lastRunRows: Record<string, unknown>[], logRows: Record<string, unknown>[]) {
  mockDb.execute.mockImplementation(async (stmt) => {
    const sql = sqlOf(stmt);
    if (sql.includes("pg_locks")) return { rows: [{ held }] };
    if (sql.includes("cron_job_runs")) {
      expect((stmt as { args: unknown[] }).args).toEqual(["fiscal-sync"]);
      return { rows: lastRunRows };
    }
    if (sql.includes("fiscal_sync_log")) {
      expect(sql).toContain("DISTINCT ON (jurisdiction)");
      return { rows: logRows };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
}

function logRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "log-1",
    jurisdiction: "QLD",
    started_at: new Date("2026-09-21T18:00:00.500Z"),
    completed_at: new Date("2026-09-21T18:00:03.000Z"),
    lines_checked: 12,
    lines_written: 12,
    model_version: "qld-recon@1.0.0",
    anomaly_count: 0,
    crash_count: 0,
    silent_zero_flag: false,
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  mockDb.execute.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/fiscal-sync/status", () => {
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

  it("probes the lock, then maps lastRun and the latest row per jurisdiction", async () => {
    armDb(
      false,
      [
        {
          job_id: "job-1",
          started_at: new Date("2026-09-21T18:00:00.000Z"),
          completed_at: new Date("2026-09-21T18:00:03.000Z"),
          ok: true,
          summary: { status: "synced", linesWritten: 12 },
        },
      ],
      [logRow()]
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
    expect(sqlOf(mockDb.execute.mock.calls[0][0])).toContain("pg_locks");
    expect(sqlOf(mockDb.execute.mock.calls[1][0])).toContain("cron_job_runs");
    expect(sqlOf(mockDb.execute.mock.calls[2][0])).toContain("fiscal_sync_log");
    await expect(response.json()).resolves.toEqual({
      running: false,
      lastRun: {
        jobId: "job-1",
        startedAt: "2026-09-21T18:00:00.000Z",
        completedAt: "2026-09-21T18:00:03.000Z",
        ok: true,
        summary: { status: "synced", linesWritten: 12 },
      },
      runs: [
        {
          id: "log-1",
          jurisdiction: "QLD",
          startedAt: "2026-09-21T18:00:00.500Z",
          completedAt: "2026-09-21T18:00:03.000Z",
          linesChecked: 12,
          linesWritten: 12,
          modelVersion: "qld-recon@1.0.0",
          anomalyCount: 0,
          crashCount: 0,
          silentZeroFlag: false,
          errors: [],
        },
      ],
    });
  });

  it("accepts errors as parsed JSONB, as JSON text, and treats malformed text as none", async () => {
    armDb(true, [], [
      logRow({ id: "a", jurisdiction: "QLD", errors: ["upsert failed: 23505"] }),
      logRow({ id: "b", jurisdiction: "NSW", errors: '["no seed for NSW"]', model_version: null }),
      logRow({ id: "c", jurisdiction: "VIC", errors: "{not json" }),
    ]);

    const body = await (await GET(request())).json();
    expect(body.running).toBe(true);
    expect(body.runs.map((r: { id: string; errors: string[]; modelVersion: string | null }) => [r.id, r.errors, r.modelVersion])).toEqual([
      ["a", ["upsert failed: 23505"], "qld-recon@1.0.0"],
      ["b", ["no seed for NSW"], null],
      ["c", [], "qld-recon@1.0.0"],
    ]);
  });

  it("reports running:false, no lastRun and no runs on a fresh database", async () => {
    armDb(false, [], []);
    await expect((await GET(request())).json()).resolves.toEqual({ running: false, lastRun: null, runs: [] });
  });
});
