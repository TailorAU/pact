export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb, GTFS_SYNC_LOCK_KEY } from "@/lib/db";
import { getDetachedJobStatus, toIsoString } from "@/lib/detached-jobs";
import { safeSecretEqual } from "@/lib/secret-compare";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

/**
 * tailor-group#38 — the outcome of a detached GTFS sync.
 *
 *   { running: <advisory lock held anywhere in the cluster>,
 *     lastRun: { jobId, startedAt, completedAt, ok, summary } | null,
 *     runs: [ the latest gtfs_sync_log row ] }
 *
 * `lastRun` is the job's `cron_job_runs` row, the shape every detached job's
 * status route shares; `runs` is this job's own log row, for the detail.
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
  const { running, lastRun } = await getDetachedJobStatus("gtfs-sync", GTFS_SYNC_LOCK_KEY);
  const db = await getDb();
  const latest = await db.execute(
    `SELECT id, feed_url, started_at, completed_at, stops_ingested, routes_ingested,
            trips_ingested, stop_times_ingested, errors
     FROM gtfs_sync_log
     ORDER BY started_at DESC
     LIMIT 1`
  );

  const runs = latest.rows.map(row => ({
    id: String(row.id),
    feedUrl: String(row.feed_url ?? ""),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    stopsIngested: Number(row.stops_ingested ?? 0),
    routesIngested: Number(row.routes_ingested ?? 0),
    tripsIngested: Number(row.trips_ingested ?? 0),
    stopTimesIngested: Number(row.stop_times_ingested ?? 0),
    // `errors` is free text (the caught message) or NULL.
    errors: typeof row.errors === "string" && row.errors !== "" ? [row.errors] : [],
  }));

  return NextResponse.json({ running, lastRun, runs }, { headers: NO_STORE_HEADERS });
}
