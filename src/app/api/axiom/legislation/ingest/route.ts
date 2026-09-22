export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordAudit, ipCountryFromHeaders } from "@/lib/audit";
import { requireAdmin } from "@/lib/admin-auth";
import { readBodyBounded, ADMIN_INGEST_MAX_BODY_BYTES } from "@/lib/read-body-bounded";
import {
  LegislationValidationError,
  normalizeLegislationRequest,
  replaceLegislationDocuments,
} from "@/lib/legislation-ingest";
import { log } from "@/lib/logger";

// POST /api/axiom/legislation/ingest — Bulk-ingest legislation documents with sections
//
// This is an admin endpoint for trusted, authoritative legislation ingestion.
// It bypasses the PACT consensus flow because legislation is authoritative by definition —
// it comes from parliament, not from debate.
//
// Body:
// {
//   "documents": [{
//     "id": "qld/act-1899-009",                              // Canonical doc ID
//     "jurisdiction": "QLD",
//     "type": "act",                         // act | regulation | standard | guidance | local_law | planning_scheme
//     "title": "Criminal Code Act 1899 (Qld)",
//     "shortTitle": "Criminal Code 1899",
//     "year": 1899,
//     "number": "Act No. 9 of 1899",
//     "inForceDate": "1899-01-01",
//     "lastAmendedDate": "2024-10-01",
//     "administeredBy": "Queensland Parliamentary Counsel",
//     "legislationUrl": "https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1899-009",
//     "sections": [{
//       "sectionId": "s 302",
//       "title": "Definition of murder",
//       "content": "...",
//       "depth": 2,
//       "parentSection": "Part 28 — Homicide",
//       "order": 1,
//       "status": "in_force",
//       "crossReferences": ["s 305", "s 300"],
//       "notes": null
//     }],
//     "relatedDocs": ["qld/reg-2017-165"]
//   }]
// }
//
// Auth: Requires admin secret in X-Admin-Key header (env: ADMIN_SECRET)
//
// Reviewed-document guard (tailor-group#35). A request that also asserts
// `X-Ingest-Source: reviewed` — only scripts/run_reviewed_legislation_ingest.py
// sends it, after binding the payload to an exact entry of
// scripts/reviewed_legislation_builders.json — writes as `reviewed`: every
// document it writes is stamped `legislation_docs.reviewed_at = NOW()` and
// `review_hash` (SHA-256 of the normalized document). Any other admin POST —
// the deploy-time seeds in .github/workflows/cd-kg.yml, including the
// live-scraped Planning Act 2016 from scripts/seed_seq_planning_regime.py —
// writes as `admin`: it never stamps, skips every document that carries the
// marker and lists them as `skipped` in its response. The scheduled CTH/QLD
// syncs and the PACT proposal finalizer are guarded the same way. A header
// value other than "reviewed" is a 400 before any database work.
const INGEST_SOURCE_HEADER = "x-ingest-source";

function ingestSourceFromHeader(
  value: string | null,
): { source: "reviewed" } | { source: "admin" } | null {
  if (value === null) return { source: "admin" };
  if (value.trim() === "reviewed") return { source: "reviewed" };
  return null;
}

export async function POST(req: NextRequest) {
  // Admin auth — shared timing-safe middleware (#2881)
  const denied = requireAdmin(req);
  if (denied) return denied;

  const source = ingestSourceFromHeader(req.headers.get(INGEST_SOURCE_HEADER));
  if (source === null) {
    return NextResponse.json(
      {
        error: "invalid_ingest_source",
        message: 'X-Ingest-Source, when present, must be "reviewed".',
      },
      { status: 400 },
    );
  }

  const bounded = await readBodyBounded(req, ADMIN_INGEST_MAX_BODY_BYTES);
  if (!bounded.ok) return bounded.response;

  let body: unknown;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  let documents: ReturnType<typeof normalizeLegislationRequest>;
  try {
    // The complete payload is validated before getDb() can initialize a pool
    // or schema, so malformed input cannot perform any database work.
    documents = normalizeLegislationRequest(body);
  } catch (error) {
    if (error instanceof LegislationValidationError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          issues: error.issues,
          truncated: error.truncated,
        },
        { status: 422 },
      );
    }
    throw error;
  }

  let db: Awaited<ReturnType<typeof getDb>>;
  let result: Awaited<ReturnType<typeof replaceLegislationDocuments>>;
  try {
    db = await getDb();
    result = await replaceLegislationDocuments(db, documents, source);
  } catch (error) {
    const databaseCode = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : null;
    if (databaseCode === "23503") {
      return NextResponse.json(
        {
          error: "invalid_reference",
          message: "Every relatedDocs entry must reference an existing document or one in this request.",
        },
        { status: 422 },
      );
    }

    log.error(
      { op: "axiom.legislation.ingest.failed", databaseCode },
      "legislation replacement transaction failed",
    );
    return NextResponse.json(
      { error: "ingest_failed", message: "Legislation replacement could not be committed." },
      { status: 500 },
    );
  }

  // Audit log — WS2 mutation backfill (one entry for the whole batch)
  await recordAudit({
    actorKey: null,
    actorLabel: "admin",
    op: "axiom.legislation.ingest",
    entityType: "legislation_batch",
    entityId: result.documents[0]?.id ?? null,
    before: null,
    after: {
      source: source.source,
      documentCount: result.ingested,
      totalSections: result.sectionsTotal,
      documentIds: result.documents.map((document) => document.id),
      skippedDocumentIds: result.skipped.map((document) => document.id),
    },
    requestId: req.headers.get("x-request-id"),
    ipCountry: ipCountryFromHeaders(req.headers),
  }, db);

  // The reviewed envelope stays exactly { ingested, documents, message }:
  // scripts/run_reviewed_legislation_ingest.py rejects any other key set, and
  // a reviewed write never skips. An admin write always reports `skipped`.
  const skippedSuffix = result.skipped.length > 0
    ? ` Skipped ${result.skipped.length} reviewed document(s).`
    : "";
  return NextResponse.json({
    ingested: result.ingested,
    documents: result.documents,
    ...(source.source === "admin" ? { skipped: result.skipped } : {}),
    message: `Successfully ingested ${result.ingested} legislation document(s) with ${result.sectionsTotal} total sections.${skippedSuffix}`,
  });
}
