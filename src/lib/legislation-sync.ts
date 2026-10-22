import { getDb, type DbClient } from "./db";
import { v4 as uuid } from "uuid";
import { log } from "./logger";
import { syncCth } from "./parsers/cth-parser";
import { syncQld } from "./parsers/qld-parser";
import {
  LEGISLATION_INGEST_LIMITS,
  LegislationValidationError,
  normalizeLegislationDocuments,
  replaceLegislationDocuments,
  type LegislationDocumentInput,
  type LegislationIngestSource,
  type LegislationSectionInput,
  type NormalizedLegislationDocument,
  type SkippedReviewedDocument,
} from "./legislation-ingest";

// Preserve the public parser / #5277 type names while sharing the write DTO.
export type LegislationDoc = LegislationDocumentInput;
export type LegislationSection = LegislationSectionInput;

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

/** A document the ingest refused, with the first validation issue it hit. */
export interface RejectedDocument {
  id: string;
  path: string;
  message: string;
}

export interface IngestOutcome {
  /** Documents actually written by `replaceLegislationDocuments`. */
  ingested: number;
  sectionsTotal: number;
  rejected: RejectedDocument[];
  /**
   * Documents a reviewed ingest marked (`legislation_docs.reviewed_at`), left
   * untouched by this write (tailor-group#35).
   */
  skipped: SkippedReviewedDocument[];
}

/**
 * Validate each document on its own, then write the valid ones in one
 * transaction (tailor-group#37). Validating the batch as a whole meant one
 * document with a repeated section id rejected all five in it, and with
 * newest-first paging amending Acts are the majority of every CTH batch, so
 * no CTH document was ever written. The cross-document checks the batch
 * normalizer made (unique ids, total section cap) are kept here.
 *
 * `source` is mandatory (tailor-group#35): the parsers pass `scheduled`, the
 * proposal finalizer `proposal`. Neither may overwrite a reviewed document;
 * the ones the write skipped come back in `skipped`.
 */
export async function ingestDocuments(
  db: DbClient,
  documents: LegislationDoc[],
  source: LegislationIngestSource,
): Promise<IngestOutcome> {
  const valid: NormalizedLegislationDocument[] = [];
  const rejected: RejectedDocument[] = [];
  const seenIds = new Set<string>();
  let totalSections = 0;

  for (const document of documents) {
    let normalized: NormalizedLegislationDocument;
    try {
      [normalized] = normalizeLegislationDocuments([document]);
    } catch (e) {
      if (!(e instanceof LegislationValidationError)) throw e;
      const issue = e.issues[0] ?? { path: "documents[0]", message: e.message };
      rejected.push({ id: String(document.id), path: issue.path, message: issue.message });
      continue;
    }
    if (seenIds.has(normalized.id)) {
      rejected.push({ id: normalized.id, path: "id", message: "must be unique within the request" });
      continue;
    }
    if (totalSections + normalized.sections.length > LEGISLATION_INGEST_LIMITS.totalSections) {
      rejected.push({
        id: normalized.id,
        path: "sections",
        message: `must fit within ${LEGISLATION_INGEST_LIMITS.totalSections} sections per request`,
      });
      continue;
    }
    seenIds.add(normalized.id);
    totalSections += normalized.sections.length;
    valid.push(normalized);
  }

  if (valid.length === 0) return { ingested: 0, sectionsTotal: 0, rejected, skipped: [] };
  const result = await replaceLegislationDocuments(db, valid, source);
  return {
    ingested: result.ingested,
    sectionsTotal: result.sectionsTotal,
    rejected,
    skipped: result.skipped,
  };
}

/**
 * Fold an ingest outcome into a jurisdiction's SyncResult: `docsUpdated`
 * counts only documents actually written; each rejected document is one
 * error line and one parser anomaly (its output was unusable, nothing threw),
 * and so is each document skipped because a reviewed ingest marked it
 * (tailor-group#35) — the parser produced output the graph refused.
 */
export function recordIngestOutcome(result: SyncResult, outcome: IngestOutcome): void {
  result.docsUpdated += outcome.ingested;
  result.sectionsTotal += outcome.sectionsTotal;
  for (const doc of outcome.rejected) {
    result.errors.push(`Rejected ${doc.id}: ${doc.path} ${doc.message}`);
    result.parserAnomalyCount++;
  }
  for (const doc of outcome.skipped) {
    result.errors.push(`Skipped ${doc.id}: reviewed document (reviewed_at ${doc.reviewedAt})`);
    result.parserAnomalyCount++;
  }
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

/** The jurisdictions a sync covers when the caller names none. */
export const DEFAULT_LEGISLATION_JURISDICTIONS = ["CTH", "QLD"] as const;

export async function runLegislationSync(jurisdictions?: string[]): Promise<SyncResult[]> {
  const db = await getDb();
  const results: SyncResult[] = [];
  const targets = jurisdictions ?? [...DEFAULT_LEGISLATION_JURISDICTIONS];

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
