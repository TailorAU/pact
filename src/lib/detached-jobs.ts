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
 * `runJobInline` is the same lock around a run that completes INSIDE the
 * caller's turn (the routes' `?wait=1`), so an inline run can never overlap
 * a detached one, or another inline one, on any replica.
 *
 * `isDetachedJobRunning` answers "is the lock held anywhere?" from
 * `pg_locks`, not from a jobs table: a table row would need a heartbeat and
 * a reaper to stay honest when a replica dies mid-run, whereas the session
 * lock vanishes with the connection that held it, so `pg_locks` is exactly
 * as current as the thing it describes, needs no schema, and is the same
 * source of truth the trigger path consults through `pg_try_advisory_lock`.
 *
 * Nothing thrown by a detached job reaches a request: it is logged as
 * `cron.<job>.failed` and the lock is released regardless.
 */
import { v4 as uuid } from "uuid";
import { getDb, getDedicatedConnection } from "./db";
import { log } from "./logger";

export interface DetachedJobSpec<T = unknown> {
  /** Short job name; becomes the `cron.<name>.*` log op. */
  name: string;
  /** One-bigint advisory-lock key from the registry in src/lib/db.ts. */
  lockKey: number;
  /**
   * The work. Detached, its resolved value is discarded and a throw is
   * logged, never propagated; inline, the value is handed back and a throw
   * propagates once the lock and connection are released.
   */
  run: () => Promise<T>;
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

export type InlineJobOutcome<T> = { started: true; result: T } | { started: false; running: true };

/**
 * The slice of `pg.PoolClient` the lock protocol needs. `release(err)` is
 * pg-pool's contract: released with an Error the client is DESTROYED, not
 * returned to the pool.
 */
interface LockClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(err?: Error): void;
}

/**
 * Try to take the job's advisory lock; on success schedule `run` to execute
 * after the current turn (so the caller's response goes out first) and
 * return immediately. When another connection — this replica or any other —
 * already holds the lock, report `running: true` and touch nothing.
 */
export async function startDetachedJob<T>(spec: DetachedJobSpec<T>): Promise<DetachedJobStart> {
  const client = await getDedicatedConnection();
  if (!(await tryAdvisoryLock(spec, client))) {
    log.info({ op: `cron.${spec.name}.skipped`, lockKey: spec.lockKey }, "detached job skipped: advisory lock held by a concurrent run");
    client.release();
    return { started: false, running: true };
  }

  let startedAt: string;
  try {
    const nowResult = await client.query("SELECT now() AS started_at");
    startedAt = toIsoString(nowResult.rows[0]?.started_at) ?? new Date().toISOString();
  } catch (err) {
    // The lock WAS taken; without this it would be stranded for the
    // replica's lifetime (or until the connection dies).
    await releaseLockAndConnection(spec, client, null);
    throw err;
  }

  // Ownership of the connection (and the lock) passes to `execute` here.
  const jobId = uuid();
  setImmediate(() => {
    void execute(spec, client, jobId, startedAt);
  });
  log.info({ op: `cron.${spec.name}.started`, jobId, startedAt }, "detached job started");
  return { started: true, jobId, startedAt };
}

/**
 * Run `spec.run` to completion inside the caller's turn under the job's
 * advisory lock — the routes' `?wait=1`. Same single-flight guarantee as
 * `startDetachedJob`, whichever path holds the lock: when it is held
 * elsewhere the job is not run and `running: true` is reported. A throw from
 * the job propagates to the caller after the lock and connection are
 * released.
 */
export async function runJobInline<T>(spec: DetachedJobSpec<T>): Promise<InlineJobOutcome<T>> {
  const client = await getDedicatedConnection();
  if (!(await tryAdvisoryLock(spec, client))) {
    log.info({ op: `cron.${spec.name}.skipped`, lockKey: spec.lockKey }, "inline job skipped: advisory lock held by a concurrent run");
    client.release();
    return { started: false, running: true };
  }
  try {
    return { started: true, result: await spec.run() };
  } finally {
    await releaseLockAndConnection(spec, client, null);
  }
}

/**
 * `pg_try_advisory_lock` on the dedicated connection. A throw here leaves the
 * connection's session state unknown — the server may have granted the lock
 * before the response was lost — so the client is released WITH the error,
 * which makes pg-pool destroy it (ending the session and any lock it holds)
 * instead of lending it to the next borrower; the error then propagates.
 */
async function tryAdvisoryLock(spec: Pick<DetachedJobSpec, "lockKey">, client: LockClient): Promise<boolean> {
  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [spec.lockKey]);
    return lockResult.rows[0]?.acquired === true;
  } catch (err) {
    client.release(asError(err));
    throw err;
  }
}

/**
 * `pg_advisory_unlock` on the connection that holds the lock, then hand the
 * connection back to the pool. A clean unlock returns it as reusable. An
 * unlock that throws returns it WITH the error so pg-pool destroys it rather
 * than pooling it: if the connection is dead its session locks died with it
 * and nothing is stranded, and if it is somehow alive it still holds the
 * session lock, which would otherwise travel with it to the next borrower and
 * hold `isDetachedJobRunning` true with no job running. Either way the throw
 * is logged and never propagated.
 */
export async function releaseLockAndConnection(
  spec: Pick<DetachedJobSpec, "name" | "lockKey">,
  client: LockClient,
  jobId: string | null
): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [spec.lockKey]);
  } catch (err) {
    log.warn(
      { op: `cron.${spec.name}.unlock-failed`, jobId, err },
      "advisory unlock threw; the connection is destroyed rather than pooled so the lock dies with it"
    );
    client.release(asError(err));
    return;
  }
  client.release();
}

async function execute<T>(spec: DetachedJobSpec<T>, client: LockClient, jobId: string, startedAt: string): Promise<void> {
  const t0 = Date.now();
  try {
    await spec.run();
    log.info({ op: `cron.${spec.name}.completed`, jobId, startedAt, durationMs: Date.now() - t0 }, "detached job completed");
  } catch (err) {
    log.error({ op: `cron.${spec.name}.failed`, jobId, startedAt, err, durationMs: Date.now() - t0 }, "detached job failed");
  } finally {
    await releaseLockAndConnection(spec, client, jobId);
  }
}

/**
 * Whether the job's advisory lock is held by ANY session in the cluster, in
 * THIS database: advisory locks are per database and `pg_locks` lists every
 * database's, so an unrelated database on the same server that happens to
 * use the same key must not read as a running job. A one-bigint advisory key
 * shows in `pg_locks` as `classid` = high 32 bits, `objid` = low 32 bits,
 * `objsubid` = 1.
 */
export async function isDetachedJobRunning(lockKey: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND objsubid = 1
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
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

/** pg-pool destroys a released client only when handed an Error, so a non-Error rejection is wrapped. */
function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
