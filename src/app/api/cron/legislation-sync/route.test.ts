/**
 * tailor-group#38 — GET /api/cron/legislation-sync answers 202 at once and
 * runs the sync behind the response under the advisory lock; ?wait=1 keeps
 * the synchronous 200 under the SAME lock. The detached-job helper runs for
 * real against a mocked dedicated connection so the trigger → job hand-off
 * and the lock protocol on both paths are exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db";
import type { SyncResult } from "@/lib/legislation-sync";

const mockDb = { execute: vi.fn(), batch: vi.fn() };
const mockClient = {
  query: vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
  release: vi.fn<(err?: Error) => void>(),
};

vi.mock("@/lib/db", () => ({
  LEGISLATION_SYNC_LOCK_KEY: 542502,
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => mockClient,
}));

const runLegislationSync = vi.fn<(jurisdictions?: string[]) => Promise<SyncResult[]>>();
vi.mock("@/lib/legislation-sync", () => ({
  DEFAULT_LEGISLATION_JURISDICTIONS: ["CTH", "QLD"],
  runLegislationSync: (jurisdictions?: string[]) => runLegislationSync(jurisdictions),
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

const STARTED = new Date("2026-09-21T06:00:00.000Z");

function request(query = "", authorization: string | null = "Bearer cron-test-secret"): NextRequest {
  return new NextRequest(`http://localhost/api/cron/legislation-sync${query}`, {
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

/** The cron_job_runs completion stamp: `[job_id, ok, summary json]`. */
function recordedCompletion(): { jobId: string; ok: boolean; summary: unknown } | null {
  const call = mockClient.query.mock.calls.find(([text]) => text.includes("UPDATE cron_job_runs"));
  if (!call) return null;
  const [, values] = call;
  return { jobId: String(values?.[0]), ok: values?.[1] as boolean, summary: JSON.parse(String(values?.[2])) };
}

function syncResult(jurisdiction: string, docsUpdated = 0, errors: string[] = []): SyncResult {
  return {
    jurisdiction,
    docsChecked: 3,
    docsUpdated,
    sectionsTotal: 12,
    errors,
    parserVersion: "test",
    parserAnomalyCount: 0,
    parserCrashCount: 0,
  };
}

const flushImmediates = () => new Promise<void>(resolve => setImmediate(resolve));

/** Lock taken, then unlocked, then the connection went back to the pool reusable. */
function expectLockedThenReleased() {
  const texts = mockClient.query.mock.calls.map(([text]) => text);
  const lockAt = texts.findIndex(t => t.includes("pg_try_advisory_lock"));
  const unlockAt = texts.findIndex(t => t.includes("pg_advisory_unlock"));
  expect(lockAt).toBeGreaterThan(-1);
  expect(unlockAt).toBeGreaterThan(lockAt);
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_try_advisory_lock($1) AS acquired", [542502]);
  expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542502]);
  expect(mockClient.release).toHaveBeenCalledTimes(1);
  expect(mockClient.release.mock.calls[0]).toEqual([]);
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  mockDb.execute.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  runLegislationSync.mockReset();
  runLegislationSync.mockResolvedValue([syncResult("CTH", 1), syncResult("QLD")]);
  logInfo.mockReset();
  logError.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/legislation-sync", () => {
  it("is force-dynamic and answers 503 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request());

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "CRON_SECRET not configured" });
    expect(runLegislationSync).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it.each([null, "Bearer wrong", "bearer cron-test-secret"])(
    "rejects a missing or mismatched bearer (%s)",
    async (authorization) => {
      const response = await GET(request("", authorization));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
      expect(runLegislationSync).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    }
  );

  it("answers 202 started:false when a sync already holds the lock", async () => {
    armClient(false);

    const response = await GET(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      started: false,
      running: true,
      jurisdictions: ["CTH", "QLD"],
    });
    await flushImmediates();
    expect(runLegislationSync).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("answers 202 started:true and runs the sync once after the response", async () => {
    armClient(true);

    const response = await GET(request("?jurisdiction=qld,%20cth"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      started: true,
      jobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      startedAt: "2026-09-21T06:00:00.000Z",
      jurisdictions: ["QLD", "CTH"],
    });
    // Not yet: the job runs behind the response.
    expect(runLegislationSync).not.toHaveBeenCalled();

    await flushImmediates();
    await flushImmediates();
    expect(runLegislationSync).toHaveBeenCalledTimes(1);
    expect(runLegislationSync).toHaveBeenCalledWith(["QLD", "CTH"]);
    expectLockedThenReleased();
    expect(recordedCompletion()).toEqual({ jobId: expect.any(String), ok: true, summary: { jurisdictions: expect.any(Array) } });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.legislation-sync.completed" }),
      expect.any(String)
    );
  });

  it("records ok:false with each jurisdiction's counts and FIRST error string when a jurisdiction reports errors", async () => {
    armClient(true);
    runLegislationSync.mockResolvedValue([
      syncResult("CTH", 49, ["Rejected cth/act-2026-082: sections[3].id duplicate"]),
      syncResult("QLD", 0, ["QLD credentials rejected: 401 Unauthorized", "second error"]),
    ]);

    await GET(request());
    await flushImmediates();
    await flushImmediates();

    expect(recordedCompletion()).toEqual({
      jobId: expect.any(String),
      ok: false,
      summary: {
        jurisdictions: [
          {
            jurisdiction: "CTH",
            docsChecked: 3,
            docsUpdated: 49,
            sectionsTotal: 12,
            errorCount: 1,
            firstError: "Rejected cth/act-2026-082: sections[3].id duplicate",
            parserCrashCount: 0,
            parserAnomalyCount: 0,
          },
          {
            jurisdiction: "QLD",
            docsChecked: 3,
            docsUpdated: 0,
            sectionsTotal: 12,
            errorCount: 2,
            firstError: "QLD credentials rejected: 401 Unauthorized",
            parserCrashCount: 0,
            parserAnomalyCount: 0,
          },
        ],
      },
    });
  });

  it("logs cron.legislation-sync.failed and releases the lock when the sync throws", async () => {
    armClient(true);
    runLegislationSync.mockRejectedValue(new Error("legislation.gov.au 503"));

    const response = await GET(request());
    expect(response.status).toBe(202);

    await flushImmediates();
    await flushImmediates();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.legislation-sync.failed" }),
      expect.any(String)
    );
    expectLockedThenReleased();
  });

  it("?wait=1 keeps the synchronous 200 with results and takes and releases the lock", async () => {
    armClient(true);

    const response = await GET(request("?wait=1&jurisdiction=CTH"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("Legislation sync complete: 1 docs updated, 24 sections, 0 errors");
    expect(body.results).toHaveLength(2);
    expect(runLegislationSync).toHaveBeenCalledTimes(1);
    expect(runLegislationSync).toHaveBeenCalledWith(["CTH"]);
    // The sync ran INSIDE the lock: the lock query precedes the run, the unlock follows it.
    const orderOf = (fragment: string) => {
      const index = mockClient.query.mock.calls.findIndex(([text]) => text.includes(fragment));
      return mockClient.query.mock.invocationCallOrder[index];
    };
    const runAt = runLegislationSync.mock.invocationCallOrder[0];
    expect(orderOf("pg_try_advisory_lock")).toBeLessThan(runAt);
    expect(runAt).toBeLessThan(orderOf("pg_advisory_unlock"));
    expectLockedThenReleased();
    expect(recordedCompletion()).toMatchObject({ ok: true });
  });

  it("?wait=1 answers 202 started:false and runs nothing while a sync holds the lock", async () => {
    armClient(false);

    const response = await GET(request("?wait=1&jurisdiction=CTH"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      started: false,
      running: true,
      jurisdictions: ["CTH"],
    });
    expect(runLegislationSync).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_try_advisory_lock($1) AS acquired", [542502]);
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), expect.anything());
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.release.mock.calls[0]).toEqual([]);
  });

  it("?wait=1 answers 500 when the synchronous sync throws, after releasing the lock", async () => {
    armClient(true);
    runLegislationSync.mockRejectedValue(new Error("boom"));

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Legislation sync failed: boom" });
    expectLockedThenReleased();
    expect(recordedCompletion()).toEqual({ jobId: expect.any(String), ok: false, summary: { error: "boom" } });
  });
});
