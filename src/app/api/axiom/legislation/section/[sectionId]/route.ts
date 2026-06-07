export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CORS_HEADERS, corsPreflight, withCors } from "@/lib/cors";

export const OPTIONS = corsPreflight;

// GET /api/axiom/legislation/section/:sectionId — Global section-level retrieval
//
// Free, unauthenticated, cross-origin (CORS `*` via lib/cors.ts, #2738).
// Returns matching sections across all legislation documents.
// Agents can request exactly "s 19" of the WHS Act without downloading the whole act.
//
// Path param:
//   sectionId — Section identifier (e.g. "s 19", "s 302", "Schedule 2")
//
// Query params:
//   jurisdiction  — Filter: "QLD", "CTH", "NSW"
//   doc           — Filter by document title keyword (e.g. "Coal Mining", "Work Health")
//   format        — "json" (default) or "text" (plain text for LLM consumption)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  const decoded = decodeURIComponent(sectionId);
  const { searchParams } = new URL(req.url);
  const jurisdiction = searchParams.get("jurisdiction");
  const docFilter = searchParams.get("doc");
  const format = searchParams.get("format") || "json";

  const db = await getDb();

  const conditions = ["ls.section_id = ?"];
  const args: unknown[] = [decoded];

  if (jurisdiction) {
    conditions.push("d.jurisdiction = ?");
    args.push(jurisdiction.toUpperCase());
  }
  if (docFilter) {
    conditions.push("LOWER(d.title) LIKE LOWER(?)");
    args.push(`%${docFilter}%`);
  }

  const where = conditions.join(" AND ");

  const result = await db.execute({
    sql: `SELECT
      ls.id, ls.doc_id, ls.section_id, ls.title as section_title,
      ls.content, ls.depth, ls.parent_section, ls.sort_order, ls.status,
      ls.amended_by, ls.cross_references, ls.notes,
      d.title as doc_title, d.jurisdiction, d.doc_type, d.year,
      d.short_title, d.legislation_url, d.last_amended_date
    FROM legislation_sections ls
    JOIN legislation_docs d ON d.id = ls.doc_id
    WHERE ${where}
    ORDER BY d.jurisdiction, d.year DESC, ls.sort_order
    LIMIT 20`,
    args,
  });

  if (result.rows.length === 0) {
    // Try fuzzy match — strip "s " prefix and try just the number
    const stripped = decoded.replace(/^s\s*/i, "").trim();
    if (stripped !== decoded) {
      const fuzzyResult = await db.execute({
        sql: `SELECT
          ls.id, ls.doc_id, ls.section_id, ls.title as section_title,
          ls.content, ls.depth, ls.parent_section, ls.sort_order, ls.status,
          ls.amended_by, ls.cross_references, ls.notes,
          d.title as doc_title, d.jurisdiction, d.doc_type, d.year,
          d.short_title, d.legislation_url, d.last_amended_date
        FROM legislation_sections ls
        JOIN legislation_docs d ON d.id = ls.doc_id
        WHERE ls.section_id LIKE ?
          ${jurisdiction ? "AND d.jurisdiction = ?" : ""}
          ${docFilter ? "AND LOWER(d.title) LIKE LOWER(?)" : ""}
        ORDER BY d.jurisdiction, d.year DESC, ls.sort_order
        LIMIT 20`,
        args: [
          `%${stripped}%`,
          ...(jurisdiction ? [jurisdiction.toUpperCase()] : []),
          ...(docFilter ? [`%${docFilter}%`] : []),
        ],
      });

      if (fuzzyResult.rows.length > 0) {
        return formatResponse(fuzzyResult.rows, decoded, format);
      }
    }

    return withCors(NextResponse.json({
      sections: [],
      query: decoded,
      total: 0,
      hint: "No sections found. Try a different section ID or use /api/axiom/legislation/search?q=... for full-text search.",
    }, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=3600" },
    }));
  }

  return formatResponse(result.rows, decoded, format);
}

function formatResponse(rows: Record<string, unknown>[], query: string, format: string) {
  const sections = rows.map(row => ({
    sectionId: row.section_id,
    title: row.section_title,
    content: row.content,
    depth: row.depth,
    parentSection: row.parent_section,
    status: row.status,
    crossReferences: row.cross_references ? JSON.parse(row.cross_references as string) : [],
    notes: row.notes,
    document: {
      id: row.doc_id,
      title: row.doc_title,
      shortTitle: row.short_title,
      jurisdiction: row.jurisdiction,
      type: row.doc_type,
      year: row.year,
      legislationUrl: row.legislation_url,
      lastAmendedDate: row.last_amended_date,
    },
  }));

  if (format === "text") {
    const text = sections.map(s =>
      `--- ${s.document.title} ${s.sectionId}: ${s.title || ""} ---\n${s.content}\n`
    ).join("\n");

    return new Response(text, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return NextResponse.json({
    sections,
    query,
    total: sections.length,
    free: true,
  }, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
