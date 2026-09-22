export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb, GTFS_SYNC_LOCK_KEY } from "@/lib/db";
import { runJobInline, startDetachedJob, type JobOutcome } from "@/lib/detached-jobs";
import { runGtfsSync, type GtfsSyncResult } from "@/lib/gtfs-sync";
import { safeSecretEqual } from "@/lib/secret-compare";

/**
 * Cron job: syncs Translink SEQ GTFS static feed into transit_* tables.
 * Triggered weekly by GitHub Actions (or on-demand via workflow_dispatch).
 *
 * tailor-group#38 — the sync downloads and ingests a whole GTFS feed, which
 * takes minutes, and pact.tailor.au sits behind a Next.js rewrite proxy with
 * a 30 s timeout. By default the route now starts the sync DETACHED under the
 * `GTFS_SYNC_LOCK_KEY` advisory lock (single flight across replicas) and
 * answers 202 at once; the caller polls `GET /api/cron/gtfs-sync/status`.
 * The run's `cron_job_runs` row records `ok` = the sync reported no error
 * (`runGtfsSync` catches its own failures into `errors` and writes them to
 * `gtfs_sync_log`; a failed feed download is therefore `ok: false`).
 *
 * Query params:
 *   ?wait=1  — run synchronously and answer 200 with the results (local use
 *              and tests). Same lock: a wait run never overlaps a detached one.
 *
 * Responses:
 *   202 { started: true, jobId, startedAt }
 *   202 { started: false, running: true }  — lock already held (either mode)
 *   200 { message, ...counts, keyStations, errors }  — ?wait=1 only
 *   500 { error }                                     — ?wait=1 threw
 *
 * Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (!safeSecretEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = {
    name: "gtfs-sync",
    lockKey: GTFS_SYNC_LOCK_KEY,
    run: async () => runGtfsSync(await getDb()),
    outcome: gtfsOutcome,
  };

  if (req.nextUrl.searchParams.get("wait") !== "1") {
    const start = await startDetachedJob(job);
    return NextResponse.json(start, { status: 202 });
  }

  try {
    const outcome = await runJobInline(job);
    if (!outcome.started) {
      return NextResponse.json({ started: false, running: true }, { status: 202 });
    }
    const result = outcome.result;
    return NextResponse.json({
      message: `GTFS sync complete: ${result.stopsIngested} stops, ${result.routesIngested} routes, ${result.tripsIngested} trips, ${result.stopTimesIngested} stop_times`,
      stopsIngested: result.stopsIngested,
      routesIngested: result.routesIngested,
      tripsIngested: result.tripsIngested,
      stopTimesIngested: result.stopTimesIngested,
      keyStations: result.keyStations,
      errors: result.errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `GTFS sync failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

/** `ok` iff the sync reported no error; the summary keeps the counts and the error strings. */
function gtfsOutcome(result: GtfsSyncResult): JobOutcome {
  return {
    ok: result.errors.length === 0,
    summary: {
      stopsIngested: result.stopsIngested,
      routesIngested: result.routesIngested,
      tripsIngested: result.tripsIngested,
      stopTimesIngested: result.stopTimesIngested,
      keyStations: result.keyStations.length,
      errors: result.errors,
    },
  };
}
