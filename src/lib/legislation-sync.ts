import { getDb, type DbClient } from "./db";
import { v4 as uuid } from "uuid";
import { syncCth } from "./parsers/cth-parser";
import { syncQld } from "./parsers/qld-parser";

export interface LegislationDoc {
  id: string;
  jurisdiction: string;
  type: string;
  title: string;
  shortTitle?: string;
  year?: number;
  number?: string;
  inForceDate?: string;
  lastAmendedDate?: string;
  repealedDate?: string;
  administeredBy?: string;
  legislationUrl?: string;
  sections: LegislationSection[];
  relatedDocs?: string[];
}

export interface LegislationSection {
  sectionId: string;
  title?: string;
  content: string;
  depth: number;
  parentSection?: string;
  order: number;
  status: string;
  amendedBy?: string;
  crossReferences?: string[];
  notes?: string;
}

export interface SyncResult {
  jurisdiction: string;
  docsChecked: number;
  docsUpdated: number;
  sectionsTotal: number;
  errors: string[];
}

export async function ingestDocuments(db: DbClient, documents: LegislationDoc[]): Promise<{ ingested: number; sectionsTotal: number }> {
  let sectionsTotal = 0;

  for (const doc of documents) {
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
        doc.id,
        doc.jurisdiction.toUpperCase(),
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

    await db.execute({ sql: "DELETE FROM legislation_sections WHERE doc_id = ?", args: [doc.id] });

    for (let i = 0; i < doc.sections.length; i++) {
      const s = doc.sections[i];
      const sectionPk = `${doc.id}/${s.sectionId}`;
      await db.execute({
        sql: `INSERT INTO legislation_sections (id, doc_id, section_id, title, content, depth, parent_section, sort_order, status, amended_by, cross_references, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          sectionPk, doc.id, s.sectionId, s.title || null, s.content || "",
          s.depth ?? 2, s.parentSection || null, s.order ?? i,
          s.status || "in_force", s.amendedBy || null,
          s.crossReferences ? JSON.stringify(s.crossReferences) : null,
          s.notes || null,
        ],
      });
      sectionsTotal++;
    }

    if (doc.relatedDocs) {
      for (const relatedId of doc.relatedDocs) {
        try {
          await db.execute({
            sql: `INSERT INTO legislation_relations (id, from_doc_id, to_doc_id, relation_type)
              VALUES (?, ?, ?, 'subordinate') ON CONFLICT (from_doc_id, to_doc_id, relation_type) DO NOTHING`,
            args: [uuid(), doc.id, relatedId],
          });
        } catch { /* related doc may not exist yet */ }
      }
    }
  }

  return { ingested: documents.length, sectionsTotal };
}

export async function runLegislationSync(jurisdictions?: string[]): Promise<SyncResult[]> {
  const db = await getDb();
  const results: SyncResult[] = [];
  const targets = jurisdictions ?? ["CTH", "QLD"];

  for (const jurisdiction of targets) {
    const logId = uuid();
    await db.execute({
      sql: "INSERT INTO legislation_sync_log (id, jurisdiction, sync_type) VALUES (?, ?, 'scheduled')",
      args: [logId, jurisdiction],
    });

    let result: SyncResult;
    try {
      switch (jurisdiction.toUpperCase()) {
        case "CTH":
          result = await syncCth(db);
          break;
        case "QLD":
          result = await syncQld(db);
          break;
        default:
          result = { jurisdiction, docsChecked: 0, docsUpdated: 0, sectionsTotal: 0, errors: [`Unsupported jurisdiction: ${jurisdiction}`] };
      }
    } catch (e) {
      result = { jurisdiction, docsChecked: 0, docsUpdated: 0, sectionsTotal: 0, errors: [e instanceof Error ? e.message : String(e)] };
    }

    await db.execute({
      sql: `UPDATE legislation_sync_log SET docs_checked = ?, docs_updated = ?, sections_total = ?, errors = ?, completed_at = NOW() WHERE id = ?`,
      args: [result.docsChecked, result.docsUpdated, result.sectionsTotal, result.errors.length > 0 ? JSON.stringify(result.errors) : null, logId],
    });

    results.push(result);
  }

  return results;
}
