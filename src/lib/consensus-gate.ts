/**
 * First-principles dependency gate for PACT consensus (#2888, reshaped by
 * #3691 Wave 1).
 *
 * A topic may only be PROMOTED to consensus when every topic it depends on
 * is itself verified — and a consensus topic whose dependency later loses
 * verification must be DEMOTED back to open.
 *
 * #3691 removed the former axiom-tier exemption: no node is ground truth,
 * so no node reaches consensus over an unmet dependency. A convention-stop
 * node (the Axis-B flag marking where a community agreed to stop digging)
 * is gated exactly like every other node; foundational nodes are protected
 * by blast-radius-scaled reopen quorum and staking, never by immunity.
 */

/**
 * Topic statuses that count as "verified" when resolving whether a
 * dependency is met. Must stay in sync with the SQL `NOT IN (...)`
 * lists in db.ts's unmetDependencies subqueries AND the verified-set
 * used by the facts API — `locked` is the terminal verified state and
 * was missing from the dependency subqueries until #2888.
 */
export const VERIFIED_TOPIC_STATUSES = ["consensus", "stable", "locked"] as const;

/**
 * The first parameter is retained for call-site stability and so the
 * floor-removal is directly assertable: dependencyGateOk(anything, 1) is
 * false for EVERY first argument. It no longer influences the result.
 */
export function dependencyGateOk(_warrantOrTier: string | null | undefined, unmetDeps: number): boolean {
  return unmetDeps === 0;
}
