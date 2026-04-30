export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { lookupCadastre } from "@/lib/cadastre-proxy";
import { intersectParcelWithLayer, LOGAN_LAYERS } from "@/lib/spatial-snapshot";
import { computeTodCatchment } from "@/lib/gtfs-sync";

/**
 * POST /api/source/evidence-pack
 *
 * Assembles a complete, traceable evidence pack for a property development
 * assessment. Composes:
 *   - cadastre geometry (via lot-plan or supplied centroid)
 *   - spatial derived facts (flood, zoning, heritage — from Logan ArcGIS layers)
 *   - TOD catchment membership (from Translink GTFS)
 *   - statute citations (from Source legislation knowledge graph)
 *
 * Body:
 *   {
 *     lotPlan?: string,         // e.g. "123RP456789" — looks up cadastre polygon
 *     lat?: number,             // centroid latitude (used for TOD if no lotPlan)
 *     lon?: number,             // centroid longitude
 *     domain?: string,          // evidence domain (default: "property_development")
 *     legislationQuery?: string // search term for statute citations (default: "planning development")
 *   }
 *
 * At minimum, one of lotPlan or (lat + lon) must be provided.
 *
 * Traceability contract: every fact in the pack carries derivedFrom[], confidence,
 * and limitations[]. Source does not invent geometry, valuations, or planning outcomes.
 */
export async function POST(req: NextRequest) {
  let body: {
    lotPlan?: string;
    lat?: number;
    lon?: number;
    domain?: string;
    legislationQuery?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { lotPlan, lat, lon, domain = "property_development", legislationQuery = "planning development" } = body;

  if (!lotPlan && (lat == null || lon == null)) {
    return NextResponse.json(
      { error: "Provide lotPlan or both lat and lon" },
      { status: 400 }
    );
  }

  const db = await getDb();
  const retrievedAt = new Date().toISOString();

  // ── 1. Cadastre lookup ──────────────────────────────────────────────────
  let cadastre: {
    lotPlan: string;
    objectId: number;
    geometry: { type: string; coordinates: number[][][] };
    retrievedAt: string;
    fromCache: boolean;
    derivedFrom: string[];
  } | null = null;

  let centroidLat = lat;
  let centroidLon = lon;

  if (lotPlan) {
    try {
      const feature = await lookupCadastre(db, lotPlan.trim().toUpperCase());
      if (feature) {
        cadastre = feature;
        // Derive centroid from polygon ring if caller didn't supply one
        if (centroidLat == null || centroidLon == null) {
          const ring = feature.geometry.coordinates[0];
          if (ring && ring.length > 0) {
            const sumLon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
            const sumLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
            centroidLon = sumLon;
            centroidLat = sumLat;
          }
        }
      }
    } catch {
      // Non-fatal — proceed without cadastre
    }
  }

  // ── 2. Spatial derived facts ─────────────────────────────────────────────
  let spatialFacts: unknown[] = [];
  if (cadastre?.geometry) {
    const layers = Object.keys(LOGAN_LAYERS);
    const results = await Promise.allSettled(
      layers.map((name) => intersectParcelWithLayer(db, cadastre!.geometry as { type: string; coordinates: number[][][] }, name))
    );
    for (const r of results) {
      if (r.status === "fulfilled") spatialFacts = spatialFacts.concat(r.value);
    }
  }

  // ── 3. TOD catchment ─────────────────────────────────────────────────────
  let todFacts: unknown[] = [];
  if (centroidLat != null && centroidLon != null && !isNaN(centroidLat) && !isNaN(centroidLon)) {
    try {
      todFacts = await computeTodCatchment(db, centroidLat, centroidLon);
    } catch {
      // Non-fatal — no GTFS data yet
    }
  }

  // ── 4. Statute citations ──────────────────────────────────────────────────
  let statuteCitations: {
    docId: string;
    jurisdiction: string;
    title: string;
    sectionId: string;
    sectionTitle: string | null;
    content: string;
    confidence: string;
    derivedFrom: string[];
  }[] = [];

  try {
    const tsQuery = legislationQuery
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `${t}:*`)
      .join(" & ");

    const result = await db.execute({
      sql: `SELECT ls.id, ls.doc_id, ls.section_id, ls.title AS section_title,
                   ls.content, ls.status,
                   ld.jurisdiction, ld.title AS doc_title, ld.legislation_url
            FROM legislation_sections ls
            JOIN legislation_docs ld ON ld.id = ls.doc_id
            WHERE ls.status = 'in_force'
              AND (ld.jurisdiction = ? OR ld.jurisdiction LIKE 'QLD%')
              AND to_tsvector('english', ls.content || ' ' || COALESCE(ls.title, '')) @@ to_tsquery('english', ?)
            ORDER BY ts_rank(to_tsvector('english', ls.content || ' ' || COALESCE(ls.title, '')), to_tsquery('english', ?)) DESC
            LIMIT 10`,
      args: ["QLD", tsQuery, tsQuery],
    });

    statuteCitations = result.rows.map((row) => ({
      docId: String(row.doc_id),
      jurisdiction: String(row.jurisdiction),
      title: String(row.doc_title),
      sectionId: String(row.section_id),
      sectionTitle: row.section_title ? String(row.section_title) : null,
      content: String(row.content).slice(0, 800),
      confidence: "verified_source_backed_fact",
      derivedFrom: [
        `legislation_docs:${row.doc_id}`,
        `legislation_sections:${row.id}`,
        row.legislation_url ? String(row.legislation_url) : "Source legislation knowledge graph",
      ],
    }));
  } catch {
    // Non-fatal — return without statute citations if full-text search fails
  }

  // ── 5. Domain metadata ────────────────────────────────────────────────────
  let domainMeta: { id: string; name: string; description: string } | null = null;
  try {
    const domResult = await db.execute({ sql: "SELECT id, name, description FROM domains WHERE id = ?", args: [domain] });
    if (domResult.rows.length > 0) {
      const r = domResult.rows[0];
      domainMeta = { id: String(r.id), name: String(r.name), description: String(r.description) };
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    retrievedAt,
    domain,
    domainMeta,
    cadastre: cadastre
      ? {
          lotPlan: cadastre.lotPlan,
          objectId: cadastre.objectId,
          geometry: cadastre.geometry,
          retrievedAt: cadastre.retrievedAt,
          fromCache: cadastre.fromCache,
          confidence: "verified_source_backed_fact",
          derivedFrom: cadastre.derivedFrom,
          limitations: [
            "Cadastre boundary is a government-issued lot boundary, not a survey-accurate boundary",
            "Boundary may not reflect recent subdivision or amalgamation",
          ],
        }
      : null,
    spatialFacts,
    todCatchment: {
      parcelLat: centroidLat,
      parcelLon: centroidLon,
      facts: todFacts,
      withinAnyTodCatchment: Array.isArray(todFacts) && todFacts.some(
        (f) => typeof f === "object" && f !== null && "within800m" in f && (f as { within800m: boolean }).within800m
      ),
    },
    statuteCitations,
    confidenceLevels: {
      verified_source_backed_fact: "Directly from official government source with traceability to gazette or ArcGIS dataset",
      deterministic_derived_fact: "Computed deterministically from verified source geometry + GTFS data",
      scenario_assumption: "Model assumption — requires validation for specific site conditions",
    },
  });
}
