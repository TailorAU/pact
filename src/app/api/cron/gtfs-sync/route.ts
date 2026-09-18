export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runGtfsSync } from "@/lib/gtfs-sync";
import { safeSecretEqual } from "@/lib/secret-compare";

/**
 * Cron job: syncs Translink SEQ GTFS static feed into transit_* tables.
 * Schedule: weekly (Sundays 02:00 AEST) via GitHub Actions or on-demand.
 * Protected by CRON_SECRET bearer token.
 *
 * Optional query param: ?force=true — skips the 6-hour recency guard
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

  const db = await getDb();

  try {
    const result = await runGtfsSync(db);

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
