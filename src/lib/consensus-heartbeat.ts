/**
 * In-process heartbeat for the consensus engine (tailor-group#9).
 *
 * #5425 took the engine off the GET read paths and made tailor-app's
 * `cron-source.yml` its heartbeat: `/api/cron/auto-merge` every 30 minutes.
 * tailor-app#5954 retired that workflow, and its secrets, when the knowledge
 * graph re-homed here, and nothing replaced it — from 2026-09-18 the engine
 * had no scheduler at all. This repo's `.github/workflows/cron.yml` restores
 * the external tick, but a GitHub `schedule` fires from the DEFAULT branch
 * only, and the KG deploys from `rehome-review` until tailor-group#7 step 3
 * promotes it. Until then that tick never fires in production.
 *
 * So the engine carries its own heartbeat. `instrumentation.ts` starts this
 * once per server boot; it calls `runConsensusSweep` every N minutes and
 * needs no secret, no scheduler and no default branch. Overlap is handled
 * where it already must be: the sweep takes the Postgres advisory lock
 * (`CONSENSUS_SWEEP_LOCK_KEY`), so a second replica — or the GitHub cron
 * once it is live — skips rather than double-runs. In-process re-entrancy
 * (a tick firing while the previous one is still running) is guarded here.
 *
 * The scheduling is pure: the sweep function and the timers are injected so
 * the unit suite drives it with fake timers and a stub sweep, no database.
 * #5425's invariant is unchanged — the engine still has exactly one entry
 * point (`runConsensusSweep`) and no read path reaches it; this is a second
 * *clock* for the same entry, not a second entry.
 */
import { log } from "./logger";

/** Env var read by {@link startConsensusHeartbeatFromEnv}. */
export const CONSENSUS_SWEEP_INTERVAL_ENV = "CONSENSUS_SWEEP_INTERVAL_MINUTES";

/** The cadence cron-source.yml ran the sweep at (#5425). */
export const DEFAULT_CONSENSUS_SWEEP_INTERVAL_MINUTES = 30;

/** Floor for a configured cadence: the sweep is a full-table pass, not a poll. */
export const MIN_CONSENSUS_SWEEP_INTERVAL_MINUTES = 1;

/**
 * Delay before the FIRST tick after boot. Long enough that a fresh revision
 * is serving traffic (the sweep's `getDb()` also runs `initSchema`), short
 * enough that a deploy does not leave expired proposals waiting half an hour.
 */
export const DEFAULT_HEARTBEAT_INITIAL_DELAY_MS = 60_000;

const DISABLE_WORDS = new Set(["0", "off", "false", "no", "none", "disabled"]);

export type HeartbeatIntervalResolution =
  | { enabled: true; intervalMs: number; source: "default" | "env" | "invalid-fallback"; raw: string | undefined }
  | { enabled: false; source: "disabled"; raw: string };

/**
 * Resolve the sweep cadence from `CONSENSUS_SWEEP_INTERVAL_MINUTES`.
 *
 *   unset / blank            → the default (30 min)
 *   0 | off | false | no …   → disabled
 *   positive number          → that many minutes, floored at 1
 *   anything else            → the default, flagged so the caller can warn
 *
 * An unparseable value falls back to the default rather than to "off": a
 * typo must not silently stop the engine, which is the failure this module
 * exists to end.
 */
export function resolveHeartbeatInterval(raw: string | undefined): HeartbeatIntervalResolution {
  const defaultMs = DEFAULT_CONSENSUS_SWEEP_INTERVAL_MINUTES * 60_000;
  if (raw === undefined || raw.trim() === "") {
    return { enabled: true, intervalMs: defaultMs, source: "default", raw };
  }
  const trimmed = raw.trim();
  if (DISABLE_WORDS.has(trimmed.toLowerCase())) {
    return { enabled: false, source: "disabled", raw };
  }
  const minutes = Number(trimmed);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { enabled: true, intervalMs: defaultMs, source: "invalid-fallback", raw };
  }
  const floored = Math.max(minutes, MIN_CONSENSUS_SWEEP_INTERVAL_MINUTES);
  return { enabled: true, intervalMs: Math.round(floored * 60_000), source: "env", raw };
}

export interface HeartbeatSweepResult {
  ran: boolean;
  merged: number;
}

export interface HeartbeatLogger {
  info(ctx: Record<string, unknown>, msg?: string): void;
  warn(ctx: Record<string, unknown>, msg?: string): void;
  error(ctx: Record<string, unknown>, msg?: string): void;
}

/** A timer handle; Node's has `unref`, a fake-timer's may not. */
export type HeartbeatTimerHandle = unknown;

export interface HeartbeatTimers {
  setTimeout(fn: () => void, ms: number): HeartbeatTimerHandle;
  clearTimeout(handle: HeartbeatTimerHandle): void;
  setInterval(fn: () => void, ms: number): HeartbeatTimerHandle;
  clearInterval(handle: HeartbeatTimerHandle): void;
  now(): number;
}

export interface HeartbeatOptions {
  /** Cadence between ticks. Use {@link resolveHeartbeatInterval} for the env contract. */
  intervalMs: number;
  /** Delay before the first tick; defaults to {@link DEFAULT_HEARTBEAT_INITIAL_DELAY_MS}. */
  initialDelayMs?: number;
  /** The engine entry point — in production `runConsensusSweep` from `./db`. */
  sweep: () => Promise<HeartbeatSweepResult>;
  logger?: HeartbeatLogger;
  timers?: HeartbeatTimers;
}

export interface HeartbeatHandle {
  /** Cancel the timers. A tick already in flight finishes; no new tick starts. */
  stop(): void;
  /** Ticks that actually invoked the sweep. */
  readonly ticks: number;
  /** Ticks skipped because the previous tick was still running. */
  readonly skippedOverlaps: number;
  /** Ticks whose sweep threw (logged, never propagated). */
  readonly failures: number;
  readonly inFlight: boolean;
}

function defaultTimers(): HeartbeatTimers {
  // Resolved at call time, not module load, so a test's fake timers apply.
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    now: () => Date.now(),
  };
}

/** Never let the heartbeat keep a shutting-down process alive. */
function unref(handle: HeartbeatTimerHandle): void {
  if (handle && typeof handle === "object" && "unref" in handle) {
    const maybe = (handle as { unref?: unknown }).unref;
    if (typeof maybe === "function") maybe.call(handle);
  }
}

/**
 * Start the heartbeat: one tick after `initialDelayMs`, then one every
 * `intervalMs`. A tick runs the sweep once; a sweep that throws is logged and
 * the next tick still fires; a tick that arrives while the previous sweep is
 * still running is skipped (and counted) rather than queued.
 */
export function startConsensusHeartbeat(opts: HeartbeatOptions): HeartbeatHandle {
  if (!Number.isFinite(opts.intervalMs) || opts.intervalMs <= 0) {
    throw new RangeError(`consensus heartbeat intervalMs must be a positive number, got ${opts.intervalMs}`);
  }
  const timers = opts.timers ?? defaultTimers();
  const logger: HeartbeatLogger = opts.logger ?? log;
  const initialDelayMs = opts.initialDelayMs ?? DEFAULT_HEARTBEAT_INITIAL_DELAY_MS;

  let stopped = false;
  let inFlight = false;
  let ticks = 0;
  let skippedOverlaps = 0;
  let failures = 0;
  let intervalHandle: HeartbeatTimerHandle = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (inFlight) {
      skippedOverlaps++;
      logger.warn(
        { op: "consensus.heartbeat.overlap", intervalMs: opts.intervalMs },
        "consensus heartbeat tick skipped: the previous sweep is still running"
      );
      return;
    }
    inFlight = true;
    ticks++;
    const startedAt = timers.now();
    try {
      const result = await opts.sweep();
      logger.info(
        {
          op: "consensus.heartbeat.tick",
          sweepRan: result.ran,
          merged: result.merged,
          durationMs: timers.now() - startedAt,
        },
        result.ran
          ? "consensus sweep completed"
          : "consensus sweep skipped: advisory lock held by a concurrent sweep"
      );
    } catch (err) {
      failures++;
      logger.error(
        { op: "consensus.heartbeat.failed", err, durationMs: timers.now() - startedAt },
        "consensus sweep threw; the next tick still fires"
      );
    } finally {
      inFlight = false;
    }
  };

  const initialHandle = timers.setTimeout(() => {
    if (stopped) return;
    void tick();
    intervalHandle = timers.setInterval(() => {
      void tick();
    }, opts.intervalMs);
    unref(intervalHandle);
  }, initialDelayMs);
  unref(initialHandle);

  logger.info(
    { op: "consensus.heartbeat.started", intervalMs: opts.intervalMs, initialDelayMs },
    "consensus heartbeat started"
  );

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      timers.clearTimeout(initialHandle);
      if (intervalHandle !== null) timers.clearInterval(intervalHandle);
      logger.info({ op: "consensus.heartbeat.stopped", ticks, skippedOverlaps, failures }, "consensus heartbeat stopped");
    },
    get ticks() {
      return ticks;
    },
    get skippedOverlaps() {
      return skippedOverlaps;
    },
    get failures() {
      return failures;
    },
    get inFlight() {
      return inFlight;
    },
  };
}

export interface HeartbeatEnv {
  DATABASE_URL?: string;
  CONSENSUS_SWEEP_INTERVAL_MINUTES?: string;
}

export interface HeartbeatFromEnvDeps {
  /** Lazily resolves the engine entry point so callers can keep `./db` out of their import graph. */
  loadSweep?: () => Promise<() => Promise<HeartbeatSweepResult>>;
  logger?: HeartbeatLogger;
  timers?: HeartbeatTimers;
  initialDelayMs?: number;
}

/**
 * The production wiring: read the env contract, refuse to start without a
 * database (there is nothing to sweep and every tick would only log an
 * error), and start the heartbeat on `runConsensusSweep`.
 *
 * Returns the handle, or `null` when the heartbeat is off — either disabled
 * by config or because `DATABASE_URL` is unset (local dev without Postgres).
 */
export async function startConsensusHeartbeatFromEnv(
  env: HeartbeatEnv = process.env as HeartbeatEnv,
  deps: HeartbeatFromEnvDeps = {}
): Promise<HeartbeatHandle | null> {
  const logger: HeartbeatLogger = deps.logger ?? log;
  const resolution = resolveHeartbeatInterval(env.CONSENSUS_SWEEP_INTERVAL_MINUTES);

  if (!resolution.enabled) {
    logger.info(
      { op: "consensus.heartbeat.disabled", env: CONSENSUS_SWEEP_INTERVAL_ENV, raw: resolution.raw },
      "consensus heartbeat disabled by configuration"
    );
    return null;
  }
  if (!env.DATABASE_URL) {
    logger.warn(
      { op: "consensus.heartbeat.no-database" },
      "consensus heartbeat not started: DATABASE_URL is unset, so there is no graph to sweep"
    );
    return null;
  }
  if (resolution.source === "invalid-fallback") {
    logger.warn(
      {
        op: "consensus.heartbeat.invalid-interval",
        env: CONSENSUS_SWEEP_INTERVAL_ENV,
        raw: resolution.raw,
        intervalMs: resolution.intervalMs,
      },
      "CONSENSUS_SWEEP_INTERVAL_MINUTES is not a positive number; using the default cadence"
    );
  }

  const loadSweep =
    deps.loadSweep ??
    (async () => {
      const { runConsensusSweep } = await import("./db");
      return () => runConsensusSweep();
    });
  const sweep = await loadSweep();

  return startConsensusHeartbeat({
    intervalMs: resolution.intervalMs,
    initialDelayMs: deps.initialDelayMs,
    sweep,
    logger,
    timers: deps.timers,
  });
}
