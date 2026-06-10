/**
 * First-principles dependency gate for PACT consensus (#2888).
 *
 * A topic may only be PROMOTED to consensus when every topic it
 * `builds_on` is itself verified — and a consensus topic whose
 * dependency later loses verification must be DEMOTED back to open.
 * Axiom-tier topics are exempt: they are ground truth and do not build
 * on other topics.
 *
 * Both call sites in db.ts (auto-merge promotion loop + consensus
 * re-evaluation loop) were bootstrap-disabled with hardcoded `true`
 * from the graph's first seeding until #2888 re-enabled them
 * (pre-flight blast radius: zero affected topics).
 */

/**
 * Topic statuses that count as "verified" when resolving whether a
 * dependency is met. Must stay in sync with the SQL `NOT IN (...)`
 * lists in db.ts's unmetDependencies subqueries AND the verified-set
 * used by the facts API (db.ts ~line 1242) — `locked` is the terminal
 * verified state and was missing from the dependency subqueries until
 * #2888.
 */
export const VERIFIED_TOPIC_STATUSES = ["consensus", "stable", "locked"] as const;

export function dependencyGateOk(tier: string | null | undefined, unmetDeps: number): boolean {
  return tier === "axiom" || unmetDeps === 0;
}
