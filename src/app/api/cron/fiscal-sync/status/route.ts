export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb, FISCAL_SYNC_LOCK_KEY } from "@/lib/db";
import { getDetachedJobStatus, toIsoString } from "@/lib/detached-jobs";
import { safeSecretEqual } from "@/lib/secret-compare";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

/**
 * tailor-group#38 — the outcome of a detached fiscal sync.
 *
 *   { running: <advisory lock held anywhere in the cluster>,
 *     lastRun: { jobId, startedAt, completedAt, ok, summary } | null,
 *     runs: [ latest fiscal_sync_log row per jurisdiction ] }
 *
 * `lastRun` is the job's `cron_job_runs` row, the shape every detached job's
 * status route shares; `runs` are this job's own audit rows, for the detail.
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

  // Lock first, rows second — see getDetachedJobStatus.
  const { running, lastRun } = await getDetachedJobStatus("fiscal-sync", FISCAL_SYNC_LOCK_KEY);
  const db = await getDb();
  const latest = await db.execute(
    `SELECT DISTINCT ON (jurisdiction)
       id, jurisdiction, started_at, completed_at, lines_checked, lines_written,
       model_version, anomaly_count, crash_count, silent_zero_flag, errors
     FROM fiscal_sync_log
     ORDER BY jurisdiction, started_at DESC`
  );

  const runs = latest.rows.map(row => ({
    id: String(row.id),
    jurisdiction: String(row.jurisdiction),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    linesChecked: Number(row.lines_checked ?? 0),
    linesWritten: Number(row.lines_written ?? 0),
    modelVersion: typeof row.model_version === "string" ? row.model_version : null,
    anomalyCount: Number(row.anomaly_count ?? 0),
    crashCount: Number(row.crash_count ?? 0),
    silentZeroFlag: row.silent_zero_flag === true,
    errors: parseErrors(row.errors),
  }));

  return NextResponse.json({ running, lastRun, runs }, { headers: NO_STORE_HEADERS });
}

/** `errors` is JSONB (`pg` hands it back parsed) or its JSON text; anything else reads as no errors. */
function parseErrors(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(e => String(e));
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(e => String(e)) : [];
  } catch {
    return [];
  }
}
