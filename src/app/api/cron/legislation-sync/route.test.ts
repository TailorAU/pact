/**
 * tailor-group#38 — GET /api/cron/legislation-sync answers 202 at once and
 * runs the sync behind the response under the advisory lock; ?wait=1 keeps
 * the synchronous 200. The detached-job helper runs for real against a
 * mocked dedicated connection so the trigger → job hand-off is exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db";
import type { SyncResult } from "@/lib/legislation-sync";

const mockDb = { execute: vi.fn(), batch: vi.fn() };
const mockClient = {
  query: vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
  release: vi.fn(),
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
    if (text.includes("now()")) return { rows: [{ started_at: STARTED }] };
    if (text.includes("pg_advisory_unlock")) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
}

function syncResult(jurisdiction: string, docsUpdated = 0): SyncResult {
  return {
    jurisdiction,
    docsChecked: 3,
    docsUpdated,
    sectionsTotal: 12,
    errors: [],
    parserVersion: "test",
    parserAnomalyCount: 0,
    parserCrashCount: 0,
  };
}

const flushImmediates = () => new Promise<void>(resolve => setImmediate(resolve));

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
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542502]);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.legislation-sync.completed" }),
      expect.any(String)
    );
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
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542502]);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("?wait=1 keeps the synchronous 200 with results and takes no lock", async () => {
    const response = await GET(request("?wait=1&jurisdiction=CTH"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe("Legislation sync complete: 1 docs updated, 24 sections, 0 errors");
    expect(body.results).toHaveLength(2);
    expect(runLegislationSync).toHaveBeenCalledWith(["CTH"]);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("?wait=1 answers 500 when the synchronous sync throws", async () => {
    runLegislationSync.mockRejectedValue(new Error("boom"));

    const response = await GET(request("?wait=1"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Legislation sync failed: boom" });
  });
});
