/**
 * #1152 Round 4 — Work economy validators.
 * #1160 Round 3 — applicability_spotcheck work type (blind_predict + review_existing).
 *
 * Each work_type has a validator that inspects the agent's submission and
 * decides whether the claimed work is real. Validators are deterministic (no
 * LLM calls inside the validator itself — the `/api/scenarios/match` route
 * owns the LLM fallback path).
 *
 * Rewards:
 *   scrape                    → 5 credits
 *   qa_spot_check             → 2 credits
 *   dependency_proposal       → 10 credits (deferred — settles on PACT merge)
 *   applicability_spotcheck   → 3 credits (blind_predict) / 5 credits cap (review_existing)
 */

import type { Scenario } from "@/lib/scenarios/types";
import { matchScenarios, type PredicateMatch } from "@/lib/scenarios/predicate-match";

export type WorkType =
  | "scrape"
  | "qa_spot_check"
  | "dependency_proposal"
  | "applicability_spotcheck"
  | "price_observation_mining";

export const WORK_REWARDS: Record<WorkType, number> = {
  scrape: 5,
  qa_spot_check: 2,
  dependency_proposal: 10,
  applicability_spotcheck: 3,
  price_observation_mining: 2,
};

/** Max credits payable for a single review_existing submission (per handoff §8.1). */
export const APPLICABILITY_SPOTCHECK_REVIEW_CREDITS = 5;

export interface ValidationResult {
  accept: boolean;
  defer: boolean;
  credits: number;
  notes: string;
  /** #1160 — defect rows to persist after acceptance (review_existing mode only). */
  defects?: ApplicabilityDefectDraft[];
  /** #1216 — observation row to persist (when accepted OR when cold-start defer). */
  priceObservation?: PriceObservationDraft;
  /** #1216 — defect row to persist (cold-start, outlier, sanity-range, unit-mismatch). */
  priceDefect?: PriceObservationDefectDraft;
}

/** A defect the caller can persist after a successful review_existing. */
export interface ApplicabilityDefectDraft {
  findingKind: "reject" | "missing";
  edgeId: string | null;
  targetKind: "topic" | "legislation" | null;
  targetId: string | null;
  reason: string;
  potentialCredits: number;
}

/** #1216 — observation hint passed back to the submit handler for find-or-create + insert. */
export interface PriceObservationDraft {
  itemKey: string;
  retailerSlug: string;
  retailerId: string;
  productName: string;
  productEan: string | null;
  productUrl: string;
  priceCents: number;
  unitPriceCents: number;
  unitPriceUnit: string;
  inStock: boolean;
}

/** #1216 — defect hint for outlier / cold-start / sanity-range / unit-mismatch / url-invalid. */
export interface PriceObservationDefectDraft {
  itemKey: string;
  retailerId: string;
  findingKind:
    | "outlier_price"
    | "sanity_range"
    | "unit_mismatch"
    | "url_invalid"
    | "cold_start";
  reason: string;
  submittedPriceCents: number | null;
  submittedUnit: string | null;
  productUrl: string | null;
  potentialCredits: number;
}

export function validateScrape(submission: Record<string, unknown>): ValidationResult {
  const url = asString(submission.sourceUrl);
  const hash = asString(submission.payloadHash);
  const expected = asString(submission.expectedSectionId);
  const content = asString(submission.content);

  if (!url || !hash || !expected || !content) {
    return reject("scrape submissions require sourceUrl, payloadHash, expectedSectionId, content");
  }
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return reject("payloadHash must be a sha256 hex digest (64 chars)");
  }
  if (!content.toLowerCase().includes(expected.toLowerCase())) {
    return reject(`content does not reference expectedSectionId '${expected}'`);
  }
  return accept(WORK_REWARDS.scrape, `scrape verified against ${url}`);
}

export function validateQaSpotCheck(submission: Record<string, unknown>): ValidationResult {
  const topicId = asString(submission.topicId);
  const decision = asString(submission.decision);
  const rationale = asString(submission.rationale);

  if (!topicId) return reject("topicId is required");
  if (decision !== "approve" && decision !== "reject") {
    return reject("decision must be 'approve' or 'reject'");
  }
  if (!rationale || rationale.length < 40) {
    return reject("rationale must be at least 40 characters");
  }
  return accept(WORK_REWARDS.qa_spot_check, `qa ${decision} on ${topicId}`);
}

export function validateDependencyProposal(submission: Record<string, unknown>): ValidationResult {
  const topicId = asString(submission.topicId);
  const dependsOn = asString(submission.dependsOn);
  const relationship = asString(submission.relationship);
  const proposalId = asString(submission.proposalId);

  if (!topicId || !dependsOn || !relationship || !proposalId) {
    return reject("dependency_proposal requires topicId, dependsOn, relationship, proposalId");
  }
  if (topicId === dependsOn) {
    return reject("topicId and dependsOn cannot be the same topic");
  }
  return {
    accept: true,
    defer: true,
    credits: 0,
    notes: `dependency_proposal ${proposalId} queued; credits applied on consensus merge`,
  };
}

// -----------------------------------------------------------------------------
// #1160 — applicability_spotcheck (async — needs DB access for review_existing)
// -----------------------------------------------------------------------------

/** Abstract DB surface the validator needs — structurally compatible with
 *  `DbClient.execute` from lib/db.ts, so callers can pass `getDb()` directly. */
export interface ValidatorDb {
  execute: (
    input: string | { sql: string; args: unknown[] },
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Context required to validate applicability_spotcheck submissions. */
export interface ApplicabilityContext {
  db: ValidatorDb;
  /** Injected scenario loader so tests can avoid hitting the real DB. */
  listScenarios?: () => Promise<Pick<Scenario, "id" | "title" | "predicates">[]>;
}

/** Scoring model — F1 against the top-3 canonical matches at confidence >= 0.5. */
export function scoreBlindPredict(
  predicted: string[],
  canonical: PredicateMatch[],
  opts: { minConfidence?: number; topK?: number } = {},
): { precision: number; recall: number; f1: number; canonicalIds: string[] } {
  const minConf = opts.minConfidence ?? 0.5;
  const topK = opts.topK ?? 3;
  const canonicalIds = canonical
    .filter((m) => m.confidence >= minConf)
    .slice(0, topK)
    .map((m) => m.scenarioId);
  if (predicted.length === 0 && canonicalIds.length === 0) {
    return { precision: 1, recall: 1, f1: 1, canonicalIds };
  }
  const predictedSet = new Set(predicted);
  const intersection = canonicalIds.filter((id) => predictedSet.has(id)).length;
  const precision = predicted.length === 0 ? 0 : intersection / predicted.length;
  const recall = canonicalIds.length === 0 ? 0 : intersection / canonicalIds.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, canonicalIds };
}

export async function validateApplicabilitySpotCheck(
  submission: Record<string, unknown>,
  ctx: ApplicabilityContext,
): Promise<ValidationResult> {
  const mode = asString(submission.mode);
  if (mode === "blind_predict") {
    return validateBlindPredict(submission, ctx);
  }
  if (mode === "review_existing") {
    return validateReviewExisting(submission, ctx);
  }
  return reject("applicability_spotcheck requires mode='blind_predict' or 'review_existing'");
}

async function validateBlindPredict(
  submission: Record<string, unknown>,
  ctx: ApplicabilityContext,
): Promise<ValidationResult> {
  const predicates = submission.predicates;
  const predictedScenarioIds = asStringArray(submission.predictedScenarioIds);
  const rationale = asString(submission.rationale);
  if (!predicates || typeof predicates !== "object" || Array.isArray(predicates)) {
    return reject("blind_predict requires predicates (object)");
  }
  if (!rationale || rationale.length < 80) {
    return reject("blind_predict rationale must be at least 80 characters");
  }
  const scenarios = ctx.listScenarios ? await ctx.listScenarios() : await defaultListScenarios(ctx.db);
  const matches = matchScenarios(scenarios, predicates as Record<string, unknown>);
  const { f1, canonicalIds } = scoreBlindPredict(predictedScenarioIds, matches);
  if (predictedScenarioIds.length === 0 && canonicalIds.length >= 1) {
    return reject(`blind_predict predicted nothing but canonical has ${canonicalIds.length} match(es)`);
  }
  if (f1 >= 0.66) {
    return accept(
      WORK_REWARDS.applicability_spotcheck,
      `blind_predict accepted (F1=${f1.toFixed(2)}, canonical=${canonicalIds.join(",") || "none"})`,
    );
  }
  if (f1 >= 0.5) {
    const partial = Math.max(1, Math.round(WORK_REWARDS.applicability_spotcheck * f1));
    return {
      accept: true,
      defer: false,
      credits: partial,
      notes: `blind_predict partial credit (F1=${f1.toFixed(2)}, credits=${partial})`,
    };
  }
  return reject(`blind_predict F1 too low (F1=${f1.toFixed(2)}, canonical=${canonicalIds.join(",") || "none"})`);
}

async function validateReviewExisting(
  submission: Record<string, unknown>,
  ctx: ApplicabilityContext,
): Promise<ValidationResult> {
  const scenarioId = asString(submission.scenarioId);
  const rationale = asString(submission.rationale);
  const findingsRaw = Array.isArray(submission.findings) ? submission.findings : [];
  if (!scenarioId) return reject("review_existing requires scenarioId");
  if (!rationale || rationale.length < 120) {
    return reject("review_existing rationale must be at least 120 characters overall");
  }
  if (findingsRaw.length === 0) {
    return reject("review_existing requires at least one finding");
  }

  const scnExists = await ctx.db.execute({
    sql: "SELECT 1 AS one FROM scenarios WHERE id = ?",
    args: [scenarioId],
  });
  if (scnExists.rows.length === 0) {
    return reject(`scenarioId '${scenarioId}' not found`);
  }
  const existingEdges = await ctx.db.execute({
    sql: `SELECT id, topic_id, legislation_id
          FROM scenario_applies_when
          WHERE scenario_id = ?`,
    args: [scenarioId],
  });
  const edgeById = new Map<string, { topicId: string | null; legislationId: string | null }>(
    existingEdges.rows.map((r) => [
      String(r.id),
      {
        topicId: (r.topic_id as string | null) ?? null,
        legislationId: (r.legislation_id as string | null) ?? null,
      },
    ]),
  );

  let confirmCount = 0;
  let totalCredits = 0;
  const defects: ApplicabilityDefectDraft[] = [];

  for (const raw of findingsRaw) {
    if (!raw || typeof raw !== "object") {
      return reject("each finding must be an object");
    }
    const f = raw as Record<string, unknown>;
    const action = asString(f.action);
    const reason = asString(f.reason);
    const edgeId = asString(f.edgeId) || null;
    const targetKind = asString(f.targetKind);
    const targetId = asString(f.targetId) || null;

    if (action === "confirm") {
      if (!edgeId || !edgeById.has(edgeId)) {
        return reject(`confirm finding references unknown edgeId '${edgeId ?? ""}'`);
      }
      if (!reason || reason.length < 40) {
        return reject("confirm finding requires reason >= 40 chars");
      }
      if (confirmCount < 3) {
        totalCredits += 1;
        confirmCount += 1;
      }
      continue;
    }
    if (action === "reject") {
      if (!edgeId || !edgeById.has(edgeId)) {
        return reject(`reject finding references unknown edgeId '${edgeId ?? ""}'`);
      }
      if (!reason || reason.length < 40) {
        return reject("reject finding requires reason >= 40 chars");
      }
      const credits = 2;
      totalCredits += credits;
      defects.push({
        findingKind: "reject",
        edgeId,
        targetKind: null,
        targetId: null,
        reason,
        potentialCredits: credits,
      });
      continue;
    }
    if (action === "missing") {
      if (targetKind !== "topic" && targetKind !== "legislation") {
        return reject("missing finding requires targetKind='topic'|'legislation'");
      }
      if (!targetId) {
        return reject("missing finding requires targetId");
      }
      if (!reason || reason.length < 40) {
        return reject("missing finding requires reason >= 40 chars");
      }
      const table = targetKind === "topic" ? "topics" : "legislation_docs";
      const exists = await ctx.db.execute({
        sql: `SELECT 1 AS one FROM ${table} WHERE id = ?`,
        args: [targetId],
      });
      if (exists.rows.length === 0) {
        return reject(`missing finding targetId '${targetId}' not found in ${table}`);
      }
      const alreadyLinked = Array.from(edgeById.values()).some((e) =>
        targetKind === "topic" ? e.topicId === targetId : e.legislationId === targetId,
      );
      if (alreadyLinked) {
        return reject(`missing finding targetId '${targetId}' is already linked — not missing`);
      }
      const credits = 3;
      totalCredits += credits;
      defects.push({
        findingKind: "missing",
        edgeId: null,
        targetKind,
        targetId,
        reason,
        potentialCredits: credits,
      });
      continue;
    }
    return reject(`unknown finding action '${action}'; expected confirm|reject|missing`);
  }

  const capped = Math.min(totalCredits, APPLICABILITY_SPOTCHECK_REVIEW_CREDITS);
  if (defects.length > 0) {
    return {
      accept: true,
      defer: true,
      credits: capped,
      notes: `review_existing deferred — ${defects.length} defect(s) open for curator review (potential credits=${capped})`,
      defects,
    };
  }
  if (confirmCount === 0) {
    return reject("review_existing needs at least one confirm / reject / missing finding");
  }
  return {
    accept: true,
    defer: false,
    credits: capped,
    notes: `review_existing accepted (confirms=${confirmCount}, credits=${capped})`,
  };
}

async function defaultListScenarios(db: ValidatorDb) {
  const r = await db.execute(
    "SELECT id, title, predicates FROM scenarios ORDER BY title ASC",
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    predicates: coerceJson(row.predicates),
  }));
}

function coerceJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export async function validate(
  workType: string,
  submission: Record<string, unknown>,
  ctx?: ApplicabilityContext & PriceObservationContextExtras,
): Promise<ValidationResult> {
  switch (workType) {
    case "scrape":
      return validateScrape(submission);
    case "qa_spot_check":
      return validateQaSpotCheck(submission);
    case "dependency_proposal":
      return validateDependencyProposal(submission);
    case "applicability_spotcheck":
      if (!ctx) {
        return reject("applicability_spotcheck requires a validator context (server-side only)");
      }
      return validateApplicabilitySpotCheck(submission, ctx);
    case "price_observation_mining":
      if (!ctx) {
        return reject("price_observation_mining requires a validator context (server-side only)");
      }
      return validatePriceObservationMining(submission, ctx);
    default:
      return reject(
        `unknown work_type '${workType}'; expected one of: scrape, qa_spot_check, dependency_proposal, applicability_spotcheck, price_observation_mining`,
      );
  }
}

// -----------------------------------------------------------------------------
// #1216 — price_observation_mining (async — needs DB + URL HEAD checks)
// -----------------------------------------------------------------------------

/** Optional fetcher injection for tests; defaults to native fetch with HEAD + 5s timeout. */
export interface PriceObservationContextExtras {
  fetchHead?: (url: string) => Promise<{ ok: boolean; status: number }>;
}

const PRICE_OBS_CLUSTER_DAYS = 14;
const PRICE_OBS_CLUSTER_LIMIT = 20;
const PRICE_OBS_TOLERANCE = 0.1; // ±10% of running median

export async function validatePriceObservationMining(
  submission: Record<string, unknown>,
  ctx: ApplicabilityContext & PriceObservationContextExtras,
): Promise<ValidationResult> {
  // ── Stage 1 (deterministic) ──────────────────────────────────────
  const itemKey = asString(submission.itemKey);
  const retailerSlug = asString(submission.retailerSlug);
  const productName = asString(submission.productName);
  const productUrl = asString(submission.productUrl);
  const ean = asString(submission.ean) || null;
  const priceCents = asInt(submission.priceCents);
  const unitPriceCents = asInt(submission.unitPriceCents);
  const unitPriceUnit = asString(submission.unitPriceUnit);
  const inStock = submission.inStock !== false;

  if (!itemKey || !retailerSlug || !productName || !productUrl || !unitPriceUnit) {
    return reject(
      "price_observation_mining requires itemKey, retailerSlug, productName, productUrl, unitPriceUnit",
    );
  }
  if (priceCents == null || priceCents <= 0 || unitPriceCents == null || unitPriceCents <= 0) {
    return reject("priceCents and unitPriceCents must be positive integers (in cents)");
  }
  if (productName.length < 5 || productName.length > 250) {
    return reject("productName must be 5-250 chars");
  }

  // Lookup item key (must exist + not deprecated)
  const itemRow = await ctx.db.execute({
    sql: `SELECT unit, sanity_min_cents, sanity_max_cents
          FROM market.item_key_mapping
          WHERE item_key = ? AND deprecated_at IS NULL`,
    args: [itemKey],
  });
  if (itemRow.rows.length === 0) {
    return reject(`unknown or deprecated item_key '${itemKey}'`);
  }
  const expectedUnit = String(itemRow.rows[0].unit);
  const sanityMin =
    itemRow.rows[0].sanity_min_cents == null ? null : Number(itemRow.rows[0].sanity_min_cents);
  const sanityMax =
    itemRow.rows[0].sanity_max_cents == null ? null : Number(itemRow.rows[0].sanity_max_cents);

  // Lookup retailer
  const retailerRow = await ctx.db.execute({
    sql: "SELECT id, base_url FROM market.retailers WHERE slug = ? AND active = true",
    args: [retailerSlug],
  });
  if (retailerRow.rows.length === 0) {
    return reject(`unknown or inactive retailer slug '${retailerSlug}'`);
  }
  const retailerId = String(retailerRow.rows[0].id);
  const retailerHost = parseHost(String(retailerRow.rows[0].base_url));
  const submittedHost = parseHost(productUrl);

  // Stage 1 — defect: unit mismatch
  if (unitPriceUnit !== expectedUnit) {
    return rejectAsDefect({
      itemKey,
      retailerId,
      findingKind: "unit_mismatch",
      reason: `unit_price_unit '${unitPriceUnit}' does not match item_key.unit '${expectedUnit}'`,
      submittedPriceCents: unitPriceCents,
      submittedUnit: unitPriceUnit,
      productUrl,
      potentialCredits: 0,
    });
  }

  // Stage 1 — defect: hostname mismatch
  if (
    !submittedHost ||
    !retailerHost ||
    !(submittedHost === retailerHost || submittedHost.endsWith("." + retailerHost))
  ) {
    return rejectAsDefect({
      itemKey,
      retailerId,
      findingKind: "url_invalid",
      reason: `product_url host '${submittedHost ?? "?"}' does not match retailer '${retailerSlug}' (${retailerHost ?? "?"})`,
      submittedPriceCents: unitPriceCents,
      submittedUnit: unitPriceUnit,
      productUrl,
      potentialCredits: 0,
    });
  }

  // Stage 1 — defect: sanity range
  if (sanityMin != null && unitPriceCents < sanityMin) {
    return rejectAsDefect({
      itemKey,
      retailerId,
      findingKind: "sanity_range",
      reason: `unit_price ${unitPriceCents}c below sanity floor ${sanityMin}c for ${itemKey}`,
      submittedPriceCents: unitPriceCents,
      submittedUnit: unitPriceUnit,
      productUrl,
      potentialCredits: 0,
    });
  }
  if (sanityMax != null && unitPriceCents > sanityMax) {
    return rejectAsDefect({
      itemKey,
      retailerId,
      findingKind: "sanity_range",
      reason: `unit_price ${unitPriceCents}c above sanity ceiling ${sanityMax}c for ${itemKey}`,
      submittedPriceCents: unitPriceCents,
      submittedUnit: unitPriceUnit,
      productUrl,
      potentialCredits: 0,
    });
  }

  // Stage 1 — URL HEAD check (last because it's the slowest)
  const head = await (ctx.fetchHead ?? defaultFetchHead)(productUrl);
  if (!head.ok) {
    return rejectAsDefect({
      itemKey,
      retailerId,
      findingKind: "url_invalid",
      reason: `product_url HEAD returned HTTP ${head.status}`,
      submittedPriceCents: unitPriceCents,
      submittedUnit: unitPriceUnit,
      productUrl,
      potentialCredits: 0,
    });
  }

  const draftObs: PriceObservationDraft = {
    itemKey,
    retailerSlug,
    retailerId,
    productName,
    productEan: ean,
    productUrl,
    priceCents,
    unitPriceCents,
    unitPriceUnit,
    inStock,
  };

  // ── Stage 2 (consensus) ──────────────────────────────────────────
  const recent = await ctx.db.execute({
    sql: `SELECT po.unit_price_cents
          FROM market.price_observations po
          JOIN market.item_key_product_links l
            ON l.product_id = po.product_id
           AND l.retailer_id = po.retailer_id
           AND l.deprecated_at IS NULL
          WHERE l.item_key = ?
            AND l.retailer_id = ?
            AND po.observed_at >= now() - INTERVAL '${PRICE_OBS_CLUSTER_DAYS} days'
            AND po.unit_price_cents IS NOT NULL
          ORDER BY po.observed_at DESC
          LIMIT ${PRICE_OBS_CLUSTER_LIMIT}`,
    args: [itemKey, retailerId],
  });

  if (recent.rows.length === 0) {
    // Cold start — defer for curator review, but persist the observation
    // so subsequent submissions have a cluster to validate against.
    return {
      accept: true,
      defer: true,
      credits: 0,
      notes: `cold_start: first observation for (${itemKey}, ${retailerSlug}); deferred for curator review`,
      priceObservation: draftObs,
      priceDefect: {
        itemKey,
        retailerId,
        findingKind: "cold_start",
        reason: `first observation for (${itemKey}, ${retailerSlug}); curator confirm before subsequent observations earn full credit`,
        submittedPriceCents: unitPriceCents,
        submittedUnit: unitPriceUnit,
        productUrl,
        potentialCredits: WORK_REWARDS.price_observation_mining,
      },
    };
  }

  const prices = recent.rows
    .map((r) => Number(r.unit_price_cents))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const lower = median * (1 - PRICE_OBS_TOLERANCE);
  const upper = median * (1 + PRICE_OBS_TOLERANCE);

  if (unitPriceCents < lower || unitPriceCents > upper) {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: `outlier: ${unitPriceCents}c outside ±${PRICE_OBS_TOLERANCE * 100}% of median ${median}c (n=${prices.length} over ${PRICE_OBS_CLUSTER_DAYS}d)`,
      priceDefect: {
        itemKey,
        retailerId,
        findingKind: "outlier_price",
        reason: `submitted ${unitPriceCents}c/${unitPriceUnit} outside ±${PRICE_OBS_TOLERANCE * 100}% of running median ${median}c (n=${prices.length} over ${PRICE_OBS_CLUSTER_DAYS}d)`,
        submittedPriceCents: unitPriceCents,
        submittedUnit: unitPriceUnit,
        productUrl,
        potentialCredits: 0,
      },
    };
  }

  return {
    accept: true,
    defer: false,
    credits: WORK_REWARDS.price_observation_mining,
    notes: `consensus accepted: ${unitPriceCents}c/${unitPriceUnit} within ±${PRICE_OBS_TOLERANCE * 100}% of median ${median}c (n=${prices.length})`,
    priceObservation: draftObs,
  };
}

function rejectAsDefect(defect: PriceObservationDefectDraft): ValidationResult {
  return {
    accept: false,
    defer: false,
    credits: 0,
    notes: defect.reason,
    priceDefect: defect,
  };
}

function parseHost(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function defaultFetchHead(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    const r = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function accept(credits: number, notes: string): ValidationResult {
  return { accept: true, defer: false, credits, notes };
}

function reject(notes: string): ValidationResult {
  return { accept: false, defer: false, credits: 0, notes };
}
