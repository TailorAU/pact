export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { lookupCadastre } from "@/lib/cadastre-proxy";

/**
 * GET /api/spatial/cadastre?lot_plan=123RP456789
 *
 * Returns GeoJSON polygon for a QLD lot-plan reference.
 * ETag-cached in Neon Postgres with 7-day TTL; revalidates against
 * the QLD Spatial Cadastre ArcGIS REST on cache miss or expiry.
 *
 * Source: QLD Spatial Information Services — CC BY 4.0
 */
export async function GET(req: NextRequest) {
  const lotPlan = req.nextUrl.searchParams.get("lot_plan");
  if (!lotPlan || !/^\d+[A-Z]+\d+$/i.test(lotPlan.trim())) {
    return NextResponse.json(
      { error: "lot_plan is required and must match the format e.g. 123RP456789" },
      { status: 400 },
    );
  }

  const db = await getDb();

  try {
    const feature = await lookupCadastre(db, lotPlan.trim().toUpperCase());
    if (!feature) {
      return NextResponse.json({ error: `Lot-plan not found: ${lotPlan}` }, { status: 404 });
    }

    return NextResponse.json({
      type: "Feature",
      properties: {
        lot_plan: feature.lotPlan,
        object_id: feature.objectId,
        retrieved_at: feature.retrievedAt,
        from_cache: feature.fromCache,
        derived_from: feature.derivedFrom,
      },
      geometry: feature.geometry,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Cadastre lookup failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
