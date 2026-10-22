/**
 * #1152 Round 3a — Scenario predicate matcher.
 *
 * Deterministic set-intersection scoring: the more of a scenario's required
 * predicates a caller supplies, and the fewer conflicting values, the higher
 * the confidence. Weights are fully data-driven — no hard-coded scenario
 * knowledge lives here.
 */
import type { Scenario } from "./types";

export interface PredicateMatch {
  scenarioId: string;
  title: string;
  confidence: number; // 0..1
  matchedPredicates: string[];
  missingPredicates: string[];
  conflictingPredicates: { key: string; scenarioValue: unknown; callerValue: unknown }[];
}

/**
 * Predicate equality rules:
 * - Exact match (after JSON-normalise for primitives) → match.
 * - "!X" on either side means "not equal X" — matches if caller value != X.
 * - Unknown keys (not in scenario) are ignored — callers are allowed to over-specify.
 * - Missing keys (in scenario, not in caller) are neither match nor conflict —
 *   they go into `missingPredicates` and depress the confidence.
 */
function predicateEquals(scnVal: unknown, callerVal: unknown): "match" | "conflict" {
  if (typeof scnVal === "string" && scnVal.startsWith("!")) {
    const forbidden = scnVal.slice(1);
    return callerVal === forbidden ? "conflict" : "match";
  }
  if (typeof callerVal === "string" && callerVal.startsWith("!")) {
    const forbidden = callerVal.slice(1);
    return scnVal === forbidden ? "conflict" : "match";
  }
  if (Array.isArray(scnVal) && Array.isArray(callerVal)) {
    return scnVal.some((v) => callerVal.includes(v)) ? "match" : "conflict";
  }
  return scnVal === callerVal ? "match" : "conflict";
}

export function matchScenarios(
  scenarios: Pick<Scenario, "id" | "title" | "predicates">[],
  callerPredicates: Record<string, unknown>,
): PredicateMatch[] {
  const results: PredicateMatch[] = [];
  for (const scn of scenarios) {
    const scnKeys = Object.keys(scn.predicates ?? {});
    if (scnKeys.length === 0) continue;

    const matched: string[] = [];
    const missing: string[] = [];
    const conflicting: { key: string; scenarioValue: unknown; callerValue: unknown }[] = [];

    for (const key of scnKeys) {
      if (!(key in callerPredicates)) {
        missing.push(key);
        continue;
      }
      const outcome = predicateEquals(scn.predicates[key], callerPredicates[key]);
      if (outcome === "match") matched.push(key);
      else conflicting.push({ key, scenarioValue: scn.predicates[key], callerValue: callerPredicates[key] });
    }

    if (matched.length === 0) continue; // not a candidate at all

    // Confidence model: matched / total, with a hard penalty for conflicts.
    const raw = matched.length / scnKeys.length;
    const conflictPenalty = Math.min(conflicting.length * 0.3, 0.9);
    const confidence = Math.max(0, raw - conflictPenalty);

    if (confidence <= 0) continue;

    results.push({
      scenarioId: scn.id,
      title: scn.title,
      confidence: Number(confidence.toFixed(3)),
      matchedPredicates: matched,
      missingPredicates: missing,
      conflictingPredicates: conflicting,
    });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}
