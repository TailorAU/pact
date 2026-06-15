// #3053 — Fiscal reconstruction read queries (public, no-auth).
// Shared by the /api/fiscal/* routes and the /fiscal page (no self-fetch).

import { getDb } from "./db";

export interface FiscalLineRow {
  lineKey: string;
  fiscalYear: string;
  title: string;
  reconstructedValue: number | null;
  auditedValue: number | null;
  errPct: number | null;
  method: string;
  sourceFeed: string;
  verdict: string;
  status: string; // 'reconstructed' | 'verified' (audited present)
}

export interface FiscalForecastRow {
  lineKey: string;
  fiscalYear: string;
  title: string;
  forecastValue: number;
  confidence: number | null;
  actualValue: number | null;
  accuracyScore: number | null;
  modelVersion: string;
  lockHash: string;
}

// Human-readable titles, keyed by line_key, so the forecast year renders labels
// even before any fiscal_line row for that year exists to join against.
const LINE_TITLES: Record<string, string> = {
  "qld.gg.taxation": "Taxation revenue",
  "qld.gg.grants_rev": "Grants revenue",
  "qld.gg.sales_gs": "Sales of goods and services",
  "qld.gg.interest_inc": "Interest income",
  "qld.gg.dividends": "Dividend & ITE income",
  "qld.gg.other_rev": "Other revenue",
  "qld.gg.total_rev": "Total revenue",
  "qld.gg.employee": "Employee expenses",
  "qld.gg.super_int": "Superannuation interest cost",
  "qld.gg.other_super": "Other superannuation expenses",
  "qld.gg.other_oper": "Other operating expenses",
  "qld.gg.dep_amort": "Depreciation and amortisation",
  "qld.gg.interest_exp": "Other interest expenses",
  "qld.gg.grants_exp": "Grants expenses",
  "qld.gg.total_exp": "Total expenses",
  "qld.gg.purch_nfa": "Purchases of non-financial assets",
  "qld.gg.nob": "Net operating balance",
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function getFiscalActuals(options: {
  fiscalYear?: string;
  verdict?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ lines: FiscalLineRow[]; total: number; lastUpdated: string | null }> {
  const db = await getDb();
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;
  const where: string[] = ["deprecated_at IS NULL"];
  const args: unknown[] = [];
  if (options.fiscalYear) { where.push("fiscal_year = ?"); args.push(options.fiscalYear); }
  if (options.verdict) { where.push("verdict = ?"); args.push(options.verdict); }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM fiscal_line ${whereSql}`,
    args,
  });
  const total = num(countRes.rows?.[0]?.c) ?? 0;

  const res = await db.execute({
    sql: `SELECT line_key, fiscal_year, title, reconstructed_value, audited_value,
                 err_pct, method, source_feed, verdict, updated_at
          FROM fiscal_line ${whereSql}
          ORDER BY fiscal_year DESC, line_key ASC
          LIMIT ${limit} OFFSET ${offset}`,
    args,
  });

  const lines: FiscalLineRow[] = (res.rows ?? []).map((r) => ({
    lineKey: String(r.line_key),
    fiscalYear: String(r.fiscal_year),
    title: String(r.title),
    reconstructedValue: num(r.reconstructed_value),
    auditedValue: num(r.audited_value),
    errPct: num(r.err_pct),
    method: String(r.method),
    sourceFeed: String(r.source_feed),
    verdict: String(r.verdict),
    status: r.audited_value !== null && r.audited_value !== undefined ? "verified" : "reconstructed",
  }));

  const freshRes = await db.execute("SELECT MAX(updated_at) AS m FROM fiscal_line");
  const lastUpdated = freshRes.rows?.[0]?.m ? String(freshRes.rows[0].m) : null;

  return { lines, total, lastUpdated };
}

export async function getFiscalForecast(options: {
  fiscalYear?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ lines: FiscalForecastRow[]; total: number; lastUpdated: string | null }> {
  const db = await getDb();
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;
  const args: unknown[] = [];
  let whereSql = "";
  if (options.fiscalYear) { whereSql = "WHERE fiscal_year = ?"; args.push(options.fiscalYear); }

  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM fiscal_forecast ${whereSql}`,
    args,
  });
  const total = num(countRes.rows?.[0]?.c) ?? 0;

  const res = await db.execute({
    sql: `SELECT line_key, fiscal_year, forecast_value, confidence, actual_value,
                 accuracy_score, model_version, lock_hash, retrieved_at
          FROM fiscal_forecast ${whereSql}
          ORDER BY line_key ASC
          LIMIT ${limit} OFFSET ${offset}`,
    args,
  });

  const lines: FiscalForecastRow[] = (res.rows ?? []).map((r) => ({
    lineKey: String(r.line_key),
    fiscalYear: String(r.fiscal_year),
    title: LINE_TITLES[String(r.line_key)] ?? String(r.line_key),
    forecastValue: num(r.forecast_value) ?? 0,
    confidence: num(r.confidence),
    actualValue: num(r.actual_value),
    accuracyScore: num(r.accuracy_score),
    modelVersion: String(r.model_version),
    lockHash: String(r.lock_hash),
  }));

  const freshRes = await db.execute("SELECT MAX(retrieved_at) AS m FROM fiscal_forecast");
  const lastUpdated = freshRes.rows?.[0]?.m ? String(freshRes.rows[0].m) : null;

  return { lines, total, lastUpdated };
}

export async function getFiscalSummary(fiscalYear = "FY2024-25"): Promise<{
  fiscalYear: string;
  totalReconstructed: number;
  totalAudited: number;
  linesWithinTenPct: number;
  linesScored: number;
  byVerdict: { automate: number; anchor: number; feed: number };
  lastUpdated: string | null;
}> {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT reconstructed_value, audited_value, err_pct, verdict
          FROM fiscal_line WHERE fiscal_year = ? AND deprecated_at IS NULL`,
    args: [fiscalYear],
  });
  const rows = res.rows ?? [];
  let totalReconstructed = 0, totalAudited = 0, within = 0, scored = 0;
  const byVerdict = { automate: 0, anchor: 0, feed: 0 };
  for (const r of rows) {
    const rec = num(r.reconstructed_value);
    const aud = num(r.audited_value);
    const err = num(r.err_pct);
    if (rec !== null) totalReconstructed += rec;
    if (aud !== null) totalAudited += aud;
    if (err !== null) { scored++; if (Math.abs(err) <= 10) within++; }
    const v = String(r.verdict);
    if (v === "automate" || v === "anchor" || v === "feed") byVerdict[v]++;
  }
  const freshRes = await db.execute("SELECT MAX(updated_at) AS m FROM fiscal_line");
  const lastUpdated = freshRes.rows?.[0]?.m ? String(freshRes.rows[0].m) : null;

  return {
    fiscalYear,
    totalReconstructed: Math.round(totalReconstructed),
    totalAudited: Math.round(totalAudited),
    linesWithinTenPct: within,
    linesScored: scored,
    byVerdict,
    lastUpdated,
  };
}
