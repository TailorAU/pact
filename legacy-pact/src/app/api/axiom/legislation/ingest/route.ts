import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

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
//     "type": "act",                                          // act | regulation | standard | guidance
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
export async function POST(req: NextRequest) {
  // Admin auth
  const adminKey = req.headers.get("x-admin-key");
  const expectedKey = process.env.ADMIN_SECRET || process.env.PACT_ADMIN_SECRET;
  if (!expectedKey || adminKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized. Requires X-Admin-Key header." }, { status: 401 });
  }

  const body = await req.json();
  const documents = body.documents;
  if (!Array.isArray(documents) || documents.length === 0) {
    return NextResponse.json({ error: "Body must contain a non-empty 'documents' array." }, { status: 400 });
  }

  const db = await getDb();
  const results: { id: string; title: string; sectionsInserted: number }[] = [];

  for (const doc of documents) {
    const docId = doc.id || `${(doc.jurisdiction || "unknown").toLowerCase()}/act-${doc.year || "0000"}-${randomUUID().slice(0, 8)}`;

    // Upsert doc
    await db.execute({
      sql: `INSERT INTO legislation_docs (id, jurisdiction, doc_type, title, short_title, year, number, in_force_date, last_amended_date, repealed_date, administered_by, legislation_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          short_title = excluded.short_title,
          last_amended_date = excluded.last_amended_date,
          repealed_date = excluded.repealed_date,
          administered_by = excluded.administered_by,
          legislation_url = excluded.legislation_url`,
      args: [
        docId,
        (doc.jurisdiction || "UNKNOWN").toUpperCase(),
        doc.type || "act",
        doc.title,
        doc.shortTitle || null,
        doc.year || null,
        doc.number || null,
        doc.inForceDate || null,
        doc.lastAmendedDate || null,
        doc.repealedDate || null,
        doc.administeredBy || null,
        doc.legislationUrl || null,
      ],
    });

    // Insert sections
    let sectionsInserted = 0;
    if (Array.isArray(doc.sections)) {
      // Delete existing sections for this doc (idempotent re-ingest)
      await db.execute({
        sql: "DELETE FROM legislation_sections WHERE doc_id = ?",
        args: [docId],
      });

      for (let i = 0; i < doc.sections.length; i++) {
        const s = doc.sections[i];
        const sectionPk = `${docId}/${s.sectionId}`;
        await db.execute({
          sql: `INSERT INTO legislation_sections (id, doc_id, section_id, title, content, depth, parent_section, sort_order, status, amended_by, cross_references, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            sectionPk,
            docId,
            s.sectionId,
            s.title || null,
            s.content || "",
            s.depth ?? 2,
            s.parentSection || null,
            s.order ?? i,
            s.status || "in_force",
            s.amendedBy || null,
            s.crossReferences ? JSON.stringify(s.crossReferences) : null,
            s.notes || null,
          ],
        });
        sectionsInserted++;
      }
    }

    // Insert related doc links
    if (Array.isArray(doc.relatedDocs)) {
      for (const relatedId of doc.relatedDocs) {
        try {
          await db.execute({
            sql: `INSERT OR IGNORE INTO legislation_relations (id, from_doc_id, to_doc_id, relation_type)
              VALUES (?, ?, ?, 'subordinate')`,
            args: [randomUUID(), docId, relatedId],
          });
        } catch { /* Related doc may not exist yet — that's OK */ }
      }
    }

    results.push({ id: docId, title: doc.title, sectionsInserted });
  }

  return NextResponse.json({
    ingested: results.length,
    documents: results,
    message: `Successfully ingested ${results.length} legislation document(s) with ${results.reduce((sum, r) => sum + r.sectionsInserted, 0)} total sections.`,
  });
}
