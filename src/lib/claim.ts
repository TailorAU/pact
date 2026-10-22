/**
 * Atomic-claim discipline — "the Twitter Rule" (#3691 Wave 2).
 *
 * The canonical claim is the unit of the graph: ONE atomic, checkable
 * proposition, at most CANONICAL_CLAIM_MAX characters. The cap
 * externalizes conditions rather than stripping them — qualifiers evicted
 * from prose belong on `assumes` edges, the typed scope fields
 * (jurisdiction/authority/effective_date/expiry_date), and source_ref,
 * where the first-principles gate governs them. Brevity surfaces the
 * assumption; the graph holds it; refutation targets exactly one
 * proposition (Brandolini inverted).
 */

/** Single tunable cap on the canonical claim (Twitter-original discipline). */
export const CANONICAL_CLAIM_MAX = 140;

/**
 * Optional supporting line: plain context that carries NO conditions and is
 * excluded from every validator.
 */
export const CLAIM_SUPPORT_MAX = 280;

export type ClaimAtomicityStatus = "atomic" | "needs_split" | "legacy_unchecked";

export interface ClaimLintResult {
  ok: boolean;
  /** hard failure — reject with 422 */
  error?: string;
  hint?: string;
  /** soft signals — accepted, but the condition likely belongs on an edge */
  warnings: string[];
}

// Conjunction bundling: a top-level "and/or" joining two verb-bearing
// clauses. Heuristic: ", and"/"; and"/" and " followed by text containing
// another finite verb-ish token. Kept deliberately simple + documented —
// the goal is to catch "X and Y and Z" bundles, not parse English.
const CLAUSE_CONJUNCTION = /\b(?:and|or)\b/i;
const VERB_HINT = /\b(?:is|are|was|were|has|have|had|does|do|did|can|cannot|must|shall|should|will|would|may|might|equals|contains|requires|prohibits|permits|applies|boils|melts|freezes|rises|falls|exceeds|measures|weighs|holds|states|provides|mandates|forbids|bans|allows|increased|decreased|causes|caused)\b/i;

// Motte-and-bailey hedges: retreat-ready qualifiers that make the claim
// unfalsifiable as stated.
const HEDGE_PATTERNS = [
  /\barguably\b/i,
  /\bsome (?:might|may|would) (?:say|argue|claim)\b/i,
  /\bit could be (?:said|argued)\b/i,
  /\bin some sense\b/i,
  /\bmore or less\b/i,
  /\bbasically\b/i,
  /\bsort of\b|\bkind of\b/i,
];

// Embedded conditions that belong on `assumes` edges or scope fields.
const EDGE_CONDITION_PATTERNS = [
  /\bassuming\b/i,
  /\bprovided that\b/i,
  /\bas long as\b/i,
  /\bunless\b/i,
  /\bexcept (?:when|where|if)\b/i,
  /\bif\b[^.]*\bthen\b/i,
];

/**
 * Lint one canonical claim for atomicity. Universal — no tier or
 * jurisdiction exemption: atomicity is a property of the proposition, not
 * of how it is warranted.
 */
export function lintAtomicClaim(claim: string): ClaimLintResult {
  const warnings: string[] = [];
  const text = claim.trim();

  if (text.length === 0) {
    return { ok: false, error: "canonicalClaim is required — the single atomic proposition this node asserts.", warnings };
  }
  if (text.length > CANONICAL_CLAIM_MAX) {
    return {
      ok: false,
      error: `canonicalClaim must be at most ${CANONICAL_CLAIM_MAX} characters (got ${text.length}). The cap externalizes conditions — it never strips them.`,
      hint: "Move qualifiers onto the graph: scope conditions become `assumes` edges (POST /api/pact/{topicId}/dependencies), jurisdictional scope goes in jurisdiction/authority/effective_date, citations in sourceRef, plain context in claimSupport.",
      warnings,
    };
  }

  // Multi-sentence: more than one terminal punctuation followed by more text.
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 1) {
    return {
      ok: false,
      error: "canonicalClaim must be a single sentence — one atomic, checkable proposition.",
      hint: "Split each additional sentence into its own topic and relate them with builds_on/assumes edges.",
      warnings,
    };
  }

  // Bundled conjunction of clauses: "X and Y" where both sides carry verbs.
  const conjMatch = text.match(CLAUSE_CONJUNCTION);
  if (conjMatch && conjMatch.index !== undefined) {
    const before = text.slice(0, conjMatch.index);
    const after = text.slice(conjMatch.index + conjMatch[0].length);
    if (VERB_HINT.test(before) && VERB_HINT.test(after)) {
      return {
        ok: false,
        error: "canonicalClaim bundles multiple propositions (a top-level conjunction joins two verb-bearing clauses). One node = one checkable claim.",
        hint: "File each proposition as its own topic; express their relationship as builds_on/assumes edges.",
        warnings,
      };
    }
  }

  for (const p of HEDGE_PATTERNS) {
    if (p.test(text)) {
      return {
        ok: false,
        error: "canonicalClaim carries a motte-and-bailey hedge — as stated it cannot be cleanly refuted.",
        hint: "State the strong form you actually want verified. Uncertainty lives in the credence, not in the wording.",
        warnings,
      };
    }
  }

  for (const p of EDGE_CONDITION_PATTERNS) {
    if (p.test(text)) {
      warnings.push(
        "The claim embeds a condition that likely belongs on the graph — declare it as an `assumes` edge (or scope field) so the first-principles gate governs it."
      );
      break;
    }
  }

  return { ok: true, warnings };
}

/** Classifier used by the read-only backfill (#3691 W6). Never truncates. */
export function classifyClaimAtomicity(claim: string | null | undefined): ClaimAtomicityStatus {
  if (!claim || claim.trim().length === 0) return "legacy_unchecked";
  return lintAtomicClaim(claim).ok ? "atomic" : "needs_split";
}
