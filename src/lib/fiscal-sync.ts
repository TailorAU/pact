// #3053 — Fiscal reconstruction sync (QLD Budget temporal graph node).
//
// Reconstructs the Queensland General Government operating statement from public
// data and the pre-registered FY2026-27 forecast, and upserts the result into
// fiscal_line / fiscal_forecast with a per-run fiscal_sync_log audit row.
//
// Source MAY compute: per-line reconstruction from published SDS / FBO / ABS GFS /
//   QTC public data, the automate/anchor/feed verdict, and the backtested forecast.
// Source MUST NOT: invent budget figures, or assert accuracy without provenance.
//
// WAVE 1 (this file): seeds the already-validated reconstruction (FY2024-25, 7/9
//   lines within ±10% from public data; cross-validated on FY2021-22) and the
//   locked FY2026-27 forecast vector, and establishes the nightly upsert + audit
//   plumbing. The reconstruction methodology + validation lives in
//   C:\tailor_OS\qld-budget-watch\ (full_autorecon.py, full_scorecard.json).
// WAVE 1.x TODO: replace seedData with a live pull of the four public feeds
//   (QLD SDS via the CKAN datastore-dump endpoint, federal FBO, ABS GFS, QTC)
//   and run the consolidation rules in-process, so the node refreshes from source
//   each night rather than from the committed snapshot. The schema, upsert path,
//   audit log, and public surface are all feed-agnostic and do not change.

import { v4 as uuid } from "uuid";
import type { DbClient } from "./db";
import { log } from "./logger";
import seedData from "./fiscal-seed-data.json";

export interface FiscalSyncResult {
  jurisdiction: string;
  status: "synced" | "noop" | "error";
  linesWritten: number;
  forecastLinesWritten: number;
  errorDetail?: string;
}

interface ReconLine {
  line_key: string;
  title: string;
  reconstructed_value: number | null;
  audited_value: number | null;
  err_pct: number | null;
  method: string;
  source_feed: string;
  verdict: string;
}

interface ForecastLine {
  line_key: string;
  title: string;
  forecast_value: number;
}

const RECON_FISCAL_YEAR = "FY2024-25";
const FORECAST_FISCAL_YEAR = "FY2026-27";

// ── Graph nodes (#3053): one institutional-tier topic per fiscal year ──
// The temporal chain: 2024-25 (reconstructed/verified) → 2025-26 (released) →
// 2026-27 (forecast, confidence rising to release). Edges in topic_dependencies.
interface BudgetNode {
  id: string;
  fiscalYear: string;
  claim: string;
  status: string; // 'consensus' for released/verified, 'open' for forecast
}
const BUDGET_NODES: BudgetNode[] = [
  { id: "qld-budget-2024-25", fiscalYear: "FY2024-25",
    claim: "QLD General Government operating statement, FY2024-25 — reconstructed from public data (7/9 lines within ±10% of audited).",
    status: "consensus" },
  { id: "qld-budget-2025-26", fiscalYear: "FY2025-26",
    claim: "QLD General Government operating statement, FY2025-26 — released budget.",
    status: "consensus" },
  { id: "qld-budget-2026-27", fiscalYear: "FY2026-27",
    claim: "QLD General Government operating statement, FY2026-27 — AI forecast, pre-registered before the 23 Jun 2026 release.",
    status: "open" },
];
// edges: [topic_id, depends_on, relationship, justification]
const BUDGET_EDGES: [string, string, string, string][] = [
  ["qld-budget-2025-26", "qld-budget-2024-25", "succeeded_by", "Temporal succession of released budgets."],
  ["qld-budget-2026-27", "qld-budget-2025-26", "forecasts", "The released anchor year forecasts the next; confidence rises toward release."],
];

async function seedFiscalGraph(db: DbClient, confidence: number | null): Promise<string[]> {
  const errs: string[] = [];
  for (const n of BUDGET_NODES) {
    try {
      const content = n.fiscalYear === FORECAST_FISCAL_YEAR && confidence !== null
        ? `${n.claim}\n\nForecast confidence (backtested expected accuracy): ${confidence}% of lines within ±10%.`
        : n.claim;
      await db.execute({
        sql: `INSERT INTO topics (id, title, content, tier, status, canonical_claim,
                jurisdiction, authority, source_ref)
              VALUES (?, ?, ?, 'institutional', ?, ?, 'QLD', 'QLD Treasury', ?)
              ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content,
                canonical_claim = EXCLUDED.canonical_claim`,
        args: [n.id, `QLD Budget ${n.fiscalYear}`, content, n.status, n.claim,
               "QLD Budget papers + Report on State Finances"],
      });
      // back-fill topic_id on this year's fiscal_line rows
      await db.execute({
        sql: `UPDATE fiscal_line SET topic_id = ? WHERE fiscal_year = ? AND topic_id IS NULL`,
        args: [n.id, n.fiscalYear],
      });
    } catch (e) {
      errs.push(`node ${n.id}: ${String(e)}`);
    }
  }
  for (const [topicId, dependsOn, rel, just] of BUDGET_EDGES) {
    try {
      await db.execute({
        sql: `INSERT INTO topic_dependencies (topic_id, depends_on, relationship, justification)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (topic_id, depends_on) DO UPDATE SET relationship = EXCLUDED.relationship`,
        args: [topicId, dependsOn, rel, just],
      });
    } catch (e) {
      errs.push(`edge ${topicId}->${dependsOn}: ${String(e)}`);
    }
  }
  return errs;
}

/**
 * Run the QLD fiscal reconstruction sync. Idempotent: upserts each line by
 * (line_key, fiscal_year). Returns a summary; writes one fiscal_sync_log row.
 */
export async function runFiscalSync(
  db: DbClient,
  opts: { jurisdiction?: string } = {}
): Promise<FiscalSyncResult> {
  const jurisdiction = opts.jurisdiction ?? "QLD";
  const logId = uuid();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let linesWritten = 0;
  let forecastLinesWritten = 0;

  const recon = ((seedData as Record<string, unknown>)["reconstruction_FY2024-25"] ?? []) as ReconLine[];
  const forecast = ((seedData as Record<string, unknown>)["forecast_FY2026-27"] ?? []) as ForecastLine[];
  const linesChecked = recon.length + forecast.length;

  try {
    // ── Reconstruction lines (FY2024-25) ──────────────────────────────
    for (const line of recon) {
      try {
        await db.execute({
          sql: `INSERT INTO fiscal_line
                  (id, line_key, fiscal_year, jurisdiction, authority, title,
                   reconstructed_value, audited_value, err_pct, method, source_feed,
                   verdict, source_ref, derived_from, limitations, retrieved_at, updated_at)
                VALUES (?, ?, ?, ?, 'QLD Treasury', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                ON CONFLICT (line_key, fiscal_year) DO UPDATE SET
                  reconstructed_value = EXCLUDED.reconstructed_value,
                  audited_value = EXCLUDED.audited_value,
                  err_pct = EXCLUDED.err_pct,
                  method = EXCLUDED.method,
                  source_feed = EXCLUDED.source_feed,
                  verdict = EXCLUDED.verdict,
                  updated_at = NOW()`,
          args: [
            uuid(), line.line_key, RECON_FISCAL_YEAR, jurisdiction, line.title,
            line.reconstructed_value, line.audited_value, line.err_pct, line.method,
            line.source_feed, line.verdict,
            "QLD Report on State Finances 2024-25 + Service Delivery Statements",
            JSON.stringify([line.source_feed]),
            JSON.stringify(
              line.reconstructed_value === null
                ? ["No single public source: requires the grant ledger's counterparty field."]
                : []
            ),
          ],
        });
        linesWritten++;
      } catch (e) {
        errors.push(`recon ${line.line_key}: ${String(e)}`);
      }
    }

    // ── Forecast lines (FY2026-27, pre-registered) ────────────────────
    const confidence = (seedData.confidence as number | undefined) ?? null;
    const confEntry = JSON.stringify([{ at: startedAt, confidence }]);
    for (const line of forecast) {
      try {
        await db.execute({
          sql: `INSERT INTO fiscal_forecast
                  (id, line_key, fiscal_year, forecast_value, confidence,
                   confidence_history, model_version, lock_hash, locked_at, retrieved_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                ON CONFLICT (line_key, fiscal_year) DO UPDATE SET
                  forecast_value = EXCLUDED.forecast_value,
                  confidence = EXCLUDED.confidence,
                  confidence_history = fiscal_forecast.confidence_history || EXCLUDED.confidence_history,
                  retrieved_at = NOW()`,
          args: [
            uuid(), line.line_key, FORECAST_FISCAL_YEAR, line.forecast_value,
            confidence, confEntry,
            seedData.model_version as string, seedData.lock_hash as string,
          ],
        });
        forecastLinesWritten++;
      } catch (e) {
        errors.push(`forecast ${line.line_key}: ${String(e)}`);
      }
    }
    // ── Graph nodes + edges (#3053 Wave 3) ────────────────────────────
    const graphErrs = await seedFiscalGraph(db, confidence);
    errors.push(...graphErrs);
  } catch (e) {
    errors.push(`fatal: ${String(e)}`);
  }

  const written = linesWritten + forecastLinesWritten;
  const silentZero = linesChecked > 0 && written === 0 && errors.length > 0;
  if (silentZero) {
    log.error({ op: "fiscal.sync.silent_zero", jurisdiction, linesChecked, errors });
  } else {
    log.info({ op: "fiscal.sync.complete", jurisdiction, linesWritten, forecastLinesWritten });
  }

  await db.execute({
    sql: `INSERT INTO fiscal_sync_log
            (id, jurisdiction, started_at, completed_at, feeds_fetched,
             lines_checked, lines_written, model_version, anomaly_count,
             crash_count, silent_zero_flag, errors)
          VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, 0, ?, ?)`,
    args: [
      logId, jurisdiction, startedAt,
      JSON.stringify(["SEED"]), // WAVE 1: seeded snapshot; live feeds = ['SDS','FBO','GFS','QTC']
      linesChecked, written, seedData.model_version as string,
      errors.length, silentZero, JSON.stringify(errors),
    ],
  });

  return {
    jurisdiction,
    status: errors.length > 0 && written === 0 ? "error" : written === 0 ? "noop" : "synced",
    linesWritten,
    forecastLinesWritten,
    errorDetail: errors.length ? errors.join("; ") : undefined,
  };
}
