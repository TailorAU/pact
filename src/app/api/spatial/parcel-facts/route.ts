export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { intersectParcelWithLayer, LOGAN_LAYERS } from "@/lib/spatial-snapshot";

/**
 * POST /api/spatial/parcel-facts
 * Given a GeoJSON Polygon for a parcel, returns derived spatial facts
 * for all (or specified) Logan layers with full traceability.
 *
 * Body: {
 *   geometry: GeoJSON Polygon | MultiPolygon,
 *   layers?: string[]  — subset of layer names (default: all synced layers)
 * }
 *
 * Response:
 *   { facts: DerivedFact[], retrievedAt, layersQueried }
 *
 * Traceability contract (Source spatial-computation contract):
 *   Every derived fact carries derivedFrom[], effectiveDate, retrievedAt, limitations[].
 *   Source DOES NOT invent geometry, valuations, or planning outcomes.
 */
export async function POST(req: NextRequest) {
  let body: { geometry?: unknown; layers?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const geom = body.geometry as { type: string; coordinates: number[][][] } | undefined;
  if (!geom || !["Polygon", "MultiPolygon"].includes(geom.type)) {
    return NextResponse.json(
      { error: "geometry must be a GeoJSON Polygon or MultiPolygon" },
      { status: 400 }
    );
  }

  // Normalise to Polygon for intersection; for MultiPolygon use first polygon.
  const polygon: { type: string; coordinates: number[][][] } =
    geom.type === "MultiPolygon"
      ? { type: "Polygon", coordinates: ((geom.coordinates as unknown) as number[][][][])[0] }
      : geom;

  const requestedLayers = body.layers ?? Object.keys(LOGAN_LAYERS);
  const db = await getDb();
  const retrievedAt = new Date().toISOString();

  const allFacts = await Promise.all(
    requestedLayers.map((name) => intersectParcelWithLayer(db, polygon, name))
  );

  return NextResponse.json({
    facts: allFacts.flat(),
    retrievedAt,
    layersQueried: requestedLayers,
  });
}
