import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireApiKey, deductApiCredit } from "@/lib/auth";
import { formatLegislation, type LegislationDoc, type LegislationSection } from "@/lib/legislation-format";

// GET /api/axiom/legislation — List legislation documents with structured sections
//
// Query params:
//   jurisdiction  — Filter: "QLD", "CTH", "NSW", etc. Prefix matching (QLD matches QLD-*)
//   type          — Filter: "act", "regulation", "standard", "guidance"
//   q             — Keyword search across title + section content
//   act           — Filter by short title (e.g. "Criminal Code 1899")
//   format        — Response format: json (default), sections, text, citation, markdown
//   include       — "sections" to include section content (default), "metadata" for docs only
//   limit/offset  — Pagination
//
// Auth: Requires Axiom API key (pact_ax_*). Costs 1 credit per call.
export async function GET(req: NextRequest) {
  let apiKey;
  try {
    apiKey = await requireApiKey(req);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jurisdiction = searchParams.get("jurisdiction");
  const docType = searchParams.get("type");
  const search = searchParams.get("q");
  const act = searchParams.get("act");
  const format = searchParams.get("format") || "json";
  const include = searchParams.get("include") || "sections";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

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

  // Deduct 1 credit
  await deductApiCredit(apiKey.id, "legislation-list");

  // Format response
  const { body, contentType } = formatLegislation(docs, format);

  if (contentType === "text/plain" || contentType === "text/markdown") {
    return new NextResponse(body as string, {
      headers: {
        "Content-Type": `${contentType}; charset=utf-8`,
        "X-Credits-Remaining": String(apiKey.creditBalance - 1),
        "X-Total-Results": String(total),
      },
    });
  }

  return NextResponse.json({
    ...(body as Record<string, unknown>),
    total,
    limit,
    offset,
    creditsRemaining: apiKey.creditBalance - 1,
    _links: {
      self: `/api/axiom/legislation?limit=${limit}&offset=${offset}`,
      next: offset + limit < total ? `/api/axiom/legislation?limit=${limit}&offset=${offset + limit}` : null,
    },
  });
}
