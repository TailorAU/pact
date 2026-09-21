/**
 * tailor-group#38 — GET /api/cron/legislation-sync/status reports whether
 * the advisory lock is held and the latest legislation_sync_log row per
 * jurisdiction in camelCase, with `errors` parsed from its JSON text.
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

/** Dispatch by SQL shape: the pg_locks probe vs the sync-log read. */
function armDb(held: boolean, rows: Record<string, unknown>[]) {
  mockDb.execute.mockImplementation(async (stmt) => {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    if (sql.includes("pg_locks")) return { rows: [{ held }] };
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
    await expect(response.json()).resolves.toEqual({
      running: true,
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

  it("reports running:false and an empty runs list on a fresh database", async () => {
    armDb(false, []);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ running: false, runs: [] });
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
