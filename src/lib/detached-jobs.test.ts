/**
 * tailor-group#38 — the detached-job helper: single flight via a Postgres
 * advisory lock on ONE dedicated connection, work scheduled behind the
 * caller's response, failures logged and never thrown, lock always released,
 * a connection whose unlock (or lock) threw destroyed rather than pooled,
 * and every run recorded in cron_job_runs (start row on the locked
 * connection, completed_at/ok/summary stamped before the unlock).
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

import {
  getDetachedJobStatus,
  isDetachedJobRunning,
  runJobInline,
  startDetachedJob,
  toIsoString,
} from "./detached-jobs";

const STARTED = new Date("2026-09-21T06:00:00.250Z");

type Rows = Promise<{ rows: Record<string, unknown>[] }>;
const ok = async (): Rows => ({ rows: [{ pg_advisory_unlock: true }] });

/** Drive the dedicated connection: lock outcome, the start row, the completion stamp, then unlock. */
function armClient(
  acquired: boolean,
  overrides: { unlock?: () => Rows; insert?: () => Rows; update?: () => Rows } = {}
) {
  mockClient.query.mockImplementation(async (text: string) => {
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired }] };
    if (text.includes("INSERT INTO cron_job_runs")) return overrides.insert ? overrides.insert() : { rows: [{ started_at: STARTED }] };
    if (text.includes("UPDATE cron_job_runs")) return overrides.update ? overrides.update() : { rows: [] };
    if (text.includes("pg_advisory_unlock")) return (overrides.unlock ?? ok)();
    throw new Error(`unexpected query: ${text}`);
  });
}

const flushImmediates = () => new Promise<void>(resolve => setImmediate(resolve));

const texts = () => mockClient.query.mock.calls.map(([text]) => text);
const indexOf = (fragment: string) => texts().findIndex(t => t.includes(fragment));

/** The start row: `[job_name, job_id]` of the INSERT, or null when none was written. */
function recordedStart(): { jobName: string; jobId: string } | null {
  const call = mockClient.query.mock.calls.find(([text]) => text.includes("INSERT INTO cron_job_runs"));
  if (!call) return null;
  const [, values] = call;
  return { jobName: String(values?.[0]), jobId: String(values?.[1]) };
}

/** The completion stamp: `[job_id, ok, summary json]` of the UPDATE, or null when none was written. */
function recordedCompletion(): { jobId: string; ok: boolean; summary: unknown } | null {
  const call = mockClient.query.mock.calls.find(([text]) => text.includes("UPDATE cron_job_runs"));
  if (!call) return null;
  const [, values] = call;
  return { jobId: String(values?.[0]), ok: values?.[1] as boolean, summary: JSON.parse(String(values?.[2])) };
}

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
    expect(recordedStart()).toBeNull();
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), expect.anything());
    expectPooled();
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.demo.skipped" }), expect.any(String));
  });

  it("takes the lock, records the start row, answers first, then runs the job once and releases lock + connection", async () => {
    armClient(true);
    let resolveRun!: () => void;
    const run = vi.fn(() => new Promise<void>(resolve => { resolveRun = resolve; }));

    const result = await startDetachedJob({ name: "demo", lockKey: 542599, run });

    expect(result).toEqual({ started: true, jobId: expect.any(String), startedAt: STARTED.toISOString() });
    const jobId = result.started ? result.jobId : "";
    // The start row is written on the locked connection BEFORE the caller is answered.
    expect(recordedStart()).toEqual({ jobName: "demo", jobId });
    // The job has NOT run yet: it is scheduled behind the caller's response.
    expect(run).not.toHaveBeenCalled();
    expect(mockClient.release).not.toHaveBeenCalled();

    await flushImmediates();
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockClient.release).not.toHaveBeenCalled(); // still running
    expect(recordedCompletion()).toBeNull();

    resolveRun();
    await flushImmediates();
    // Completion is stamped BEFORE the unlock, so a poller that sees the lock free sees the row done.
    expect(recordedCompletion()).toEqual({ jobId, ok: true, summary: {} });
    expect(indexOf("UPDATE cron_job_runs")).toBeLessThan(indexOf("pg_advisory_unlock"));
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.completed", jobId, ok: true }),
      expect.any(String)
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it("records the job's own verdict and summary through `outcome`", async () => {
    armClient(true);
    const run = vi.fn(async () => ({ errors: ["feed 503"], stops: 12 }));
    const outcome = vi.fn((r: { errors: string[]; stops: number }) => ({ ok: r.errors.length === 0, summary: { stops: r.stops, firstError: r.errors[0] } }));

    const result = await startDetachedJob({ name: "demo", lockKey: 542599, run, outcome });
    await flushImmediates();
    await flushImmediates();

    expect(outcome).toHaveBeenCalledWith({ errors: ["feed 503"], stops: 12 });
    expect(recordedCompletion()).toEqual({
      jobId: result.started ? result.jobId : "",
      ok: false,
      summary: { stops: 12, firstError: "feed 503" },
    });
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.demo.completed", ok: false }), expect.any(String));
    expect(logError).not.toHaveBeenCalled();
    expectPooled();
  });

  it("logs cron.<job>.failed, records ok:false with the message, and still releases the lock when the job throws", async () => {
    armClient(true);
    const boom = new Error("upstream 503");
    const run = vi.fn(async () => { throw boom; });
    const outcome = vi.fn(() => ({ ok: true, summary: {} }));

    const result = await startDetachedJob({ name: "demo", lockKey: 542599, run, outcome });
    expect(result.started).toBe(true);

    await flushImmediates();
    await flushImmediates();

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome).not.toHaveBeenCalled();
    expect(recordedCompletion()).toEqual({
      jobId: result.started ? result.jobId : "",
      ok: false,
      summary: { error: "upstream 503" },
    });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.failed", err: boom }),
      expect.any(String)
    );
    expect(indexOf("UPDATE cron_job_runs")).toBeLessThan(indexOf("pg_advisory_unlock"));
    expectPooled();
  });

  it("logs cron.<job>.record-failed and still unlocks when the completion stamp throws", async () => {
    const stampFailed = new Error("relation cron_job_runs does not exist");
    armClient(true, { update: async () => { throw stampFailed; } });
    const run = vi.fn(async () => undefined);

    await startDetachedJob({ name: "demo", lockKey: 542599, run });
    await flushImmediates();
    await flushImmediates();

    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.record-failed", err: stampFailed }),
      expect.any(String)
    );
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.demo.completed" }), expect.any(String));
  });

  it("destroys the connection (release with the error) when pg_advisory_unlock rejects after the job completed", async () => {
    const unlockFailed = new Error("connection terminated unexpectedly");
    armClient(true, { unlock: async () => { throw unlockFailed; } });
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

  it("unlocks and releases when the lock was taken but the start row throws before the hand-off; run is never invoked", async () => {
    armClient(true, { insert: async () => { throw new Error("statement cancelled"); } });
    const run = vi.fn(async () => undefined);

    await expect(startDetachedJob({ name: "demo", lockKey: 542599, run })).rejects.toThrow("statement cancelled");
    await flushImmediates();

    expect(run).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("destroys the connection when both the start row and the unlock throw (dead connection)", async () => {
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
  it("takes the lock, records the run, runs the job to completion, hands back its result, then releases lock + connection", async () => {
    armClient(true);
    const run = vi.fn(async () => ({ docs: 3 }));

    const outcome = await runJobInline({
      name: "demo",
      lockKey: 542599,
      run,
      outcome: r => ({ ok: true, summary: { docs: r.docs } }),
    });

    expect(outcome).toEqual({ started: true, jobId: expect.any(String), startedAt: STARTED.toISOString(), result: { docs: 3 } });
    const jobId = outcome.started ? outcome.jobId : "";
    expect(run).toHaveBeenCalledTimes(1);
    expect(recordedStart()).toEqual({ jobName: "demo", jobId });
    expect(recordedCompletion()).toEqual({ jobId, ok: true, summary: { docs: 3 } });
    expect(indexOf("pg_try_advisory_lock")).toBeLessThan(indexOf("INSERT INTO cron_job_runs"));
    expect(indexOf("UPDATE cron_job_runs")).toBeLessThan(indexOf("pg_advisory_unlock"));
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("reports running and runs nothing when the advisory lock is held elsewhere", async () => {
    armClient(false);
    const run = vi.fn(async () => undefined);

    const outcome = await runJobInline({ name: "demo", lockKey: 542599, run });

    expect(outcome).toEqual({ started: false, running: true });
    expect(run).not.toHaveBeenCalled();
    expect(recordedStart()).toBeNull();
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), expect.anything());
    expectPooled();
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ op: "cron.demo.skipped" }), expect.any(String));
  });

  it("records ok:false and propagates the job's throw after releasing lock + connection", async () => {
    armClient(true);
    const boom = new Error("upstream 503");
    const run = vi.fn(async () => { throw boom; });

    await expect(runJobInline({ name: "demo", lockKey: 542599, run })).rejects.toBe(boom);

    expect(recordedCompletion()).toEqual({ jobId: expect.any(String), ok: false, summary: { error: "upstream 503" } });
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
    expect(logError).not.toHaveBeenCalled(); // the caller owns the failure inline
  });

  it("unlocks, releases and rethrows when the start row throws; run is never invoked", async () => {
    armClient(true, { insert: async () => { throw new Error("statement cancelled"); } });
    const run = vi.fn(async () => undefined);

    await expect(runJobInline({ name: "demo", lockKey: 542599, run })).rejects.toThrow("statement cancelled");

    expect(run).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1)", [542599]);
    expectPooled();
  });

  it("destroys the connection when the unlock rejects, and still hands back the result", async () => {
    const unlockFailed = new Error("connection terminated unexpectedly");
    armClient(true, { unlock: async () => { throw unlockFailed; } });

    const outcome = await runJobInline({ name: "demo", lockKey: 542599, run: async () => "done" });

    expect(outcome).toEqual({ started: true, jobId: expect.any(String), startedAt: STARTED.toISOString(), result: "done" });
    expectDestroyed(unlockFailed);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ op: "cron.demo.unlock-failed", jobId: outcome.started ? outcome.jobId : "", err: unlockFailed }),
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

describe("getDetachedJobStatus", () => {
  const sqlOf = (stmt: string | { sql: string }) => (typeof stmt === "string" ? stmt : stmt.sql);

  function armDb(held: boolean, rows: Record<string, unknown>[]) {
    mockDb.execute.mockImplementation(async (stmt) => {
      const sql = sqlOf(stmt);
      if (sql.includes("pg_locks")) return { rows: [{ held }] };
      if (sql.includes("cron_job_runs")) return { rows };
      throw new Error(`unexpected sql: ${sql}`);
    });
  }

  it("probes the lock first, then reads the job's row, and maps it to camelCase", async () => {
    armDb(true, [
      {
        job_id: "run-1",
        started_at: STARTED,
        completed_at: null,
        ok: null,
        summary: null,
      },
    ]);

    const status = await getDetachedJobStatus("gtfs-sync", 542503);

    expect(status).toEqual({
      running: true,
      lastRun: { jobId: "run-1", startedAt: STARTED.toISOString(), completedAt: null, ok: null, summary: null },
    });
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    expect(sqlOf(mockDb.execute.mock.calls[0][0])).toContain("pg_locks");
    const rowRead = mockDb.execute.mock.calls[1][0] as { sql: string; args: unknown[] };
    expect(rowRead.sql).toContain("FROM cron_job_runs WHERE job_name = ?");
    expect(rowRead.args).toEqual(["gtfs-sync"]);
  });

  it("does not read the row until the lock probe has answered", async () => {
    let answerProbe!: (held: boolean) => void;
    mockDb.execute.mockImplementation(async (stmt) => {
      const sql = sqlOf(stmt);
      if (sql.includes("pg_locks")) {
        return new Promise(resolve => { answerProbe = (held) => resolve({ rows: [{ held }] }); });
      }
      if (sql.includes("cron_job_runs")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const pending = getDetachedJobStatus("demo", 542599);
    await flushImmediates();
    expect(mockDb.execute).toHaveBeenCalledTimes(1);

    answerProbe(false);
    await expect(pending).resolves.toEqual({ running: false, lastRun: null });
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it("hands back a completed row's ok and parsed summary, whether pg parsed the JSONB or not", async () => {
    const completed = new Date("2026-09-21T06:04:00.000Z");
    armDb(false, [{ job_id: "run-2", started_at: STARTED, completed_at: completed, ok: false, summary: { error: "feed 503" } }]);
    await expect(getDetachedJobStatus("demo", 542599)).resolves.toEqual({
      running: false,
      lastRun: { jobId: "run-2", startedAt: STARTED.toISOString(), completedAt: completed.toISOString(), ok: false, summary: { error: "feed 503" } },
    });

    armDb(false, [{ job_id: "run-3", started_at: STARTED.toISOString(), completed_at: completed.toISOString(), ok: true, summary: '{"stops":12}' }]);
    await expect(getDetachedJobStatus("demo", 542599)).resolves.toMatchObject({
      lastRun: { jobId: "run-3", ok: true, summary: { stops: 12 } },
    });

    armDb(false, [{ job_id: "run-4", started_at: STARTED, completed_at: completed, ok: true, summary: "{not json" }]);
    await expect(getDetachedJobStatus("demo", 542599)).resolves.toMatchObject({ lastRun: { summary: null } });
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
