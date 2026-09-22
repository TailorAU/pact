/**
 * Detached cron jobs (tailor-group#38).
 *
 * pact.tailor.au is served through the tailor-app frontend's Next.js rewrite,
 * which proxies every path to the pact-web Container App with a 30 s default
 * `proxyTimeout`. A cron route that does its work inside the request — the
 * legislation sync takes 30 s with `CTH_SYNC_MAX_ACTS=3` and minutes at the
 * default 50 Acts plus QLD; the GTFS, fiscal and spatial jobs run for minutes
 * too — never answers: the proxy gives up and the scheduled caller sees a
 * bare 500 with no application headers, while the work carries on (or not)
 * unobserved.
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
 * Every run, detached or inline, records itself in `cron_job_runs`
 * (sql/cron-job-runs.sql): one row per job name, upserted on the locked
 * connection when the run starts and stamped with `completed_at`, `ok` and
 * `summary` just before the lock is released. The job's `outcome` maps its
 * result to that verdict; a throw records `ok: false` with the message.
 * `getDetachedJobStatus` is what every `GET /api/cron/<job>/status` reports:
 * whether the lock is held anywhere plus that last row, so a poller can wait
 * for "the run we triggered has a completedAt" and read `ok` — the same
 * shape for a job with a detailed log table of its own and for one without.
 *
 * `isDetachedJobRunning` answers "is the lock held anywhere?" from
 * `pg_locks`, not from the row: a row would need a heartbeat and a reaper to
 * stay honest when a replica dies mid-run, whereas the session lock vanishes
 * with the connection that held it, so `pg_locks` is exactly as current as
 * the thing it describes and is the same source of truth the trigger path
 * consults through `pg_try_advisory_lock`. A free lock next to a row with no
 * `completed_at` is therefore an honest "died mid-run".
 *
 * Nothing thrown by a detached job reaches a request: it is logged as
 * `cron.<job>.failed` and the lock is released regardless.
 */
import { v4 as uuid } from "uuid";
import { getDb, getDedicatedConnection } from "./db";
import { log } from "./logger";

/** What a run leaves in `cron_job_runs`: the job's own verdict plus a small JSON summary. */
export interface JobOutcome {
  ok: boolean;
  summary: Record<string, unknown>;
}

export interface DetachedJobSpec<T = unknown> {
  /** Short job name; becomes the `cron.<name>.*` log op and the `cron_job_runs.job_name`. */
  name: string;
  /** One-bigint advisory-lock key from the registry in src/lib/db.ts. */
  lockKey: number;
  /**
   * The work. Detached, its resolved value is discarded and a throw is
   * logged, never propagated; inline, the value is handed back and a throw
   * propagates once the lock and connection are released.
   */
  run: () => Promise<T>;
  /**
   * Maps the resolved result to what `cron_job_runs` records. Absent, a
   * resolved run is `ok: true` with an empty summary. A throw is always
   * `ok: false, summary: { error }` and never consults this.
   */
  outcome?: (result: T) => JobOutcome;
}

export type DetachedJobStart =
  | {
      started: true;
      /** Identifies this run in the `cron.<name>.*` log lines and in `cron_job_runs.job_id`. */
      jobId: string;
      /**
       * ISO-8601, minted by Postgres `now()` on the locked connection — the
       * same clock that stamps the job's own `started_at` rows and the
       * `cron_job_runs` row, so a caller polling those rows can compare
       * without worrying about skew between the app container and the
       * database.
       */
      startedAt: string;
    }
  | { started: false; running: true };

export type InlineJobOutcome<T> =
  | { started: true; jobId: string; startedAt: string; result: T }
  | { started: false; running: true };

/** The `cron_job_runs` row for a job, camelCased; `ok` is null while the run is in flight. */
export interface DetachedJobLastRun {
  jobId: string;
  startedAt: string | null;
  completedAt: string | null;
  ok: boolean | null;
  summary: Record<string, unknown> | null;
}

export interface DetachedJobStatus {
  /** The job's advisory lock is held by some session in the cluster. */
  running: boolean;
  /** The last run recorded for the job, or null before its first run. */
  lastRun: DetachedJobLastRun | null;
}

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
 * Try to take the job's advisory lock; on success record the run's start,
 * schedule `run` to execute after the current turn (so the caller's response
 * goes out first) and return immediately. When another connection — this
 * replica or any other — already holds the lock, report `running: true` and
 * touch nothing.
 */
export async function startDetachedJob<T>(spec: DetachedJobSpec<T>): Promise<DetachedJobStart> {
  const client = await getDedicatedConnection();
  if (!(await tryAdvisoryLock(spec, client))) {
    log.info({ op: `cron.${spec.name}.skipped`, lockKey: spec.lockKey }, "detached job skipped: advisory lock held by a concurrent run");
    client.release();
    return { started: false, running: true };
  }

  const { jobId, startedAt } = await recordStart(spec, client);

  // Ownership of the connection (and the lock) passes to `execute` here.
  setImmediate(() => {
    void execute(spec, client, jobId, startedAt);
  });
  log.info({ op: `cron.${spec.name}.started`, jobId, startedAt }, "detached job started");
  return { started: true, jobId, startedAt };
}

/**
 * Run `spec.run` to completion inside the caller's turn under the job's
 * advisory lock — the routes' `?wait=1`. Same single-flight guarantee and
 * the same `cron_job_runs` record as `startDetachedJob`, whichever path
 * holds the lock: when it is held elsewhere the job is not run and
 * `running: true` is reported. A throw from the job is recorded as
 * `ok: false` and propagates to the caller after the lock and connection
 * are released.
 */
export async function runJobInline<T>(spec: DetachedJobSpec<T>): Promise<InlineJobOutcome<T>> {
  const client = await getDedicatedConnection();
  if (!(await tryAdvisoryLock(spec, client))) {
    log.info({ op: `cron.${spec.name}.skipped`, lockKey: spec.lockKey }, "inline job skipped: advisory lock held by a concurrent run");
    client.release();
    return { started: false, running: true };
  }
  const { jobId, startedAt } = await recordStart(spec, client);
  try {
    const result = await spec.run();
    await recordCompletion(spec, client, jobId, resolveOutcome(spec, result));
    return { started: true, jobId, startedAt, result };
  } catch (err) {
    await recordCompletion(spec, client, jobId, failedOutcome(err));
    throw err;
  } finally {
    await releaseLockAndConnection(spec, client, jobId);
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
 * Mint the run's id and upsert its `cron_job_runs` row on the LOCKED
 * connection, taking `started_at` from the same statement so the value the
 * caller is told is the value the row holds. The lock is already taken, so
 * a throw here unlocks and releases before propagating — without that the
 * lock would be stranded for the replica's lifetime (or until the
 * connection dies).
 */
async function recordStart(
  spec: Pick<DetachedJobSpec, "name" | "lockKey">,
  client: LockClient
): Promise<{ jobId: string; startedAt: string }> {
  const jobId = uuid();
  try {
    const inserted = await client.query(
      `INSERT INTO cron_job_runs (job_name, job_id, started_at, completed_at, ok, summary)
       VALUES ($1, $2, now(), NULL, NULL, NULL)
       ON CONFLICT (job_name) DO UPDATE
         SET job_id = EXCLUDED.job_id, started_at = EXCLUDED.started_at,
             completed_at = NULL, ok = NULL, summary = NULL
       RETURNING started_at`,
      [spec.name, jobId]
    );
    const startedAt = toIsoString(inserted.rows[0]?.started_at) ?? new Date().toISOString();
    return { jobId, startedAt };
  } catch (err) {
    await releaseLockAndConnection(spec, client, jobId);
    throw err;
  }
}

/**
 * Stamp the row BEFORE the lock is released: a poller that sees the lock
 * free is then guaranteed to read the completed row. A throw here is logged
 * (`cron.<job>.record-failed`) and swallowed — the unlock that follows
 * decides what happens to the connection.
 */
async function recordCompletion(
  spec: Pick<DetachedJobSpec, "name">,
  client: LockClient,
  jobId: string,
  outcome: JobOutcome
): Promise<void> {
  try {
    await client.query(
      `UPDATE cron_job_runs SET completed_at = now(), ok = $2, summary = $3::jsonb WHERE job_id = $1`,
      [jobId, outcome.ok, JSON.stringify(outcome.summary)]
    );
  } catch (err) {
    log.warn({ op: `cron.${spec.name}.record-failed`, jobId, err }, "could not record the run's outcome in cron_job_runs");
  }
}

function resolveOutcome<T>(spec: DetachedJobSpec<T>, result: T): JobOutcome {
  return spec.outcome ? spec.outcome(result) : { ok: true, summary: {} };
}

function failedOutcome(err: unknown): JobOutcome {
  return { ok: false, summary: { error: err instanceof Error ? err.message : String(err) } };
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
    const result = await spec.run();
    const outcome = resolveOutcome(spec, result);
    await recordCompletion(spec, client, jobId, outcome);
    log.info(
      { op: `cron.${spec.name}.completed`, jobId, startedAt, ok: outcome.ok, durationMs: Date.now() - t0 },
      "detached job completed"
    );
  } catch (err) {
    await recordCompletion(spec, client, jobId, failedOutcome(err));
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

/**
 * The status every `GET /api/cron/<job>/status` route reports.
 *
 * Lock first, row second — not concurrently. The job stamps `completed_at`
 * and only then unlocks, so a lock observed FREE at time t means the row of
 * the run that held it was committed before t, and a row read after t sees
 * it. Read the other way round (or in parallel, on two pool connections) a
 * poller can see `running: false` next to a row whose `completedAt` is
 * still null and call a run that finished fine "died".
 */
export async function getDetachedJobStatus(name: string, lockKey: number): Promise<DetachedJobStatus> {
  const running = await isDetachedJobRunning(lockKey);
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT job_id, started_at, completed_at, ok, summary FROM cron_job_runs WHERE job_name = ?`,
    args: [name],
  });
  const row = result.rows[0];
  if (!row) return { running, lastRun: null };
  return {
    running,
    lastRun: {
      jobId: String(row.job_id),
      startedAt: toIsoString(row.started_at),
      completedAt: toIsoString(row.completed_at),
      ok: typeof row.ok === "boolean" ? row.ok : null,
      summary: parseSummary(row.summary),
    },
  };
}

/** `pg` hands JSONB back parsed; a mocked client (or a TEXT cast) may hand a string. */
function parseSummary(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
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
