import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireApiKey, deductApiCredit } from "@/lib/auth";
import { formatLegislation, type LegislationDoc } from "@/lib/legislation-format";

// GET /api/axiom/legislation/:id — Get a single legislation document with all sections
//
// The :id is the legislation_docs.id (e.g. "qld/act-1899-009")
//
// Query params:
//   format    — json (default), sections, text, citation, markdown
//   section   — Filter to a specific section (e.g. "s302")
//
// Auth: Requires Axiom API key. Costs 1 credit.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let apiKey;
  try {
    apiKey = await requireApiKey(req);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const { id } = await params;
  // URL-decode the id (it may contain slashes encoded as %2F)
  const docId = decodeURIComponent(id);

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") || "json";
  const sectionFilter = searchParams.get("section");

  const db = await getDb();

  // Fetch the doc
  const docResult = await db.execute({
    sql: "SELECT * FROM legislation_docs WHERE id = ?",
    args: [docId],
  });

  if (docResult.rows.length === 0) {
    return NextResponse.json({
      error: `Legislation document not found: ${docId}`,
      hint: "Use GET /api/axiom/legislation to list available documents",
    }, { status: 404 });
  }

  const row = docResult.rows[0];
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

  // Fetch sections
  let sectionWhere = "ls.doc_id = ?";
  const sectionArgs: unknown[] = [docId];

  if (sectionFilter) {
    sectionWhere += " AND ls.section_id = ?";
    sectionArgs.push(sectionFilter);
  }

  const sectionsResult = await db.execute({
    sql: `SELECT * FROM legislation_sections ls
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

  // Fetch related legislation (bidirectional)
  const relResult = await db.execute({
    sql: `SELECT lr.to_doc_id as doc_id, lr.relation_type, d2.title
      FROM legislation_relations lr
      JOIN legislation_docs d2 ON d2.id = lr.to_doc_id
      WHERE lr.from_doc_id = ?
      UNION
      SELECT lr.from_doc_id as doc_id, lr.relation_type, d2.title
      FROM legislation_relations lr
      JOIN legislation_docs d2 ON d2.id = lr.from_doc_id
      WHERE lr.to_doc_id = ?`,
    args: [docId, docId],
  });
  if (relResult.rows.length > 0) {
    doc.relatedLegislation = relResult.rows.map((r) => ({
      docId: r.doc_id as string,
      title: r.title as string,
      relationType: r.relation_type as string,
    }));
  }

  // Deduct 1 credit
  await deductApiCredit(apiKey.id, docId);

  // Format
  const { body, contentType } = formatLegislation([doc], format);

  if (contentType === "text/plain" || contentType === "text/markdown") {
    return new NextResponse(body as string, {
      headers: {
        "Content-Type": `${contentType}; charset=utf-8`,
        "X-Credits-Remaining": String(apiKey.creditBalance - 1),
      },
    });
  }

  // For single-doc JSON, unwrap the array
  const jsonBody = body as Record<string, unknown>;
  const unwrapped = jsonBody.legislation
    ? { legislation: (jsonBody.legislation as unknown[])[0] }
    : jsonBody.acts
      ? { act: (jsonBody.acts as unknown[])[0] }
      : jsonBody.citations
        ? { citation: (jsonBody.citations as unknown[])[0] }
        : jsonBody;

  return NextResponse.json({
    ...unwrapped,
    sectionCount: doc.sections.length,
    creditsRemaining: apiKey.creditBalance - 1,
  });
}
