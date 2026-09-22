import type { DbClient } from "./db";

// QLD Spatial Cadastre — ArcGIS MapServer layer 0 (lot-plan polygon query)
// CC BY 4.0 — Queensland Government Open Data
const ARCGIS_BASE =
  process.env.QLD_CADASTRE_URL ||
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/QSC_Whse/QSC_Whse_Qld_Cadastral_Data/MapServer/0/query";

// 7-day cache TTL for cadastre polygons (lot boundaries rarely change)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CadastreFeature {
  lotPlan: string;
  objectId: number;
  geometry: GeoJsonPolygon;
  retrievedAt: string;
  fromCache: boolean;
  derivedFrom: string[];
}

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

// Parse "123RP456789" into lot + plan components for the ArcGIS where clause
function parseLotPlan(lotPlan: string): { lot: string; plan: string } | null {
  const m = lotPlan.trim().match(/^(\d+)([A-Z]+\d+)$/i);
  if (!m) return null;
  return { lot: m[1], plan: m[2].toUpperCase() };
}

// ArcGIS Esri polygon → GeoJSON Polygon
function esriToGeoJson(esriGeometry: { rings: number[][][] }): GeoJsonPolygon {
  return { type: "Polygon", coordinates: esriGeometry.rings };
}

async function fetchFromArcGis(
  lotPlan: string,
  ifNoneMatch?: string,
): Promise<{ status: 200; feature: CadastreFeature } | { status: 304 } | { status: 404 }> {
  const parsed = parseLotPlan(lotPlan);
  if (!parsed) throw new Error(`Cannot parse lot_plan: ${lotPlan}`);

  const where = `LOT='${parsed.lot}' AND PLAN='${parsed.plan}'`;
  const params = new URLSearchParams({
    where,
    outFields: "OBJECTID,LOT,PLAN",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });

  const headers: Record<string, string> = {};
  if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;

  const res = await fetch(`${ARCGIS_BASE}?${params}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 304) return { status: 304 };

  if (!res.ok) throw new Error(`ArcGIS request failed: ${res.status}`);

  const etag = res.headers.get("etag") ?? undefined;
  const data = (await res.json()) as {
    features?: Array<{ attributes: { OBJECTID: number }; geometry: { rings: number[][][] } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(`ArcGIS error: ${data.error.message}`);
  if (!data.features || data.features.length === 0) return { status: 404 };

  const feat = data.features[0];
  const retrievedAt = new Date().toISOString();

  const feature: CadastreFeature = {
    lotPlan,
    objectId: feat.attributes.OBJECTID,
    geometry: esriToGeoJson(feat.geometry),
    retrievedAt,
    fromCache: false,
    derivedFrom: [
      `QLD_Spatial_Cadastre:objectid=${feat.attributes.OBJECTID}`,
      etag ? `etag:${etag}` : "etag:none",
    ],
  };

  return { status: 200, feature };
}

export async function lookupCadastre(db: DbClient, lotPlan: string): Promise<CadastreFeature | null> {
  const now = new Date();

  // Check cache first
  const cached = await db.execute({
    sql: "SELECT geometry_json, object_id, etag, retrieved_at, expires_at FROM cadastre_cache WHERE lot_plan = $1",
    args: [lotPlan],
  });

  if (cached.rows.length > 0) {
    const row = cached.rows[0];
    const expiresAt = new Date(row.expires_at as string);

    if (expiresAt > now) {
      // Hot cache hit
      return {
        lotPlan,
        objectId: row.object_id as number,
        geometry: JSON.parse(row.geometry_json as string) as GeoJsonPolygon,
        retrievedAt: row.retrieved_at as string,
        fromCache: true,
        derivedFrom: [
          `cadastre_cache:lot_plan=${lotPlan}`,
          `QLD_Spatial_Cadastre:objectid=${row.object_id}`,
        ],
      };
    }

    // Stale — revalidate with ETag
    const etag = row.etag as string | null;
    try {
      const result = await fetchFromArcGis(lotPlan, etag ?? undefined);
      if (result.status === 304) {
        // Server says not modified — refresh expiry, return cached geometry
        const newExpiry = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
        await db.execute({
          sql: "UPDATE cadastre_cache SET expires_at = $1 WHERE lot_plan = $2",
          args: [newExpiry, lotPlan],
        });
        return {
          lotPlan,
          objectId: row.object_id as number,
          geometry: JSON.parse(row.geometry_json as string) as GeoJsonPolygon,
          retrievedAt: row.retrieved_at as string,
          fromCache: true,
          derivedFrom: [
            `cadastre_cache:lot_plan=${lotPlan}`,
            `QLD_Spatial_Cadastre:objectid=${row.object_id}`,
            "etag:304-not-modified",
          ],
        };
      }
      if (result.status === 404) return null;
      // 200 — update cache
      await upsertCache(db, lotPlan, result.feature, etag ?? undefined);
      return result.feature;
    } catch {
      // Upstream error — return stale rather than failing
      return {
        lotPlan,
        objectId: row.object_id as number,
        geometry: JSON.parse(row.geometry_json as string) as GeoJsonPolygon,
        retrievedAt: row.retrieved_at as string,
        fromCache: true,
        derivedFrom: [`cadastre_cache:lot_plan=${lotPlan}`, "stale:upstream-error"],
      };
    }
  }

  // Cold miss — full fetch
  const result = await fetchFromArcGis(lotPlan);
  if (result.status === 304 || result.status === 404) return null;
  await upsertCache(db, lotPlan, result.feature, undefined);
  return result.feature;
}

async function upsertCache(
  db: DbClient,
  lotPlan: string,
  feature: CadastreFeature,
  _prevEtag: string | undefined,
): Promise<void> {
  const expires = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  await db.execute({
    sql: `INSERT INTO cadastre_cache (lot_plan, geometry_json, object_id, etag, retrieved_at, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (lot_plan) DO UPDATE SET
            geometry_json = excluded.geometry_json,
            object_id = excluded.object_id,
            etag = excluded.etag,
            retrieved_at = excluded.retrieved_at,
            expires_at = excluded.expires_at`,
    args: [
      lotPlan,
      JSON.stringify(feature.geometry),
      feature.objectId,
      feature.derivedFrom.find((d) => d.startsWith("etag:"))?.slice(5) ?? null,
      feature.retrievedAt,
      expires,
    ],
  });
}
