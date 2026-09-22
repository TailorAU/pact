export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getLayerFreshness } from "@/lib/spatial-snapshot";

/**
 * GET /api/spatial/layers
 * Returns freshness status for all Logan ArcGIS snapshot layers.
 * Free, unauthenticated — layer metadata is not sensitive.
 */
export async function GET() {
  const db = await getDb();
  const layers = await getLayerFreshness(db);
  const now = new Date();

  const annotated = layers.map((row) => {
    const lastRefresh = row.last_refresh ? new Date(row.last_refresh as string) : null;
    const ageHours = lastRefresh ? (now.getTime() - lastRefresh.getTime()) / 3_600_000 : null;
    return {
      ...row,
      ageHours: ageHours !== null ? Math.round(ageHours * 10) / 10 : null,
      fresh: ageHours !== null && ageHours < 24,
    };
  });

  return NextResponse.json({ layers: annotated, checkedAt: now.toISOString() });
}
