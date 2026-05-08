import { getDb, type DbClient } from "./db";
import { v4 as uuid } from "uuid";
import { log } from "./logger";
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

/**
 * Result of one jurisdiction's sync run.
 *
 * WS9 fields:
 * - `parserVersion`        — semver-style stamp identifying the parser code
 *                            that produced this run. Bumped when the parser
 *                            changes parsing semantics.
 * - `parserAnomalyCount`   — per-doc parsing anomalies that did NOT throw
 *                            but produced unusable output (e.g. zero sections
 *                            extracted, missing version metadata, fallback
 *                            chunker invoked). Used to compute silent_zero.
 * - `parserCrashCount`     — per-doc exceptions caught during parsing. The
 *                            sync loop also catches whole-jurisdiction
 *                            throws but those land in `errors`, not here.
 */
export interface SyncResult {
  jurisdiction: string;
  docsChecked: number;
  docsUpdated: number;
  sectionsTotal: number;
  errors: string[];
  parserVersion: string;
  parserAnomalyCount: number;
  parserCrashCount: number;
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

/**
 * Empty result envelope used when a jurisdiction's sync throws before the
 * parser can populate its own fields, or when an unsupported jurisdiction
 * code is requested. Lifts the WS9 fields to defaults so downstream readers
 * never deal with `undefined`.
 */
function emptySyncResult(jurisdiction: string, errors: string[]): SyncResult {
  return {
    jurisdiction,
    docsChecked: 0,
    docsUpdated: 0,
    sectionsTotal: 0,
    errors,
    parserVersion: "unknown",
    parserAnomalyCount: 0,
    parserCrashCount: 0,
  };
}

export async function runLegislationSync(jurisdictions?: string[]): Promise<SyncResult[]> {
  const db = await getDb();
  const results: SyncResult[] = [];
  const targets = jurisdictions ?? ["CTH", "QLD"];

  for (const jurisdiction of targets) {
    const runId = uuid();
    await db.execute({
      sql: "INSERT INTO legislation_sync_log (id, jurisdiction, sync_type) VALUES (?, ?, 'scheduled')",
      args: [runId, jurisdiction],
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
          result = emptySyncResult(jurisdiction, [`Unsupported jurisdiction: ${jurisdiction}`]);
      }
    } catch (e) {
      // Whole-jurisdiction throw — record the error message but mark the
      // crash count so downstream readers see it without parsing `errors`.
      result = emptySyncResult(jurisdiction, [e instanceof Error ? e.message : String(e)]);
      result.parserCrashCount = 1;
    }

    // Silent-zero: ran successfully (no whole-jurisdiction throw), checked at
    // least one doc, updated none, and observed at least one parser anomaly.
    // This is the case the audit found: parser silently dropped everything
    // while logs reported "0 updated, no errors". The flag turns that into a
    // queryable signal.
    //
    // Note: docs_checked > 0 AND docs_updated = 0 AND parser_anomaly_count = 0
    // is NOT silent-zero — that's the legitimate "ran, nothing new upstream"
    // case (#1401 freshness probe surfaces it via `last_amended_date`, not via
    // this column).
    const silentZero =
      result.docsChecked > 0 &&
      result.docsUpdated === 0 &&
      result.parserAnomalyCount > 0;

    await db.execute({
      sql: `UPDATE legislation_sync_log
        SET docs_checked = ?, docs_updated = ?, sections_total = ?, errors = ?,
            silent_zero_flag = ?, parser_version = ?, parser_crash_count = ?,
            parser_anomaly_count = ?, completed_at = NOW()
        WHERE id = ?`,
      args: [
        result.docsChecked,
        result.docsUpdated,
        result.sectionsTotal,
        result.errors.length > 0 ? JSON.stringify(result.errors) : null,
        silentZero,
        result.parserVersion,
        result.parserCrashCount,
        result.parserAnomalyCount,
        runId,
      ],
    });

    if (silentZero) {
      // Structured warn — App Insights picks this up via the OTel/stderr route
      // wired in WS1. The `op` is the dot-separated handle that future alarm
      // rules (Phase 3 WS-dash) match on.
      log.warn(
        {
          op: "legislation.sync.silent_zero",
          jurisdiction: result.jurisdiction,
          docsChecked: result.docsChecked,
          parserAnomalyCount: result.parserAnomalyCount,
          parserCrashCount: result.parserCrashCount,
          parserVersion: result.parserVersion,
          runId,
        },
        "legislation sync ran but parsed zero updates with anomalies"
      );
    }

    results.push(result);
  }

  return results;
}
