/**
 * Detached cron jobs (tailor-group#38).
 *
 * pact.tailor.au is served through the tailor-app frontend's Next.js rewrite,
 * which proxies every path to the pact-web Container App with a 30 s default
 * `proxyTimeout`. A cron route that does its work inside the request — the
 * legislation sync takes 30 s with `CTH_SYNC_MAX_ACTS=3` and minutes at the
 * default 50 Acts plus QLD — never answers: the proxy gives up and the
 * scheduled caller sees a bare 500 with no application headers, while the
 * work carries on (or not) unobserved.
 *
 * `startDetachedJob` splits the two. The route takes the job's Postgres
 * advisory lock, answers at once, and the job runs to completion behind the
 * response. The lock is what makes the run single-flight across replicas:
 * pact-web runs 1–3 replicas with no Redis, so in-memory state is per
 * replica, but Postgres is shared and a SESSION-level advisory lock is held
 * by exactly one connection cluster-wide until that connection unlocks it or
 * dies. The lock is acquired and released on the SAME dedicated pooled
 * connection for the whole run — `pool.query` round-robins connections and
 * would strand it — mirroring `runConsensusSweep` (`CONSENSUS_SWEEP_LOCK_KEY`,
 * src/lib/db.ts, where the key registry lives).
 *
 * `isDetachedJobRunning` answers "is the lock held anywhere?" from
 * `pg_locks`, not from a jobs table: a table row would need a heartbeat and
 * a reaper to stay honest when a replica dies mid-run, whereas the session
 * lock vanishes with the connection that held it, so `pg_locks` is exactly
 * as current as the thing it describes, needs no schema, and is the same
 * source of truth the trigger path consults through `pg_try_advisory_lock`.
 *
 * Nothing thrown by the job reaches a request: it is logged as
 * `cron.<job>.failed` and the lock is released regardless.
 */
import { v4 as uuid } from "uuid";
import { getDb, getDedicatedConnection } from "./db";
import { log } from "./logger";

export interface DetachedJobSpec {
  /** Short job name; becomes the `cron.<name>.*` log op. */
  name: string;
  /** One-bigint advisory-lock key from the registry in src/lib/db.ts. */
  lockKey: number;
  /** The work. Its resolved value is discarded; a throw is logged, never propagated. */
  run: () => Promise<unknown>;
}

export type DetachedJobStart =
  | {
      started: true;
      /** Identifies this run in the `cron.<name>.*` log lines. */
      jobId: string;
      /**
       * ISO-8601, minted by Postgres `now()` on the locked connection — the
       * same clock that stamps the job's own `started_at` rows, so a caller
       * polling those rows can compare without worrying about skew between
       * the app container and the database.
       */
      startedAt: string;
    }
  | { started: false; running: true };

/**
 * Try to take the job's advisory lock; on success schedule `run` to execute
 * after the current turn (so the caller's response goes out first) and
 * return immediately. When another connection — this replica or any other —
 * already holds the lock, report `running: true` and touch nothing.
 */
export async function startDetachedJob(spec: DetachedJobSpec): Promise<DetachedJobStart> {
  const client = await getDedicatedConnection();
  let acquired = false;
  let handedOff = false;
  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [spec.lockKey]);
    acquired = lockResult.rows[0]?.acquired === true;
    if (!acquired) {
      log.info({ op: `cron.${spec.name}.skipped`, lockKey: spec.lockKey }, "detached job skipped: advisory lock held by a concurrent run");
      return { started: false, running: true };
    }
    const nowResult = await client.query("SELECT now() AS started_at");
    const startedAt = toIsoString(nowResult.rows[0]?.started_at) ?? new Date().toISOString();
    const jobId = uuid();

    setImmediate(() => {
      void execute(spec, client, jobId, startedAt);
    });
    handedOff = true;

    log.info({ op: `cron.${spec.name}.started`, jobId, startedAt }, "detached job started");
    return { started: true, jobId, startedAt };
  } finally {
    // Ownership of the connection (and the lock) passes to `execute` only
    // once `setImmediate` is scheduled. Every other exit path releases here:
    // lock busy, the lock query threw, or — the case that would otherwise
    // strand the lock for the replica's lifetime — the lock WAS taken and a
    // later query (`now()`) threw before the hand-off.
    if (!handedOff) {
      if (acquired) await releaseLock(spec, client, null);
      client.release();
    }
  }
}

/**
 * Best-effort `pg_advisory_unlock` on the connection that holds the lock.
 * A dead connection has already dropped its session locks, so a throw here
 * strands nothing; it is logged so an unlock failure on a live connection
 * is visible.
 */
async function releaseLock(
  spec: DetachedJobSpec,
  client: { query(text: string, values?: unknown[]): Promise<unknown> },
  jobId: string | null
): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [spec.lockKey]);
  } catch (err) {
    log.warn({ op: `cron.${spec.name}.unlock-failed`, jobId, err }, "advisory unlock threw; the lock dies with the connection");
  }
}

async function execute(
  spec: DetachedJobSpec,
  client: { query(text: string, values?: unknown[]): Promise<unknown>; release(): void },
  jobId: string,
  startedAt: string
): Promise<void> {
  const t0 = Date.now();
  try {
    await spec.run();
    log.info({ op: `cron.${spec.name}.completed`, jobId, startedAt, durationMs: Date.now() - t0 }, "detached job completed");
  } catch (err) {
    log.error({ op: `cron.${spec.name}.failed`, jobId, startedAt, err, durationMs: Date.now() - t0 }, "detached job failed");
  } finally {
    await releaseLock(spec, client, jobId);
    client.release();
  }
}

/**
 * Whether the job's advisory lock is held by ANY session in the cluster.
 * A one-bigint advisory key shows in `pg_locks` as `classid` = high 32 bits,
 * `objid` = low 32 bits, `objsubid` = 1.
 */
export async function isDetachedJobRunning(lockKey: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND objsubid = 1
        AND classid = ((?::bigint >> 32) & 4294967295)::oid
        AND objid = (?::bigint & 4294967295)::oid
    ) AS held`,
    args: [lockKey, lockKey],
  });
  return result.rows[0]?.held === true;
}

/** `pg` hands TIMESTAMPTZ back as a Date; a mocked client may hand a string. */
export function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" && value !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
