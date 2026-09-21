/**
 * tailor-group#38 — the detached-job helper: single flight via a Postgres
 * advisory lock on ONE dedicated connection, work scheduled behind the
 * caller's response, failures logged and never thrown, lock always released,
 * and a connection whose unlock (or lock) threw destroyed rather than pooled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "./db";

type MockDb = {
  execute: ReturnType<
    typeof vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>
  >;
  batch: ReturnType<typeof vi.fn>;
};

const mockDb: MockDb = { execute: vi.fn(), batch: vi.fn() };
const mockClient = {
  query: vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
  release: vi.fn<(err?: Error) => void>(),
};

vi.mock("./db", () => ({
  getDb: async () => mockDb as unknown as DbClient,
  getDedicatedConnection: async () => mockClient,
}));

const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
vi.mock("./logger", () => ({
  log: {
    info: (...args: unknown[]) => logInfo(...args),
    warn: (...args: unknown[]) => logWarn(...args),
    error: (...args: unknown[]) => logError(...args),
  },
}));

import { isDetachedJobRunning, runJobInline, startDetachedJob, toIsoString } from "./detached-jobs";

const STARTED = new Date("2026-09-21T06:00:00.250Z");

/** Drive the dedicated connection: lock outcome, then `now()`, then unlock. */
function armClient(acquired: boolean, unlock: () => Promise<{ rows: Record<string, unknown>[] }> = async () => ({ rows: [{ pg_advisory_unlock: true }] })) {
  mockClient.query.mockImplementation(async (text: string) => {
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired }] };
    if (text.includes("now()")) return { rows: [{ started_at: STARTED }] };
    if (text.includes("pg_advisory_unlock")) return unlock();
    throw new Error(`unexpected query: ${text}`);
  });
}

const flushImmediates = () => new Promise<void>(resolve => setImmediate(resolve));

/** The connection went back to the pool reusable: released once, with no error. */
function expectPooled() {
  expect(mockClient.release).toHaveBeenCalledTimes(1);
  expect(mockClient.release.mock.calls[0]).toEqual([]);
}

/** The connection was handed back WITH the error, which makes pg-pool destroy it. */
function expectDestroyed(err: Error) {
  expect(mockClient.release).toHaveBeenCalledTimes(1);
  expect(mockClient.release).toHaveBeenCalledWith(err);
}

beforeEach(() => {
  mockDb.execute.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  logInfo.mockReset();
  logWarn.mockReset();
  logError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startDetachedJob", () => {
  it("reports running and runs nothing when the advisory lock is held elsewhere", async () => {
    armClient(false);
    const run = vi.fn(async () => undefined);

    const result = await startDetachedJob({ name: "demo", lockKey: 542599, run });

    expect(result).toEqual({ started: false, running: true });
    expect(run).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_try_advisory_lock($1) AS acquired", [542599]);
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), expect.anything());
    expectPooled();
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.demo.skipped" }), expect.any(String));
  });

  it("takes the lock, answers first, then runs the job once and releases lock + connection", async () => {
    armClient(true);
    let resolveRun!: () => void;
    const run = vi.fn(() => new Promise<void>(resolve => { resolveRun = resolve; }));

    const result = await startDetachedJob({ name: "demo", lockKey: 542599, run });

    expect(result).toEqual({ started: true, jobId: expect.any(String), startedAt: STARTED.toISOString() });
    // The job has NOT run yet: it is scheduled behind the caller's response.
    expect(run).not.toHaveBeenCalled();
    expect(mockClient.release).not.toHaveBeenCalled();

    await flushImmediates();
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockClient.release).not.toHaveBeenCalled(); // still running

    resolveRun();
    await flushImmediates();
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.completed", jobId: result.started ? result.jobId : "" }),
      expect.any(String)
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs cron.<job>.failed and still releases the lock when the job throws", async () => {
    armClient(true);
    const boom = new Error("upstream 503");
    const run = vi.fn(async () => { throw boom; });

    const result = await startDetachedJob({ name: "demo", lockKey: 542599, run });
    expect(result.started).toBe(true);

    await flushImmediates();
    await flushImmediates();

    expect(run).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.failed", err: boom }),
      expect.any(String)
    );
    const unlockIndex = mockClient.query.mock.calls.findIndex(([text]) => text.includes("pg_advisory_unlock"));
    expect(unlockIndex).toBeGreaterThan(-1);
    expectPooled();
  });

  it("destroys the connection (release with the error) when pg_advisory_unlock rejects after the job completed", async () => {
    const unlockFailed = new Error("connection terminated unexpectedly");
    armClient(true, async () => { throw unlockFailed; });
    const run = vi.fn(async () => undefined);

    await startDetachedJob({ name: "demo", lockKey: 542599, run });
    await flushImmediates();
    await flushImmediates();

    expect(run).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectDestroyed(unlockFailed);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.unlock-failed", err: unlockFailed }),
      expect.any(String)
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it("destroys the connection and rethrows when the lock query itself fails", async () => {
    const dead = new Error("connection terminated");
    mockClient.query.mockRejectedValue(dead);
    const run = vi.fn(async () => undefined);

    await expect(startDetachedJob({ name: "demo", lockKey: 542599, run })).rejects.toThrow("connection terminated");

    expect(run).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), expect.anything());
    expectDestroyed(dead);
  });

  it("unlocks and releases when the lock was taken but now() throws before the hand-off; run is never invoked", async () => {
    mockClient.query.mockImplementation(async (text: string) => {
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("now()")) throw new Error("statement cancelled");
      if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
      throw new Error(`unexpected query: ${text}`);
    });
    const run = vi.fn(async () => undefined);

    await expect(startDetachedJob({ name: "demo", lockKey: 542599, run })).rejects.toThrow("statement cancelled");
    await flushImmediates();

    expect(run).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("destroys the connection when both now() and the unlock throw (dead connection)", async () => {
    const dead = new Error("connection terminated");
    mockClient.query.mockImplementation(async (text: string) => {
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      throw dead;
    });
    const run = vi.fn(async () => undefined);

    await expect(startDetachedJob({ name: "demo", lockKey: 542599, run })).rejects.toThrow("connection terminated");

    expect(run).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectDestroyed(dead);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.unlock-failed", err: dead }),
      expect.any(String)
    );
  });
});

describe("runJobInline", () => {
  it("takes the lock, runs the job to completion, hands back its result, then releases lock + connection", async () => {
    armClient(true);
    const run = vi.fn(async () => ({ docs: 3 }));

    const outcome = await runJobInline({ name: "demo", lockKey: 542599, run });

    expect(outcome).toEqual({ started: true, result: { docs: 3 } });
    expect(run).toHaveBeenCalledTimes(1);
    const texts = mockClient.query.mock.calls.map(([text]) => text);
    expect(texts.findIndex(t => t.includes("pg_try_advisory_lock"))).toBeLessThan(texts.findIndex(t => t.includes("pg_advisory_unlock")));
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("now()"));
    expectPooled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("reports running and runs nothing when the advisory lock is held elsewhere", async () => {
    armClient(false);
    const run = vi.fn(async () => undefined);

    const outcome = await runJobInline({ name: "demo", lockKey: 542599, run });

    expect(outcome).toEqual({ started: false, running: true });
    expect(run).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), expect.anything());
    expectPooled();
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.demo.skipped" }), expect.any(String));
  });

  it("propagates the job's throw after releasing lock + connection", async () => {
    armClient(true);
    const boom = new Error("upstream 503");
    const run = vi.fn(async () => { throw boom; });

    await expect(runJobInline({ name: "demo", lockKey: 542599, run })).rejects.toBe(boom);

    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logError).not.toHaveBeenCalled(); // the caller owns the failure inline
  });

  it("destroys the connection when the unlock rejects, and still hands back the result", async () => {
    const unlockFailed = new Error("connection terminated unexpectedly");
    armClient(true, async () => { throw unlockFailed; });

    const outcome = await runJobInline({ name: "demo", lockKey: 542599, run: async () => "done" });

    expect(outcome).toEqual({ started: true, result: "done" });
    expectDestroyed(unlockFailed);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.unlock-failed", jobId: null, err: unlockFailed }),
      expect.any(String)
    );
  });

  it("destroys the connection and rethrows when the lock query itself fails", async () => {
    const dead = new Error("connection terminated");
    mockClient.query.mockRejectedValue(dead);
    const run = vi.fn(async () => undefined);

    await expect(runJobInline({ name: "demo", lockKey: 542599, run })).rejects.toBe(dead);

    expect(run).not.toHaveBeenCalled();
    expectDestroyed(dead);
  });
});

describe("isDetachedJobRunning", () => {
  it("reads the advisory key out of pg_locks, scoped to the current database", async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ held: true }] });

    await expect(isDetachedJobRunning(542502)).resolves.toBe(true);

    const stmt = mockDb.execute.mock.calls[0][0] as { sql: string; args: unknown[] };
    expect(stmt.sql).toContain("pg_locks");
    expect(stmt.sql).toContain("locktype = 'advisory'");
    expect(stmt.sql).toContain("AND database = (SELECT oid FROM pg_database WHERE datname = current_database())");
    expect(stmt.args).toEqual([542502, 542502]);
  });

  it("is false when no session holds the key", async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ held: false }] });
    await expect(isDetachedJobRunning(542502)).resolves.toBe(false);
  });
});

describe("toIsoString", () => {
  it("accepts a Date or an ISO string and rejects everything else", () => {
    expect(toIsoString(STARTED)).toBe("2026-09-21T06:00:00.250Z");
    expect(toIsoString("2026-09-21T06:00:00Z")).toBe("2026-09-21T06:00:00.000Z");
    expect(toIsoString(null)).toBeNull();
    expect(toIsoString("")).toBeNull();
    expect(toIsoString("not a date")).toBeNull();
    expect(toIsoString(new Date("nope"))).toBeNull();
  });
});
