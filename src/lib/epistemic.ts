/**
 * Two-axis epistemic model (#3691 Wave 1).
 *
 * Axis A — warrant kind: HOW a claim is justified. Four genuine, unordered
 * kinds — there is deliberately no ordering over them and no "axiom" kind.
 * "Axiomatic-by-convention" is not a way of being justified; it is the place
 * a community agreed to stop digging — a consensus ROLE carried on Axis B as
 * the convention_stop flag, composable with any warrant kind.
 *
 * Axis B — consensus state + credence + convention-stop flag: WHERE the
 * community currently stands on the claim. Every state is re-openable via
 * the challenge machinery; nothing is terminal, nothing is immune.
 */

export const WARRANT_KINDS = ["empirical", "institutional", "interpretive", "conjectural"] as const;
export type WarrantKind = (typeof WARRANT_KINDS)[number];

// tier column value → warrant kind. The legacy "axiom" value reads as
// institutional; initSchema() migrates stored rows (tier → institutional,
// convention_stop = 1, provenance in tier_migrated_from), so this mapping
// only matters for in-flight values.
const TIER_TO_WARRANT: Record<string, WarrantKind> = {
  axiom: "institutional",
  empirical: "empirical",
  institutional: "institutional",
  interpretive: "interpretive",
  conjecture: "conjectural",
  // pre-canonicalizeTier legacy spellings
  convention: "empirical",
  practice: "empirical",
  policy: "institutional",
  frontier: "conjectural",
};

export function warrantKindFromTier(tier: string | null | undefined): WarrantKind {
  return TIER_TO_WARRANT[tier ?? ""] ?? "empirical";
}

/** warrant kind → the tier column value used in SQL filters; null if unknown. */
export function tierFromWarrantKind(warrant: string): string | null {
  const map: Record<string, string> = {
    empirical: "empirical",
    institutional: "institutional",
    interpretive: "interpretive",
    conjectural: "conjecture",
  };
  return map[warrant] ?? null;
}

/**
 * Axis-B user-facing consensus state over the internal status column:
 * open → contested → aligned → verified (plus the pre-open "proposed").
 */
export function consensusStateFor(status: string | null | undefined): string {
  switch (status) {
    case "challenged":
      return "contested";
    case "consensus":
      return "aligned";
    case "stable":
    case "locked":
      return "verified";
    case "proposed":
      return "proposed";
    default:
      return "open";
  }
}

// ── Credence (Axis B) ────────────────────────────────────────────────
// Credence is an explicit transform of the alignment/consensus ratio, NOT
// the ratio itself. Cromwell's rule: no live claim reaches credence 1.0 —
// unanimity today is still revisable tomorrow. The transform scales the
// honest ratio by an asymptote strictly below 1, so 1.0 is unreachable BY
// CONSTRUCTION of the transform; the raw ratio is reported alongside,
// never clamped or misstated.
export const CREDENCE_ASYMPTOTE = 0.99;

export function credenceFromRatio(ratio: number | null | undefined): number {
  const r = typeof ratio === "number" && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  return r * CREDENCE_ASYMPTOTE;
}

// ── Typed defeaters (#3691 Wave 4) ───────────────────────────────────
// A challenge names HOW the claim fails. `reopen-convention` is the
// challenge to a convention-stop node itself: "I move that we stop
// stopping here" (the CGPM-kilogram transition). The existing
// challenge-proposal + evaluateChallenges vote loop stays the resolution
// engine — this taxonomy only types the attack.
export const DEFEATER_TYPES = [
  "counter-evidence",
  "broken-assumption",
  "scope-violation",
  "bundling",
  "warrant-mismatch",
  "reopen-convention",
] as const;
export type DefeaterType = (typeof DEFEATER_TYPES)[number];

const DEFEATER_MIN_SUBSTANCE = 20;
// Modelled on the first-principles gate's anti-lazy patterns
// ([topicId]/dependencies/route.ts): a challenge must be structural, not
// vibes.
const DEFEATER_LAZY_PATTERNS = [
  /^(this|that|it) (is|seems|looks) (wrong|false|bad|incorrect|outdated)\.?$/i,
  /\bi (just )?(disagree|don'?t (like|agree|believe))\b/i,
  /\b(obviously|clearly|everyone knows)\b/i,
  /^(wrong|false|no|bad|disagree|challenge)[.!]?$/i,
];

export interface DefeaterValidation {
  valid: boolean;
  error?: string;
  hint?: string;
}

export function validateDefeater(defeaterType: unknown, substance: string): DefeaterValidation {
  if (typeof defeaterType !== "string" || !DEFEATER_TYPES.includes(defeaterType as DefeaterType)) {
    return {
      valid: false,
      error: `defeaterType is required for a challenge — one of: ${DEFEATER_TYPES.join(", ")}.`,
      hint: "Name HOW the claim fails: counter-evidence (contrary observation/source), broken-assumption (a premise it assumes is defeated), scope-violation (true only under conditions the claim omits), bundling (multiple propositions in one node), warrant-mismatch (justified as the wrong kind), reopen-convention (move to stop stopping here — for convention-stop nodes).",
    };
  }
  const s = substance?.trim() ?? "";
  if (s.length < DEFEATER_MIN_SUBSTANCE) {
    return {
      valid: false,
      error: `Challenge summary is too short (${s.length} chars). Explain in at least ${DEFEATER_MIN_SUBSTANCE} characters what specifically defeats the claim.`,
    };
  }
  for (const p of DEFEATER_LAZY_PATTERNS) {
    if (p.test(s)) {
      return {
        valid: false,
        error: "Challenge summary is generic disagreement. A defeater must be structural: name the observation, the defeated premise, the omitted scope condition, or the bundled propositions.",
      };
    }
  }
  return { valid: true };
}

/**
 * Token-Jaccard similarity used to coalesce near-identical open defeaters
 * into one thread (anti-brigade): a duplicate challenge is redirected to
 * add its support vote to the existing thread instead of fragmenting it.
 */
export function challengeSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / (ta.size + tb.size - overlap);
}

export const CHALLENGE_COALESCE_THRESHOLD = 0.6;

// ── Defeasible propagation (#3691 Wave 3) ────────────────────────────
// Effective credence is DERIVED on every consensus sweep from the current
// dependency frontier — a recompute, not a latched penalty, so recovery of
// a dependency self-heals its dependents (P3). A defeated `assumes` premise
// guts a dependent (collapse toward ASSUMES_COLLAPSE_FACTOR); a defeated
// `builds_on` support weakens it (attenuate toward
// BUILDS_ON_ATTENUATION_FACTOR). Dependents are never deleted or asserted
// false — credence is floored, not zeroed (P2).
export const ASSUMES_COLLAPSE_FACTOR = 0.25;
export const BUILDS_ON_ATTENUATION_FACTOR = 0.6;
export const CREDENCE_FLOOR = 0.02;

export interface CredenceNode {
  id: string;
  /** credenceFromRatio(current alignment ratio) — the node's own standing */
  base: number;
  /** true when the node is outside the verified statuses (defeat(d)) */
  defeated: boolean;
}

export interface CredenceEdge {
  topicId: string;
  dependsOn: string;
  relationship: string; // "builds_on" | "assumes"
}

/**
 * Pure, DB-free effective-credence computation over the (acyclic)
 * dependency graph. Transitive by construction: each edge factor
 * interpolates on the dependency's own effective health, so a defeat deep
 * in the chain attenuates everything above it (P1), and recovery
 * re-strengthens on the next recompute (P3). Termination is guaranteed by
 * the acyclicity the first-principles gate enforces at edge creation; a
 * belt-and-braces visited guard stops any pathological cycle.
 */
export function computeEffectiveCredences(
  nodes: CredenceNode[],
  edges: CredenceEdge[]
): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depsOf = new Map<string, CredenceEdge[]>();
  for (const e of edges) {
    if (!byId.has(e.topicId) || !byId.has(e.dependsOn)) continue;
    const list = depsOf.get(e.topicId) ?? [];
    list.push(e);
    depsOf.set(e.topicId, list);
  }

  const memo = new Map<string, number>();
  const inProgress = new Set<string>();

  const effective = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node) return 1;
    if (inProgress.has(id)) return node.base;
    inProgress.add(id);
    let value = node.base;
    for (const e of depsOf.get(id) ?? []) {
      const dep = byId.get(e.dependsOn);
      if (!dep) continue;
      if (!dep.defeated) continue; // healthy dependency: no attenuation
      const depHealth = Math.max(0, Math.min(1, effective(e.dependsOn) / CREDENCE_ASYMPTOTE));
      const floor = e.relationship === "assumes" ? ASSUMES_COLLAPSE_FACTOR : BUILDS_ON_ATTENUATION_FACTOR;
      value *= floor + (1 - floor) * depHealth;
    }
    inProgress.delete(id);
    const result = node.base > 0 ? Math.max(value, CREDENCE_FLOOR) : 0;
    memo.set(id, result);
    return result;
  };

  for (const n of nodes) effective(n.id);
  return memo;
}
