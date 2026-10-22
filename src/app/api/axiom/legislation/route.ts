export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb, type DbResult } from "@/lib/db";
import { formatLegislation, type LegislationDoc } from "@/lib/legislation-format";
import { buildCanonicalLegislationState } from "@/lib/legislation-canonical";
import { corsPreflight, withCors } from "@/lib/cors";
import { log } from "@/lib/logger";

export const OPTIONS = corsPreflight;

// GET /api/axiom/legislation — List legislation documents with structured sections
//
// Free, unauthenticated, cross-origin (CORS `*` via lib/cors.ts, #2738).
// Australian legislation is a public good.
//
// Query params:
//   id            — Exact canonical document ID (requires format=canonical)
//   jurisdiction  — Filter: "QLD", "CTH", "NSW", etc. Prefix matching (QLD matches QLD-*)
//   type          — Filter: "act", "regulation", "standard", "guidance"
//   q             — Keyword search across title + section content
//   act           — Filter by short title (e.g. "Criminal Code 1899")
//   format        — Response format: json (default), sections, text, citation, markdown, canonical
//   include       — "sections" to include section content (default), "metadata" for docs only
//   limit/offset  — Pagination
const CANONICAL_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function canonicalJson(body: unknown, status = 200): NextResponse {
  return withCors(NextResponse.json(body, {
    status,
    headers: CANONICAL_NO_STORE_HEADERS,
  }));
}

async function getCanonicalLegislation(searchParams: URLSearchParams): Promise<NextResponse> {
  const ids = searchParams.getAll("id");
  const docId = ids[0]?.trim();
  if (ids.length !== 1 || !docId) {
    return canonicalJson({
      error: "canonical_id_required",
      hint: "Use exactly one non-empty id query parameter with format=canonical",
    }, 400);
  }
  if (docId.length > 256 || /[\u0000-\u001f\u007f]/.test(docId)) {
    return canonicalJson({
      error: "canonical_id_invalid",
      hint: "Canonical IDs must be at most 256 characters and contain no control characters",
    }, 400);
  }

  const incompatibleParams = [
    "jurisdiction",
    "type",
    "q",
    "act",
    "limit",
    "offset",
    "section",
    "since",
  ].filter((name) => searchParams.has(name));
  const includes = searchParams.getAll("include");
  if (includes.some((include) => include !== "sections")) {
    incompatibleParams.push("include");
  }
  if (incompatibleParams.length > 0) {
    return canonicalJson({
      error: "canonical_filters_not_supported",
      incompatibleParams,
      hint: "Canonical reads always return the complete exact-ID replacement state",
    }, 400);
  }

  let result: DbResult;
  try {
    const db = await getDb();
    // One PostgreSQL statement means one MVCC snapshot: metadata, sections,
    // and the replacement-owned outbound relation set cannot come from
    // different committed replacements.
    result = await db.execute({
      sql: `SELECT
        d.id,
        d.jurisdiction,
        d.doc_type,
        d.title,
        d.short_title,
        d.year,
        d.number,
        d.in_force_date,
        d.last_amended_date,
        d.repealed_date,
        d.administered_by,
        d.legislation_url,
        COALESCE(section_state.sections, '[]'::jsonb) AS sections,
        COALESCE(relation_state.related_docs, '[]'::jsonb) AS related_docs
      FROM legislation_docs d
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'section_id', ls.section_id,
            'title', ls.title,
            'content', ls.content,
            'depth', ls.depth,
            'parent_section', ls.parent_section,
            'order', ls.sort_order,
            'status', ls.status,
            'amended_by', ls.amended_by,
            'cross_references', ls.cross_references,
            'notes', ls.notes
          ) ORDER BY ls.sort_order ASC, ls.section_id ASC
        ) AS sections
        FROM legislation_sections ls
        WHERE ls.doc_id = d.id
      ) AS section_state ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(lr.to_doc_id ORDER BY lr.to_doc_id ASC) AS related_docs
        FROM legislation_relations lr
        WHERE lr.from_doc_id = d.id
          AND lr.relation_type = 'subordinate'
      ) AS relation_state ON TRUE
      WHERE d.id = ?
        LIMIT 1`,
      args: [docId],
    });
  } catch (err) {
    const databaseCode = typeof err === "object" && err !== null && "code" in err
      ? String(err.code)
      : null;
    log.error({
      op: "axiom.legislation.canonical.query_failed",
      docId,
      databaseCode,
    }, "canonical legislation state query failed");
    return canonicalJson({
      error: "canonical_state_unavailable",
      id: docId,
    }, 500);
  }

  if (result.rows.length === 0) {
    return canonicalJson({
      error: "legislation_not_found",
      id: docId,
    }, 404);
  }

  try {
    return canonicalJson(buildCanonicalLegislationState(result.rows[0]));
  } catch (err) {
    log.error({
      op: "axiom.legislation.canonical.invalid_state",
      docId,
      err,
    }, "persisted legislation state cannot be canonicalized");
    return canonicalJson({
      error: "canonical_state_invalid",
      id: docId,
    }, 500);
  }
}

export async function GET(req: NextRequest) {

  const { searchParams } = new URL(req.url);
  const jurisdiction = searchParams.get("jurisdiction");
  const docType = searchParams.get("type");
  const search = searchParams.get("q");
  const act = searchParams.get("act");
  const format = searchParams.get("format") || "json";
  const include = searchParams.get("include") || "sections";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  if (format === "canonical") {
    return getCanonicalLegislation(searchParams);
  }

  const db = await getDb();

  // Build WHERE clause for docs
  let where = "1=1";
  const args: unknown[] = [];

  if (jurisdiction) {
    // Prefix matching: "AU" matches "AU-QLD", "AU-NSW" etc.
    where += " AND (d.jurisdiction = ? OR d.jurisdiction LIKE ? || '-%')";
    args.push(jurisdiction.toUpperCase(), jurisdiction.toUpperCase());
  }
  if (docType) {
    where += " AND d.doc_type = ?";
    args.push(docType.toLowerCase());
  }
  if (act) {
    where += " AND (d.short_title LIKE ? OR d.title LIKE ?)";
    args.push(`%${act}%`, `%${act}%`);
  }
  if (search) {
    // Search across doc title and section content
    where += ` AND (d.title LIKE ? OR d.id IN (
      SELECT DISTINCT ls.doc_id FROM legislation_sections ls
      WHERE ls.content LIKE ? OR ls.title LIKE ?
    ))`;
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // Count total
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM legislation_docs d WHERE ${where}`,
    args,
  });
  const total = (countResult.rows[0]?.total as number) || 0;

  // Fetch docs
  const docsResult = await db.execute({
    sql: `SELECT d.* FROM legislation_docs d WHERE ${where}
      ORDER BY d.jurisdiction ASC, d.year ASC, d.title ASC
      LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  // Build doc objects
  const docs: LegislationDoc[] = [];
  for (const row of docsResult.rows) {
    const doc: LegislationDoc = {
      id: row.id as string,
      jurisdiction: row.jurisdiction as string,
      type: row.doc_type as string,
      title: row.title as string,
      shortTitle: (row.short_title as string) || null,
      year: (row.year as number) || null,
      number: (row.number as string) || null,
      inForceDate: (row.in_force_date as string) || null,
      lastAmendedDate: (row.last_amended_date as string) || null,
      repealedDate: (row.repealed_date as string) || null,
      administeredBy: (row.administered_by as string) || null,
      legislationUrl: (row.legislation_url as string) || null,
    };

    // Fetch sections if requested
    if (include === "sections") {
      let sectionWhere = "ls.doc_id = ?";
      const sectionArgs: unknown[] = [doc.id];

      // If searching, filter sections too
      if (search) {
        sectionWhere += " AND (ls.content LIKE ? OR ls.title LIKE ?)";
        sectionArgs.push(`%${search}%`, `%${search}%`);
      }

      const sectionsResult = await db.execute({
        sql: `SELECT ls.* FROM legislation_sections ls
          WHERE ${sectionWhere}
          ORDER BY ls.sort_order ASC`,
        args: sectionArgs,
      });

      doc.sections = sectionsResult.rows.map((s) => ({
        sectionId: s.section_id as string,
        title: (s.title as string) || null,
        content: s.content as string,
        depth: (s.depth as number) || 2,
        parentId: (s.parent_section as string) || null,
        order: (s.sort_order as number) || 0,
        status: (s.status as string) || "in_force",
        amendedBy: (s.amended_by as string) || null,
        crossReferences: s.cross_references ? JSON.parse(s.cross_references as string) : [],
        notes: (s.notes as string) || null,
      }));
    }

    // Fetch related legislation
    const relResult = await db.execute({
      sql: `SELECT lr.to_doc_id, lr.relation_type, d2.title
        FROM legislation_relations lr
        JOIN legislation_docs d2 ON d2.id = lr.to_doc_id
        WHERE lr.from_doc_id = ?`,
      args: [doc.id],
    });
    if (relResult.rows.length > 0) {
      doc.relatedLegislation = relResult.rows.map((r) => ({
        docId: r.to_doc_id as string,
        title: r.title as string,
        relationType: r.relation_type as string,
      }));
    }

    docs.push(doc);
  }

  // Format response
  const { body, contentType } = formatLegislation(docs, format);

  if (contentType === "text/plain" || contentType === "text/markdown") {
    return withCors(new NextResponse(body as string, {
      headers: {
        "Content-Type": `${contentType}; charset=utf-8`,
        "Cache-Control": "public, max-age=86400",
        "X-Total-Results": String(total),
      },
    }));
  }

  return withCors(NextResponse.json({
    ...(body as Record<string, unknown>),
    total,
    limit,
    offset,
    free: true,
    _links: {
      self: `/api/axiom/legislation?limit=${limit}&offset=${offset}`,
      next: offset + limit < total ? `/api/axiom/legislation?limit=${limit}&offset=${offset + limit}` : null,
    },
  }));
}
