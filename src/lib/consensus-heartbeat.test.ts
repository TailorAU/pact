/**
 * tailor-group#9 — the engine's in-process heartbeat.
 *
 * Fake timers + a stub sweep: pins the env contract, the cadence, the
 * re-entrancy guard, the never-propagate-errors rule and the stop() path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENSUS_SWEEP_INTERVAL_ENV,
  DEFAULT_CONSENSUS_SWEEP_INTERVAL_MINUTES,
  DEFAULT_HEARTBEAT_INITIAL_DELAY_MS,
  MIN_CONSENSUS_SWEEP_INTERVAL_MINUTES,
  resolveHeartbeatInterval,
  startConsensusHeartbeat,
  startConsensusHeartbeatFromEnv,
  type HeartbeatLogger,
} from "./consensus-heartbeat";

function stubLogger(): HeartbeatLogger & { entries: Array<{ level: string; ctx: Record<string, unknown>; msg?: string }> } {
  const entries: Array<{ level: string; ctx: Record<string, unknown>; msg?: string }> = [];
  return {
    entries,
    info: (ctx, msg) => entries.push({ level: "info", ctx, msg }),
    warn: (ctx, msg) => entries.push({ level: "warn", ctx, msg }),
    error: (ctx, msg) => entries.push({ level: "error", ctx, msg }),
  };
}

const MINUTE = 60_000;

describe("resolveHeartbeatInterval — the CONSENSUS_SWEEP_INTERVAL_MINUTES contract", () => {
  it("names the env var the production wiring reads", () => {
    expect(CONSENSUS_SWEEP_INTERVAL_ENV).toBe("CONSENSUS_SWEEP_INTERVAL_MINUTES");
  });

  it("unset or blank → the 30-minute default cron-source.yml ran at (#5425)", () => {
    expect(DEFAULT_CONSENSUS_SWEEP_INTERVAL_MINUTES).toBe(30);
    for (const raw of [undefined, "", "   "]) {
      expect(resolveHeartbeatInterval(raw)).toEqual({
        enabled: true,
        intervalMs: 30 * MINUTE,
        source: "default",
        raw,
      });
    }
  });

  it("0 / off / false / no / none / disabled → disabled, case-insensitively", () => {
    for (const raw of ["0", "off", "OFF", "false", "no", "none", "Disabled", " 0 "]) {
      expect(resolveHeartbeatInterval(raw)).toEqual({ enabled: false, source: "disabled", raw });
    }
  });

  it("a positive number is minutes, floored at the 1-minute minimum", () => {
    expect(MIN_CONSENSUS_SWEEP_INTERVAL_MINUTES).toBe(1);
    expect(resolveHeartbeatInterval("15")).toEqual({ enabled: true, intervalMs: 15 * MINUTE, source: "env", raw: "15" });
    expect(resolveHeartbeatInterval("2.5")).toEqual({ enabled: true, intervalMs: 150_000, source: "env", raw: "2.5" });
    expect(resolveHeartbeatInterval("0.25")).toEqual({ enabled: true, intervalMs: MINUTE, source: "env", raw: "0.25" });
  });

  it("garbage falls back to the default and says so — a typo must not stop the engine", () => {
    for (const raw of ["thirty", "-5", "NaN", "1e999", "5m"]) {
      expect(resolveHeartbeatInterval(raw)).toEqual({
        enabled: true,
        intervalMs: 30 * MINUTE,
        source: "invalid-fallback",
        raw,
      });
    }
  });
});

describe("startConsensusHeartbeat — cadence, re-entrancy, errors, stop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a non-positive interval", () => {
    const sweep = vi.fn(async () => ({ ran: true, merged: 0 }));
    expect(() => startConsensusHeartbeat({ intervalMs: 0, sweep, logger: stubLogger() })).toThrow(RangeError);
    expect(() => startConsensusHeartbeat({ intervalMs: Number.NaN, sweep, logger: stubLogger() })).toThrow(RangeError);
  });

  it("first tick after the initial delay, then one per interval", async () => {
    const sweep = vi.fn(async () => ({ ran: true, merged: 2 }));
    const logger = stubLogger();
    const hb = startConsensusHeartbeat({ intervalMs: 10 * MINUTE, initialDelayMs: MINUTE, sweep, logger });

    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(sweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(sweep).toHaveBeenCalledTimes(5);
    expect(hb.ticks).toBe(5);
    expect(hb.failures).toBe(0);

    const tickLogs = logger.entries.filter((e) => e.ctx.op === "consensus.heartbeat.tick");
    expect(tickLogs).toHaveLength(5);
    expect(tickLogs[0].ctx).toMatchObject({ sweepRan: true, merged: 2 });
    expect(tickLogs[0].msg).toBe("consensus sweep completed");
    hb.stop();
  });

  it("uses the 60-second initial delay by default", async () => {
    expect(DEFAULT_HEARTBEAT_INITIAL_DELAY_MS).toBe(60_000);
    const sweep = vi.fn(async () => ({ ran: true, merged: 0 }));
    const hb = startConsensusHeartbeat({ intervalMs: 30 * MINUTE, sweep, logger: stubLogger() });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    hb.stop();
  });

  it("a lock-held sweep (ran: false) is logged as skipped, not as a failure", async () => {
    const sweep = vi.fn(async () => ({ ran: false, merged: 0 }));
    const logger = stubLogger();
    const hb = startConsensusHeartbeat({ intervalMs: 5 * MINUTE, initialDelayMs: 0, sweep, logger });
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(hb.failures).toBe(0);
    const tick = logger.entries.find((e) => e.ctx.op === "consensus.heartbeat.tick");
    expect(tick?.msg).toBe("consensus sweep skipped: advisory lock held by a concurrent sweep");
    hb.stop();
  });

  it("a tick that fires while the previous sweep is still running is skipped, not queued", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sweep = vi.fn(async () => {
      await gate;
      return { ran: true, merged: 0 };
    });
    const logger = stubLogger();
    const hb = startConsensusHeartbeat({ intervalMs: MINUTE, initialDelayMs: 0, sweep, logger });

    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(hb.inFlight).toBe(true);

    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(hb.skippedOverlaps).toBe(3);
    expect(logger.entries.filter((e) => e.ctx.op === "consensus.heartbeat.overlap")).toHaveLength(3);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(hb.inFlight).toBe(false);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(sweep).toHaveBeenCalledTimes(2);
    hb.stop();
  });

  it("a sweep that throws is logged with the error and the next tick still fires", async () => {
    const boom = new Error("relation \"proposals\" does not exist");
    const sweep = vi
      .fn<() => Promise<{ ran: boolean; merged: number }>>()
      .mockRejectedValueOnce(boom)
      .mockResolvedValue({ ran: true, merged: 1 });
    const logger = stubLogger();
    const hb = startConsensusHeartbeat({ intervalMs: MINUTE, initialDelayMs: 0, sweep, logger });

    await vi.advanceTimersByTimeAsync(0);
    expect(hb.failures).toBe(1);
    const failed = logger.entries.find((e) => e.ctx.op === "consensus.heartbeat.failed");
    expect(failed?.level).toBe("error");
    expect(failed?.ctx.err).toBe(boom);

    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(hb.ticks).toBe(2);
    expect(hb.failures).toBe(1);
    hb.stop();
  });

  it("stop() before the first tick cancels it; stop() later cancels the interval; stop() is idempotent", async () => {
    const sweep = vi.fn(async () => ({ ran: true, merged: 0 }));
    const logger = stubLogger();

    const early = startConsensusHeartbeat({ intervalMs: MINUTE, initialDelayMs: MINUTE, sweep, logger });
    early.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(sweep).not.toHaveBeenCalled();

    const late = startConsensusHeartbeat({ intervalMs: MINUTE, initialDelayMs: 0, sweep, logger });
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(sweep).toHaveBeenCalledTimes(3);
    late.stop();
    late.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(sweep).toHaveBeenCalledTimes(3);
    expect(logger.entries.filter((e) => e.ctx.op === "consensus.heartbeat.stopped")).toHaveLength(2);
  });

  it("unrefs its timers so the heartbeat never keeps a shutting-down process alive", () => {
    const unref = vi.fn();
    const handles: Array<{ unref: () => void }> = [];
    const timers = {
      setTimeout: (fn: () => void) => {
        fn();
        const h = { unref };
        handles.push(h);
        return h;
      },
      clearTimeout: vi.fn(),
      setInterval: () => {
        const h = { unref };
        handles.push(h);
        return h;
      },
      clearInterval: vi.fn(),
      now: () => 0,
    };
    const hb = startConsensusHeartbeat({
      intervalMs: MINUTE,
      initialDelayMs: 0,
      sweep: async () => ({ ran: true, merged: 0 }),
      logger: stubLogger(),
      timers,
    });
    expect(handles).toHaveLength(2);
    expect(unref).toHaveBeenCalledTimes(2);
    hb.stop();
    expect(timers.clearInterval).toHaveBeenCalledTimes(1);
  });
});

describe("startConsensusHeartbeatFromEnv — the production wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disabled by config → no handle, one info line, the engine is never loaded", async () => {
    const logger = stubLogger();
    const loadSweep = vi.fn();
    const hb = await startConsensusHeartbeatFromEnv(
      { DATABASE_URL: "postgresql://x", CONSENSUS_SWEEP_INTERVAL_MINUTES: "off" },
      { logger, loadSweep }
    );
    expect(hb).toBeNull();
    expect(loadSweep).not.toHaveBeenCalled();
    expect(logger.entries.map((e) => e.ctx.op)).toEqual(["consensus.heartbeat.disabled"]);
  });

  it("no DATABASE_URL → no handle, a warning, the engine is never loaded", async () => {
    const logger = stubLogger();
    const loadSweep = vi.fn();
    const hb = await startConsensusHeartbeatFromEnv({}, { logger, loadSweep });
    expect(hb).toBeNull();
    expect(loadSweep).not.toHaveBeenCalled();
    expect(logger.entries[0]).toMatchObject({ level: "warn", ctx: { op: "consensus.heartbeat.no-database" } });
  });

  it("with a database and the default cadence, starts on the lazily loaded sweep", async () => {
    const logger = stubLogger();
    const sweep = vi.fn(async () => ({ ran: true, merged: 4 }));
    const loadSweep = vi.fn(async () => sweep);
    const hb = await startConsensusHeartbeatFromEnv(
      { DATABASE_URL: "postgresql://x" },
      { logger, loadSweep, initialDelayMs: 0 }
    );
    expect(hb).not.toBeNull();
    expect(loadSweep).toHaveBeenCalledTimes(1);
    const started = logger.entries.find((e) => e.ctx.op === "consensus.heartbeat.started");
    expect(started?.ctx.intervalMs).toBe(30 * MINUTE);

    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(sweep).toHaveBeenCalledTimes(2);
    hb!.stop();
  });

  it("an unparseable cadence warns and still starts on the default", async () => {
    const logger = stubLogger();
    const hb = await startConsensusHeartbeatFromEnv(
      { DATABASE_URL: "postgresql://x", CONSENSUS_SWEEP_INTERVAL_MINUTES: "soon" },
      { logger, loadSweep: async () => async () => ({ ran: true, merged: 0 }), initialDelayMs: 0 }
    );
    expect(hb).not.toBeNull();
    const warned = logger.entries.find((e) => e.ctx.op === "consensus.heartbeat.invalid-interval");
    expect(warned).toMatchObject({ level: "warn", ctx: { raw: "soon", intervalMs: 30 * MINUTE } });
    hb!.stop();
  });

  it("honours a configured cadence", async () => {
    const sweep = vi.fn(async () => ({ ran: true, merged: 0 }));
    const hb = await startConsensusHeartbeatFromEnv(
      { DATABASE_URL: "postgresql://x", CONSENSUS_SWEEP_INTERVAL_MINUTES: "5" },
      { logger: stubLogger(), loadSweep: async () => sweep, initialDelayMs: 0 }
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(sweep).toHaveBeenCalledTimes(2);
    hb!.stop();
  });
});
