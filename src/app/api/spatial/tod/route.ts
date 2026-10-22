export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeTodCatchment } from "@/lib/gtfs-sync";

/**
 * GET /api/spatial/tod?lat=-27.6521&lon=153.1234
 *
 * Returns TOD catchment membership for a parcel centroid against all
 * 7 SEQ key rail stations (Loganlea, Beenleigh, Trinder Park, Woodridge,
 * Bethania, Kuraby, Kingston).
 *
 * Each fact carries:
 *   - distanceMetres: Haversine from centroid to station platform stop
 *   - within400m / within800m: TOD policy catchment flags
 *   - derivedFrom[]: GTFS stop record + sync timestamp
 *   - limitations[]: epistemic caveats for QIC evidence use
 *
 * Requires GTFS sync to have run at least once (cron/gtfs-sync).
 */
export async function GET(req: NextRequest) {
  const latStr = req.nextUrl.searchParams.get("lat");
  const lonStr = req.nextUrl.searchParams.get("lon");

  const lat = latStr ? parseFloat(latStr) : NaN;
  const lon = lonStr ? parseFloat(lonStr) : NaN;

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      { error: "lat and lon are required — decimal degrees, e.g. ?lat=-27.6521&lon=153.1234" },
      { status: 400 },
    );
  }

  const db = await getDb();

  try {
    const facts = await computeTodCatchment(db, lat, lon);

    if (facts.length === 0) {
      return NextResponse.json(
        {
          error: "No GTFS station data found. Run /api/cron/gtfs-sync first.",
          facts: [],
        },
        { status: 503 },
      );
    }

    const nearest = facts.reduce((a, b) => (a.distanceMetres < b.distanceMetres ? a : b));

    return NextResponse.json({
      parcelLat: lat,
      parcelLon: lon,
      nearestStation: nearest.stationName,
      nearestDistanceMetres: nearest.distanceMetres,
      withinAnyTodCatchment: facts.some((f) => f.within800m),
      facts,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `TOD computation failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
