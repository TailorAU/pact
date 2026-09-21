import { getDb, type DbClient } from "./db";
import { v4 as uuid } from "uuid";
import { log } from "./logger";
import { syncCth } from "./parsers/cth-parser";
import { syncQld } from "./parsers/qld-parser";
import {
  normalizeLegislationDocuments,
  replaceLegislationDocuments,
  type LegislationDocumentInput,
  type LegislationSectionInput,
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

export async function ingestDocuments(db: DbClient, documents: LegislationDoc[]): Promise<{ ingested: number; sectionsTotal: number }> {
  const normalized = normalizeLegislationDocuments(documents);
  const result = await replaceLegislationDocuments(db, normalized);
  return { ingested: result.ingested, sectionsTotal: result.sectionsTotal };
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
