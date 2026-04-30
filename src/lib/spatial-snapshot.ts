// #874: Logan ArcGIS daily spatial snapshot
//
// Fetches Logan City Council ArcGIS Feature layers, stores them with
// full traceability metadata, and computes deterministic derived facts
// (parcel × layer intersections) per the Source spatial-computation contract.
//
// Source MAY compute: parcel × flood intersection %, TLPI membership,
//   zoning category, 400m/800m TOD catchment (GTFS in N3).
// Source MUST NOT: invent geometry, valuations, or planning outcomes.

import type { DbClient } from "./db";

export interface ArcGisFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
    x?: number;
    y?: number;
    paths?: number[][][];
  };
}

export interface ArcGisQueryResponse {
  features: ArcGisFeature[];
  exceededTransferLimit?: boolean;
  geometryType?: string;
}

export interface LayerRefreshResult {
  layerName: string;
  status: "synced" | "error";
  featuresIngested: number;
  errorDetail?: string;
}

export interface DerivedFact {
  factType: string;
  factValue: Record<string, unknown>;
  derivedFrom: string[];
  effectiveDate: string | null;
  retrievedAt: string;
  limitations: string[];
}

// Logan ArcGIS layer registry.
// URLs are Logan City Council open data ArcGIS REST services.
// Verified against https://openlogis.opendata.arcgis.com — public, no auth needed.
// If a URL returns 4xx the layer is marked status=error and will retry next day.
export const LOGAN_LAYERS: Record<string, { url: string; spatialBasis: string; limitations: string[] }> = {
  "logan-zoning-v9.2": {
    url: "https://services6.arcgis.com/xnqkR93CelVv5qEZ/arcgis/rest/services/Planning_Zones/FeatureServer/0/query",
    spatialBasis: "Logan City Council Planning Scheme zones v9.2 — ArcGIS FeatureServer (openlogis.opendata.arcgis.com)",
    limitations: [
      "Zoning boundaries reflect Logan Planning Scheme v9.2 at last snapshot refresh.",
      "Does not incorporate active TLPI amendments — check TLPI overlay separately.",
      "Effective date is the snapshot retrieval date, not the gazette date of any amendment.",
    ],
  },
  "logan-tlpi": {
    url: "https://services6.arcgis.com/xnqkR93CelVv5qEZ/arcgis/rest/services/TLPI_Overlays/FeatureServer/0/query",
    spatialBasis: "Logan City Council Temporary Local Planning Instrument overlays — ArcGIS FeatureServer",
    limitations: [
      "TLPI overlays are time-limited amendments and may have lapsed or been superseded.",
      "Consult Logan City Council or current gazette for operative TLPI status.",
    ],
  },
  "logan-flood-risk-areas": {
    url: "https://services6.arcgis.com/xnqkR93CelVv5qEZ/arcgis/rest/services/Flood_Risk_Areas/FeatureServer/0/query",
    spatialBasis: "Logan City Council flood risk area mapping — ArcGIS FeatureServer",
    limitations: [
      "Flood risk areas are indicative based on council flood studies.",
      "Does not substitute for a site-specific flood level assessment.",
      "DNRME/Queensland Government flood studies may differ from council mapping.",
    ],
  },
  "logan-2022-flood": {
    url: "https://services6.arcgis.com/xnqkR93CelVv5qEZ/arcgis/rest/services/2022_Flood_Event/FeatureServer/0/query",
    spatialBasis: "Logan City Council 2022 February flood event extent — ArcGIS FeatureServer",
    limitations: [
      "Represents the observed 2022 flood extent, not a probabilistic flood model.",
      "Actual 2022 flood levels at a specific parcel require council flood assessment.",
    ],
  },
  "logan-2pc-aep": {
    url: "https://services6.arcgis.com/xnqkR93CelVv5qEZ/arcgis/rest/services/2pc_AEP_Flood/FeatureServer/0/query",
    spatialBasis: "Logan City Council 2% AEP (1-in-50 year) flood extent — ArcGIS FeatureServer",
    limitations: [
      "2% AEP (1-in-50 year) modelled flood extent — probabilistic, not a guarantee.",
      "Climate change may increase flood frequency beyond modelled extent.",
      "A site-specific hydraulic assessment is required for development decisions.",
    ],
  },
};

function toGeoJsonGeometry(arcGisGeometry: ArcGisFeature["geometry"]): Record<string, unknown> | null {
  if (!arcGisGeometry) return null;
  if (arcGisGeometry.rings) {
    return { type: "Polygon", coordinates: arcGisGeometry.rings };
  }
  if (arcGisGeometry.x !== undefined && arcGisGeometry.y !== undefined) {
    return { type: "Point", coordinates: [arcGisGeometry.x, arcGisGeometry.y] };
  }
  if (arcGisGeometry.paths) {
    return { type: "MultiLineString", coordinates: arcGisGeometry.paths };
  }
  return null;
}

// Fetch all features from an ArcGIS FeatureServer with pagination.
async function fetchArcGisFeatures(url: string): Promise<ArcGisFeature[]> {
  const features: ArcGisFeature[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      returnGeometry: "true",
      f: "json",
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });

    const resp = await fetch(`${url}?${params}`, {
      headers: { "User-Agent": "Source-TailorAU/1.0 (source.tailor.au; spatial-snapshot)" },
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      throw new Error(`ArcGIS HTTP ${resp.status} from ${url}`);
    }

    const data = (await resp.json()) as ArcGisQueryResponse;

    if (data.features) {
      features.push(...data.features);
    }

    if (!data.exceededTransferLimit || data.features.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return features;
}

export async function refreshLayer(
  db: DbClient,
  layerName: string
): Promise<LayerRefreshResult> {
  const layerMeta = LOGAN_LAYERS[layerName];
  if (!layerMeta) {
    return { layerName, status: "error", featuresIngested: 0, errorDetail: `Unknown layer: ${layerName}` };
  }

  // Upsert layer row, mark syncing
  await db.execute({
    sql: `INSERT INTO spatial_snapshot_layer (id, layer_name, layer_url, status, updated_at)
          VALUES (gen_random_uuid(), ?, ?, 'syncing', now())
          ON CONFLICT (layer_name) DO UPDATE SET status = 'syncing', layer_url = excluded.layer_url, updated_at = now()`,
    args: [layerName, layerMeta.url],
  });

  const layerRow = await db.execute({
    sql: `SELECT id FROM spatial_snapshot_layer WHERE layer_name = ?`,
    args: [layerName],
  });
  const layerId = layerRow.rows[0]?.id as string;

  const retrievedAt = new Date().toISOString();

  try {
    const features = await fetchArcGisFeatures(layerMeta.url);

    let ingested = 0;
    for (const f of features) {
      const geom = toGeoJsonGeometry(f.geometry);
      if (!geom) continue;

      const featureId = String(f.attributes.OBJECTID ?? f.attributes.objectid ?? f.attributes.FID ?? ingested);

      await db.execute({
        sql: `INSERT INTO spatial_feature
                (id, layer_id, feature_id_external, geometry, attributes, spatial_basis, retrieved_at, limitations)
              VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (layer_id, feature_id_external) DO UPDATE SET
                geometry = excluded.geometry,
                attributes = excluded.attributes,
                retrieved_at = excluded.retrieved_at`,
        args: [
          layerId,
          featureId,
          JSON.stringify(geom),
          JSON.stringify(f.attributes),
          layerMeta.spatialBasis,
          retrievedAt,
          JSON.stringify(layerMeta.limitations),
        ],
      });
      ingested++;
    }

    await db.execute({
      sql: `UPDATE spatial_snapshot_layer
            SET status = 'synced', last_refresh = ?, feature_count = ?, error_detail = null, updated_at = now()
            WHERE layer_name = ?`,
      args: [retrievedAt, ingested, layerName],
    });

    return { layerName, status: "synced", featuresIngested: ingested };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await db.execute({
      sql: `UPDATE spatial_snapshot_layer
            SET status = 'error', error_detail = ?, updated_at = now()
            WHERE layer_name = ?`,
      args: [detail, layerName],
    });
    return { layerName, status: "error", featuresIngested: 0, errorDetail: detail };
  }
}

// Point-in-polygon test using ray-casting algorithm on GeoJSON Polygon rings.
// Returns true if point [lng, lat] is inside the polygon.
function pointInPolygon(point: [number, number], ring: number[][]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function bboxOverlap(
  bbox1: [number, number, number, number],
  bbox2: [number, number, number, number]
): boolean {
  return bbox1[0] <= bbox2[2] && bbox1[2] >= bbox2[0] && bbox1[1] <= bbox2[3] && bbox1[3] >= bbox2[1];
}

function parcelBbox(parcelGeometry: { type: string; coordinates: number[][][] }): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of parcelGeometry.coordinates) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function featureBbox(geom: { type: string; coordinates: number[][][] }): [number, number, number, number] {
  return parcelBbox(geom);
}

// Compute approximate overlap fraction between two polygons using centroid test.
// For v1: uses ring containment of parcel centroid as a proxy for intersection.
// A precise area-based intersection requires a full polygon clipping lib.
function approximateOverlapFraction(
  parcelRings: number[][][],
  featureRings: number[][][]
): number {
  if (parcelRings.length === 0 || featureRings.length === 0) return 0;
  const outerRing = parcelRings[0];
  const cx = outerRing.reduce((s, p) => s + p[0], 0) / outerRing.length;
  const cy = outerRing.reduce((s, p) => s + p[1], 0) / outerRing.length;
  return pointInPolygon([cx, cy], featureRings[0]) ? 1 : 0;
}

export interface ParcelIntersectionResult {
  layerName: string;
  intersectingFeatures: Array<{
    featureId: string;
    attributes: Record<string, unknown>;
    overlapFraction: number;
    derivedFrom: string[];
  }>;
}

export async function intersectParcelWithLayer(
  db: DbClient,
  parcelGeometry: { type: string; coordinates: number[][][] },
  layerName: string
): Promise<DerivedFact[]> {
  const layerMeta = LOGAN_LAYERS[layerName];
  const retrievedAt = new Date().toISOString();

  const layerRow = await db.execute({
    sql: `SELECT id, last_refresh, feature_count FROM spatial_snapshot_layer WHERE layer_name = ? AND status = 'synced'`,
    args: [layerName],
  });

  if (!layerRow.rows.length) {
    return [{
      factType: `${layerName}_unavailable`,
      factValue: { reason: "Layer not yet synced — no data available." },
      derivedFrom: [],
      effectiveDate: null,
      retrievedAt,
      limitations: [
        `${layerName} layer has not completed its first sync. No intersection possible.`,
        ...(layerMeta?.limitations ?? []),
      ],
    }];
  }

  const layerId = layerRow.rows[0].id as string;
  const lastRefresh = layerRow.rows[0].last_refresh as string;
  const pbox = parcelBbox(parcelGeometry);

  // Fetch candidate features from DB (all features of this layer — for production
  // this should use a spatial index or GiST-indexed geometry column).
  const result = await db.execute({
    sql: `SELECT feature_id_external, geometry, attributes, spatial_basis, retrieved_at, limitations
          FROM spatial_feature WHERE layer_id = ?`,
    args: [layerId],
  });

  const intersecting: DerivedFact[] = [];

  for (const row of result.rows) {
    const geom = row.geometry as { type: string; coordinates: number[][][] };
    if (!geom || geom.type !== "Polygon") continue;

    const fbox = featureBbox(geom);
    if (!bboxOverlap(pbox, fbox)) continue;

    const overlapFraction = approximateOverlapFraction(parcelGeometry.coordinates, geom.coordinates);
    if (overlapFraction === 0) continue;

    const attrs = row.attributes as Record<string, unknown>;
    const featureId = row.feature_id_external as string;

    const factValue: Record<string, unknown> = {
      layerName,
      overlapFraction,
      featureAttributes: attrs,
      lastLayerRefresh: lastRefresh,
    };

    intersecting.push({
      factType: `${layerName}_intersection`,
      factValue,
      derivedFrom: [`spatial_feature:${layerId}:${featureId}`],
      effectiveDate: lastRefresh ? lastRefresh.split("T")[0] : null,
      retrievedAt,
      limitations: (row.limitations as string[]) ?? layerMeta?.limitations ?? [],
    });
  }

  if (intersecting.length === 0) {
    intersecting.push({
      factType: `${layerName}_no_intersection`,
      factValue: { layerName, lastLayerRefresh: lastRefresh },
      derivedFrom: [`spatial_snapshot_layer:${layerId}`],
      effectiveDate: lastRefresh ? lastRefresh.split("T")[0] : null,
      retrievedAt,
      limitations: layerMeta?.limitations ?? [],
    });
  }

  return intersecting;
}

export async function getLayerFreshness(db: DbClient) {
  const result = await db.execute(
    `SELECT layer_name, layer_url, status, last_refresh, feature_count, error_detail, updated_at
     FROM spatial_snapshot_layer ORDER BY layer_name`
  );
  return result.rows;
}
