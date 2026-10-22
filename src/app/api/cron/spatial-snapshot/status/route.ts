export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { SPATIAL_SNAPSHOT_LOCK_KEY } from "@/lib/db";
import { getDetachedJobStatus } from "@/lib/detached-jobs";
import { safeSecretEqual } from "@/lib/secret-compare";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

/**
 * tailor-group#38 — the outcome of a detached spatial snapshot.
 *
 *   { running: <advisory lock held anywhere in the cluster>,
 *     lastRun: { jobId, startedAt, completedAt, ok, summary } | null }
 *
 * The snapshot has no sync-log table of its own (it updates
 * `spatial_snapshot_layer` in place), so `lastRun` — the job's
 * `cron_job_runs` row, the shape every detached job's status route shares —
 * is the whole record: `summary.results[]` carries every layer's status and
 * `errorDetail`, `summary.warning` is true when any layer errored.
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

  const { running, lastRun } = await getDetachedJobStatus("spatial-snapshot", SPATIAL_SNAPSHOT_LOCK_KEY);
  return NextResponse.json({ running, lastRun }, { headers: NO_STORE_HEADERS });
}
