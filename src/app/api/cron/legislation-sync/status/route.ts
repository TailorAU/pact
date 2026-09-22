export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb, LEGISLATION_SYNC_LOCK_KEY } from "@/lib/db";
import { getDetachedJobStatus, toIsoString } from "@/lib/detached-jobs";
import { safeSecretEqual } from "@/lib/secret-compare";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

/**
 * tailor-group#38 — the outcome of a detached legislation sync.
 *
 *   { running: <advisory lock held anywhere in the cluster>,
 *     lastRun: { jobId, startedAt, completedAt, ok, summary } | null,
 *     runs: [ latest legislation_sync_log row per jurisdiction ] }
 *
 * `lastRun` is the job's `cron_job_runs` row — the shape every detached
 * job's status route shares; its `summary.jurisdictions[]` carries each
 * jurisdiction's counts and first error string. `runs` keeps this job's
 * detailed per-jurisdiction rows. Both `startedAt`s come from the same
 * Postgres clock as the trigger's, so `.github/workflows/cron.yml` can wait
 * for a `lastRun` at least as new as its own trigger that carries a
 * `completedAt`.
 *
 * Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
  if (!safeSecretEqual(req.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  // Lock first, rows second — not concurrently (getDetachedJobStatus reads
  // the lock before the cron_job_runs row; the legislation rows follow). The
  // job stamps `completed_at` and only then unlocks, so a lock observed FREE
  // at time t means every row of the run that held it was committed before
  // t, and a row read after t sees them. Read the other way round (or in
  // parallel, on two pool connections) the poller can see `running: false`
  // next to a row whose `completed_at` is still NULL and call a run that
  // finished fine "died".
  const { running, lastRun } = await getDetachedJobStatus("legislation-sync", LEGISLATION_SYNC_LOCK_KEY);
  const db = await getDb();
  const latest = await db.execute(
    `SELECT DISTINCT ON (jurisdiction)
       id, jurisdiction, started_at, completed_at, docs_checked, docs_updated,
       sections_total, errors, parser_crash_count, parser_anomaly_count, silent_zero_flag
     FROM legislation_sync_log
     ORDER BY jurisdiction, started_at DESC`
  );

  const runs = latest.rows.map(row => ({
    id: String(row.id),
    jurisdiction: String(row.jurisdiction),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    docsChecked: Number(row.docs_checked ?? 0),
    docsUpdated: Number(row.docs_updated ?? 0),
    sectionsTotal: Number(row.sections_total ?? 0),
    errors: parseErrors(row.errors),
    parserCrashCount: Number(row.parser_crash_count ?? 0),
    parserAnomalyCount: Number(row.parser_anomaly_count ?? 0),
    silentZeroFlag: row.silent_zero_flag === true,
  }));

  return NextResponse.json({ running, lastRun, runs }, { headers: NO_STORE_HEADERS });
}

/** `errors` is JSON text (`JSON.stringify(string[])`) or NULL; anything else reads as no errors. */
function parseErrors(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(e => String(e)) : [];
  } catch {
    return [];
  }
}
