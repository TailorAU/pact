/**
 * tailor-group#38 — GET /api/cron/legislation-sync/status reports whether
 * the advisory lock is held, the job's cron_job_runs row as `lastRun`, and
 * the latest legislation_sync_log row per jurisdiction in camelCase, with
 * `errors` parsed from its JSON text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

const mockDb = {
  execute: vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  LEGISLATION_SYNC_LOCK_KEY: 542502,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => {
    throw new Error("status must not check out a dedicated connection");
  },
}));

import { dynamic, GET } from "./route";
import { NextRequest } from "next/server";

function request(authorization: string | null = "Bearer cron-test-secret"): NextRequest {
  return new NextRequest("http://localhost/api/cron/legislation-sync/status", {
    headers: authorization ? { authorization } : undefined,
  });
}

const LAST_RUN_ROW = {
  job_id: "job-7",
  started_at: new Date("2026-09-21T06:00:00.000Z"),
  completed_at: null,
  ok: null,
  summary: null,
};

/** Dispatch by SQL shape: the pg_locks probe, the cron_job_runs row, the sync-log read. */
function armDb(held: boolean, rows: Record<string, unknown>[], lastRunRows: Record<string, unknown>[] = [LAST_RUN_ROW]) {
  mockDb.execute.mockImplementation(async (stmt) => {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    if (sql.includes("pg_locks")) return { rows: [{ held }] };
    if (sql.includes("cron_job_runs")) return { rows: lastRunRows };
    if (sql.includes("legislation_sync_log")) {
      expect(sql).toContain("DISTINCT ON (jurisdiction)");
      return { rows };
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

describe("GET /api/cron/legislation-sync/status", () => {
  it("is force-dynamic and answers 503 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request());

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ error: "CRON_SECRET not configured" });
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it.each([null, "Bearer wrong"])("rejects a missing or mismatched bearer (%s)", async (authorization) => {
    const response = await GET(request(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("maps the latest row per jurisdiction and parses the errors JSON", async () => {
    armDb(true, [
      {
        id: "run-cth",
        jurisdiction: "CTH",
        started_at: new Date("2026-09-21T06:00:01.500Z"),
        completed_at: null,
        docs_checked: 50,
        docs_updated: 4,
        sections_total: 1200,
        errors: '["Titles fetch failed: 503","parse: Act 12 has no sections"]',
        parser_crash_count: 1,
        parser_anomaly_count: 2,
        silent_zero_flag: null,
      },
      {
        id: "run-qld",
        jurisdiction: "QLD",
        started_at: "2026-09-14T06:00:00.000Z",
        completed_at: new Date("2026-09-14T06:03:10.000Z"),
        docs_checked: 0,
        docs_updated: 0,
        sections_total: 0,
        errors: null,
        parser_crash_count: 0,
        parser_anomaly_count: 0,
        silent_zero_flag: true,
      },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    // The lock is probed BEFORE the rows are read, and the reads wait for the
    // probe: a lock seen free guarantees the rows read next carry the run's
    // completed_at (the job commits, then unlocks).
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
    const sqlOf = (stmt: string | { sql: string }) => (typeof stmt === "string" ? stmt : stmt.sql);
    expect(sqlOf(mockDb.execute.mock.calls[0][0])).toContain("pg_locks");
    expect(sqlOf(mockDb.execute.mock.calls[1][0])).toContain("cron_job_runs");
    expect(sqlOf(mockDb.execute.mock.calls[2][0])).toContain("legislation_sync_log");
    await expect(response.json()).resolves.toEqual({
      running: true,
      lastRun: { jobId: "job-7", startedAt: "2026-09-21T06:00:00.000Z", completedAt: null, ok: null, summary: null },
      runs: [
        {
          id: "run-cth",
          jurisdiction: "CTH",
          startedAt: "2026-09-21T06:00:01.500Z",
          completedAt: null,
          docsChecked: 50,
          docsUpdated: 4,
          sectionsTotal: 1200,
          errors: ["Titles fetch failed: 503", "parse: Act 12 has no sections"],
          parserCrashCount: 1,
          parserAnomalyCount: 2,
          silentZeroFlag: false,
        },
        {
          id: "run-qld",
          jurisdiction: "QLD",
          startedAt: "2026-09-14T06:00:00.000Z",
          completedAt: "2026-09-14T06:03:10.000Z",
          docsChecked: 0,
          docsUpdated: 0,
          sectionsTotal: 0,
          errors: [],
          parserCrashCount: 0,
          parserAnomalyCount: 0,
          silentZeroFlag: true,
        },
      ],
    });
  });

  it("does not read the sync log until the lock probe has answered", async () => {
    let answerProbe!: (held: boolean) => void;
    mockDb.execute.mockImplementation(async (stmt) => {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      if (sql.includes("pg_locks")) {
        return new Promise(resolve => { answerProbe = (held) => resolve({ rows: [{ held }] }); });
      }
      if (sql.includes("cron_job_runs")) return { rows: [] };
      if (sql.includes("legislation_sync_log")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const pending = GET(request());
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(mockDb.execute).toHaveBeenCalledTimes(1); // the probe is in flight; no row read yet

    answerProbe(false);
    const response = await pending;
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
    await expect(response.json()).resolves.toEqual({ running: false, lastRun: null, runs: [] });
  });

  it("reports running:false, no lastRun and an empty runs list on a fresh database", async () => {
    armDb(false, [], []);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ running: false, lastRun: null, runs: [] });
  });

  it("hands back a completed lastRun with the per-jurisdiction summary the trigger recorded", async () => {
    armDb(false, [], [
      {
        job_id: "job-8",
        started_at: new Date("2026-09-21T06:00:00.000Z"),
        completed_at: new Date("2026-09-21T06:09:30.000Z"),
        ok: false,
        summary: { jurisdictions: [{ jurisdiction: "QLD", docsChecked: 0, errorCount: 1, firstError: "401 Unauthorized" }] },
      },
    ]);

    const body = await (await GET(request())).json();
    expect(body.lastRun).toEqual({
      jobId: "job-8",
      startedAt: "2026-09-21T06:00:00.000Z",
      completedAt: "2026-09-21T06:09:30.000Z",
      ok: false,
      summary: { jurisdictions: [{ jurisdiction: "QLD", docsChecked: 0, errorCount: 1, firstError: "401 Unauthorized" }] },
    });
  });

  it("treats malformed errors text as no errors rather than failing the poll", async () => {
    armDb(false, [
      {
        id: "run-x",
        jurisdiction: "CTH",
        started_at: new Date("2026-09-21T06:00:00.000Z"),
        completed_at: new Date("2026-09-21T06:02:00.000Z"),
        docs_checked: 1,
        docs_updated: 0,
        sections_total: 0,
        errors: "{not json",
        parser_crash_count: 0,
        parser_anomaly_count: 0,
        silent_zero_flag: false,
      },
    ]);

    const body = await (await GET(request())).json();
    expect(body.runs[0].errors).toEqual([]);
  });
});
