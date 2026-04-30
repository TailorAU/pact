export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { refreshLayer, LOGAN_LAYERS } from "@/lib/spatial-snapshot";

/**
 * Cron job: daily Logan ArcGIS spatial snapshot (Refs #874, parent #852).
 * Fetches each Logan layer and stores features with full traceability metadata.
 * Triggered daily at 2am UTC by GitHub Actions cron-source.yml.
 * Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const layerParam = req.nextUrl.searchParams.get("layer");
  const targetLayers = layerParam ? [layerParam] : Object.keys(LOGAN_LAYERS);

  const db = await getDb();
  const results = await Promise.allSettled(
    targetLayers.map((name) => refreshLayer(db, name))
  );

  const summary = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { layerName: "unknown", status: "error", featuresIngested: 0, errorDetail: String(r.reason) }
  );

  const synced = summary.filter((r) => r.status === "synced").length;
  const errored = summary.filter((r) => r.status === "error").length;

  return NextResponse.json({
    message: `Spatial snapshot complete: ${synced} layers synced, ${errored} errors`,
    results: summary,
    timestamp: new Date().toISOString(),
  }, { status: errored > 0 && synced === 0 ? 500 : 200 });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
