/**
 * tailor-group#38 — GET|POST /api/cron/fiscal-sync answers 202 at once and
 * runs the reconstruction behind the response under the FISCAL_SYNC_LOCK_KEY
 * advisory lock, recording ok = status !== "error" in cron_job_runs; ?wait=1
 * keeps the synchronous 200/500 under the SAME lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db";
import type { FiscalSyncResult } from "@/lib/fiscal-sync";

const mockDb = { execute: vi.fn(), batch: vi.fn() };
const mockClient = {
  query: vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
  release: vi.fn<(err?: Error) => void>(),
};

vi.mock("@/lib/db", () => ({
  FISCAL_SYNC_LOCK_KEY: 542504,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => mockClient,
}));

const runFiscalSync = vi.fn<(db: DbClient, opts: { jurisdiction?: string }) => Promise<FiscalSyncResult>>();
vi.mock("@/lib/fiscal-sync", () => ({
  runFiscalSync: (db: DbClient, opts: { jurisdiction?: string }) => runFiscalSync(db, opts),
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

const STARTED = new Date("2026-09-21T18:00:00.000Z");

function request(query = "", authorization: string | null = "Bearer cron-test-secret", method = "GET"): NextRequest {
  return new NextRequest(`http://localhost/api/cron/fiscal-sync${query}`, {
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

function syncResult(status: FiscalSyncResult["status"] = "synced", extra: Partial<FiscalSyncResult> = {}): FiscalSyncResult {
  return { jurisdiction: "QLD", status, linesWritten: 9, forecastLinesWritten: 3, ...extra };
}

const flushImmediates = () => new Promise<void>(resolve => setImmediate(resolve));

function expectLockedThenReleased() {
  const texts = mockClient.query.mock.calls.map(([text]) => text);
  expect(texts.findIndex(t => t.includes("pg_try_advisory_lock"))).toBeLessThan(texts.findIndex(t => t.includes("pg_advisory_unlock")));
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_try_advisory_lock($1) AS acquired", [542504]);
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542504]);
  expect(mockClient.release).toHaveBeenCalledTimes(1);
  expect(mockClient.release.mock.calls[0]).toEqual([]);
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  mockDb.execute.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  runFiscalSync.mockReset();
  runFiscalSync.mockResolvedValue(syncResult());
  logInfo.mockReset();
  logError.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/fiscal-sync", () => {
  it("is force-dynamic and answers 503 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request());

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(503);
    expect(runFiscalSync).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it.each([null, "Bearer wrong"])("rejects a missing or mismatched bearer (%s)", async (authorization) => {
    const response = await GET(request("", authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(runFiscalSync).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("answers 202 started:false when a sync already holds the lock", async () => {
    armClient(false);

    const response = await GET(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ started: false, running: true, jurisdiction: "QLD" });
    await flushImmediates();
    expect(runFiscalSync).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("answers 202 started:true, runs the sync for the jurisdiction after the response, and records ok:true", async () => {
    armClient(true);

    const response = await POST(request("?jurisdiction=NSW", "Bearer cron-test-secret", "POST"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      started: true,
      jobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      startedAt: "2026-09-21T18:00:00.000Z",
      jurisdiction: "NSW",
    });
    expect(runFiscalSync).not.toHaveBeenCalled();

    await flushImmediates();
    await flushImmediates();
    expect(runFiscalSync).toHaveBeenCalledTimes(1);
    expect(runFiscalSync).toHaveBeenCalledWith(mockDb, { jurisdiction: "NSW" });
    expectLockedThenReleased();
    expect(recordedCompletion()).toEqual({
      jobId: expect.any(String),
      ok: true,
      summary: { jurisdiction: "QLD", status: "synced", linesWritten: 9, forecastLinesWritten: 3, errorDetail: null },
    });
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.fiscal-sync.completed" }), expect.any(String));
  });

  it("records ok:false with the errorDetail when the sync ends in status error (the old 500)", async () => {
    armClient(true);
    runFiscalSync.mockResolvedValue(syncResult("error", { linesWritten: 0, forecastLinesWritten: 0, errorDetail: "seed missing" }));

    await GET(request());
    await flushImmediates();
    await flushImmediates();

    expect(recordedCompletion()).toMatchObject({ ok: false, summary: { status: "error", linesWritten: 0, errorDetail: "seed missing" } });
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs cron.fiscal-sync.failed and releases the lock when the sync throws", async () => {
    armClient(true);
    runFiscalSync.mockRejectedValue(new Error("relation fiscal_line does not exist"));

    const response = await GET(request());
    expect(response.status).toBe(202);

    await flushImmediates();
    await flushImmediates();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.fiscal-sync.failed" }), expect.any(String));
    expect(recordedCompletion()).toMatchObject({ ok: false, summary: { error: "relation fiscal_line does not exist" } });
    expectLockedThenReleased();
  });

  it("?wait=1 keeps the synchronous 200 with the result and takes and releases the lock", async () => {
    armClient(true);

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("Fiscal sync synced: 9 lines + 3 forecast lines written");
    expect(body.result).toEqual(syncResult());
    expect(runFiscalSync).toHaveBeenCalledWith(mockDb, { jurisdiction: "QLD" });
    expectLockedThenReleased();
    expect(recordedCompletion()).toMatchObject({ ok: true });
  });

  it("?wait=1 keeps the synchronous 500 when the sync ends in status error", async () => {
    armClient(true);
    runFiscalSync.mockResolvedValue(syncResult("error", { linesWritten: 0, forecastLinesWritten: 0, errorDetail: "seed missing" }));

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).toBe("Fiscal sync error: 0 lines + 0 forecast lines written");
    expectLockedThenReleased();
  });

  it("?wait=1 answers 202 started:false and runs nothing while a sync holds the lock", async () => {
    armClient(false);

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ started: false, running: true, jurisdiction: "QLD" });
    expect(runFiscalSync).not.toHaveBeenCalled();
  });

  it("?wait=1 answers 500 { error, message } when the synchronous sync throws, after releasing the lock", async () => {
    armClient(true);
    runFiscalSync.mockRejectedValue(new Error("boom"));

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Fiscal sync failed", message: "Error: boom", timestamp: expect.any(String) });
    expectLockedThenReleased();
  });
});
