export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb, SPATIAL_SNAPSHOT_LOCK_KEY } from "@/lib/db";
import { runJobInline, startDetachedJob, type JobOutcome } from "@/lib/detached-jobs";
import { refreshLayer, LOGAN_LAYERS, type LayerRefreshResult } from "@/lib/spatial-snapshot";
import { safeSecretEqual } from "@/lib/secret-compare";

/**
 * Cron job: daily Logan ArcGIS spatial snapshot (Refs #874, parent #852).
 * Fetches each Logan layer and stores features with full traceability metadata.
 * Triggered daily at 2am UTC by GitHub Actions cron.yml.
 *
 * tailor-group#38 — pact.tailor.au sits behind a Next.js rewrite proxy with
 * a 30 s timeout, so the route no longer fetches the layers inside the
 * request. By default it starts the snapshot DETACHED under the
 * `SPATIAL_SNAPSHOT_LOCK_KEY` advisory lock (single flight across replicas)
 * and answers 202 at once; the caller polls
 * `GET /api/cron/spatial-snapshot/status`. The run's `cron_job_runs` row
 * keeps the synchronous route's verdict: `ok` is false only when every
 * layer errored and none synced (the old 500), and `summary.warning` is
 * true whenever any layer errored (ArcGIS throttles; the workflow treats
 * both as warnings, never as our failure), with every layer's result in
 * `summary.results`.
 *
 * Query params:
 *   ?layer=<name>  — one layer instead of all of LOGAN_LAYERS
 *   ?wait=1        — run synchronously: 200 (or 500 when nothing synced and
 *                    something errored) with the results. Same lock.
 *
 * Responses:
 *   202 { started: true, jobId, startedAt, layers }
 *   202 { started: false, running: true, layers }  — lock already held
 *   200 / 500 { message, results, timestamp }      — ?wait=1 only
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

  const layerParam = req.nextUrl.searchParams.get("layer");
  const targetLayers = layerParam ? [layerParam] : Object.keys(LOGAN_LAYERS);

  const job = {
    name: "spatial-snapshot",
    lockKey: SPATIAL_SNAPSHOT_LOCK_KEY,
    run: () => snapshotLayers(targetLayers),
    outcome: spatialOutcome,
  };

  if (req.nextUrl.searchParams.get("wait") !== "1") {
    const start = await startDetachedJob(job);
    return NextResponse.json({ ...start, layers: targetLayers }, { status: 202 });
  }

  const outcome = await runJobInline(job);
  if (!outcome.started) {
    return NextResponse.json({ started: false, running: true, layers: targetLayers }, { status: 202 });
  }
  const summary = outcome.result;
  const { synced, errored } = countLayers(summary);
  return NextResponse.json({
    message: `Spatial snapshot complete: ${synced} layers synced, ${errored} errors`,
    results: summary,
    timestamp: new Date().toISOString(),
  }, { status: errored > 0 && synced === 0 ? 500 : 200 });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

/** Refresh every target layer; a layer whose refresh rejects becomes an error result rather than a throw. */
async function snapshotLayers(targetLayers: string[]): Promise<LayerRefreshResult[]> {
  const db = await getDb();
  const results = await Promise.allSettled(
    targetLayers.map((name) => refreshLayer(db, name))
  );
  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { layerName: "unknown", status: "error", featuresIngested: 0, errorDetail: String(r.reason) }
  );
}

function countLayers(results: LayerRefreshResult[]): { synced: number; errored: number } {
  return {
    synced: results.filter((r) => r.status === "synced").length,
    errored: results.filter((r) => r.status === "error").length,
  };
}

/**
 * `ok` false only when nothing synced and something errored (the synchronous
 * route's 500); `warning` whenever any layer errored. Upstream ArcGIS 5xx is
 * a warning to the workflow either way.
 */
function spatialOutcome(results: LayerRefreshResult[]): JobOutcome {
  const { synced, errored } = countLayers(results);
  return {
    ok: !(errored > 0 && synced === 0),
    summary: {
      layersSynced: synced,
      layersErrored: errored,
      warning: errored > 0,
      results,
    },
  };
}
