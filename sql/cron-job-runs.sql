-- Detached cron job outcomes — tailor-group#38.
-- Idempotent: CREATE TABLE IF NOT EXISTS, safe to re-run on every cold start.
-- Applied at startup by initSchema() in src/lib/db.ts, after the per-job
-- schemas it complements.
--
-- One row PER JOB NAME, not per run: `startDetachedJob` / `runJobInline`
-- (src/lib/detached-jobs.ts) upsert the row when a run takes the job's
-- advisory lock and stamp completed_at / ok / summary just before it unlocks,
-- so the row is always the LAST outcome of that job. It is what
-- `GET /api/cron/<job>/status` reports as `lastRun`, for every detached job
-- alike — the spatial snapshot has no log table of its own, and the GTFS,
-- fiscal and legislation logs each have a different shape. The jobs keep
-- writing their own detailed log rows as before; this row is the common,
-- machine-checkable "did the run we triggered finish, and did it succeed".
--
--   job_name     — the route name (`legislation-sync`, `gtfs-sync`,
--                  `fiscal-sync`, `spatial-snapshot`).
--   job_id       — the run's uuid, the one the 202 trigger response carries
--                  and the `cron.<job>.*` log lines are tagged with.
--   started_at   — Postgres now() on the locked connection, the same value
--                  the trigger response returns, so a poller can compare.
--   completed_at — NULL while the run holds the lock; set in the same
--                  statement as ok/summary, BEFORE the lock is released.
--   ok           — the job's own verdict on its result (each route maps its
--                  result to ok + summary); FALSE with summary.error when the
--                  job threw. NULL while running.
--   summary      — small JSON the job chose to record (counts, first error).
--
-- "Running" is NOT read from here: it comes from pg_locks (the advisory lock
-- dies with the connection that held it), so a replica that dies mid-run
-- leaves completed_at NULL next to a free lock, which is exactly what the
-- poller reports as "died".

CREATE TABLE IF NOT EXISTS cron_job_runs (
  job_name     TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  ok           BOOLEAN,
  summary      JSONB
);
