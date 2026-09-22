/**
 * pact#28 ask-2 — designation-aware tokenisation + exact-title ranking
 * primitives for the legislation search surface.
 *
 * Pure, deterministic, DB-free — unit-tested in isolation
 * (legislation-ranking.test.ts) and consumed by:
 *   - GET /api/axiom/legislation/search  (ranking + tokenisation)
 *   - GET /api/axiom/resolve             (exact-title-first citation resolution)
 *
 * Live defects this module fixes (observed 2026-07-13 on pact.tailor.au):
 *   1. "AS/NZS 4308" tokenised to ["nzs","4308"] — the designation itself was
 *      never a searchable/scorable token, so standards topics could not be
 *      matched or ranked on their designation.
 *   2. "Privacy Act 1988" ranked the QLD Coal Mining Safety and Health Act's
 *      BODY-TEXT mentions above the actual Privacy Act topic nodes — an exact
 *      or near-exact TITLE match must always dominate body-text fuzzy hits.
 *   3. "Coal Mining Safety and Health Regulation 2017" ranked the Act above
 *      the Regulation (qld/reg-2017-165) — same root cause as (2).
 */

// ── Standards designations ───────────────────────────────────────────────────

export interface DesignationToken {
  /** Raw text as matched in the query, e.g. "AS/NZS 4308:2008". */
  raw: string;
  /** Canonical lowercase body+number, e.g. "as/nzs 4308" — the searchable token. */
  canonical: string;
  /** Standards body, uppercase, e.g. "AS/NZS", "ISO". */
  body: string;
  /** Numeric designation, e.g. "4308". */
  number: string;
  /** Optional edition year, e.g. "2008". Null when the query omits it. */
  year: string | null;
}

/**
 * Longest search query / citation the ranking surfaces accept (characters).
 * Legislation titles and citations are far shorter; the cap bounds the work
 * any single request can ask of the tokeniser. Routes reject longer input
 * with 400 before it reaches this module (tailor-group#7, CodeQL
 * js/polynomial-redos).
 */
export const MAX_QUERY_LENGTH = 512;

// Multi-letter bodies match case-insensitively (unambiguous). Two-letter
// bodies ("AS", "EN", "BS") must be uppercase in the query — lowercase "as"
// is an English word and would false-positive ("known as 4308").
//
// The body/number separator is `\s*(?:-\s*)?`: optional whitespace, then an
// optional hyphen with its trailing whitespace. It accepts exactly the
// strings the former `\s*[- ]?\s*` did (the optional space was already
// covered by `\s*`), but has only one way to match each whitespace run, so a
// failed match backtracks linearly instead of quadratically ("ISO" followed by
// thousands of spaces and no number) — tailor-group#7, js/polynomial-redos.
const DESIGNATION_RE_CI =
  /\b(AS\/NZS|ISO\/IEC|NZS|ISO|IEC|ASTM)\s*(?:-\s*)?(\d{2,6})(?::(\d{4}))?\b/gi;
const DESIGNATION_RE_UPPER = /\b(AS|EN|BS)\s*(?:-\s*)?(\d{2,6})(?::(\d{4}))?\b/g;

/** Extract standards designations (AS/NZS 4308, ISO 45001:2018, …) from a query. */
export function extractDesignations(query: string): DesignationToken[] {
  const out: DesignationToken[] = [];
  const seen = new Set<string>();
  const collect = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(query)) !== null) {
      const body = m[1].toUpperCase();
      const number = m[2];
      const year = m[3] ?? null;
      const canonical = `${body.toLowerCase()} ${number}`;
      const key = `${canonical}:${year ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ raw: m[0], canonical, body, number, year });
    }
  };
  // Case-insensitive multi-letter bodies first so "AS/NZS 4308" is claimed by
  // the AS/NZS alternative before the uppercase-only "AS" pattern sees it —
  // then drop uppercase-only hits that fall inside an already-claimed span.
  collect(DESIGNATION_RE_CI);
  const claimed = out.map((d) => d.canonical.split(" ")[1]);
  DESIGNATION_RE_UPPER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DESIGNATION_RE_UPPER.exec(query)) !== null) {
    const body = m[1].toUpperCase();
    const number = m[2];
    const year = m[3] ?? null;
    if (claimed.includes(number)) continue; // e.g. the "AS" inside "AS/NZS 4308"
    const canonical = `${body.toLowerCase()} ${number}`;
    const key = `${canonical}:${year ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: m[0], canonical, body, number, year });
  }
  return out;
}

// ── Tokenisation ─────────────────────────────────────────────────────────────

/**
 * Tokenise a search query into scoring/matching keywords.
 *
 * Preserves the pre-existing behaviour (lowercase, alphanumeric words of
 * 3+ chars) and ADDS the canonical designation of any standards reference as
 * a first-class token, so "AS/NZS 4308" yields ["nzs", "4308", "as/nzs 4308"]
 * instead of losing the designation to punctuation stripping.
 */
export function tokenizeQuery(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const designations = extractDesignations(query);
  const tokens = [...words];
  for (const d of designations) {
    if (!tokens.includes(d.canonical)) tokens.push(d.canonical);
  }
  return tokens;
}

// ── Exact / near-exact title matching ────────────────────────────────────────

export type TitleMatchTier = "exact" | "near-exact" | "none";

/**
 * Boosts are deliberately far above any achievable body-text fuzzy score
 * (content occurrences score +1 each; titles +3 per keyword) so a title
 * match ALWAYS dominates body-text matches, per the pact#28 contract.
 */
export const TITLE_TIER_BOOST: Record<TitleMatchTier, number> = {
  exact: 10_000,
  "near-exact": 5_000,
  none: 0,
};

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Replace each parenthetical — "(" up to the next ")" — with a space.
 *
 * A linear scan with the same result as `s.replace(/\([^)]*\)/g, " ")`
 * (inner "(" belong to the enclosing match; an unclosed "(" is left as is).
 * The regex form rescanned to the end of the string from every unclosed "(",
 * which is quadratic on input like "((((…" (tailor-group#7,
 * js/polynomial-redos). Once no ")" follows an "(", none follows any later
 * "(" either, so the scan stops there.
 */
export function stripParentheticals(s: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = s.indexOf("(", from);
    if (open === -1) break;
    const close = s.indexOf(")", open + 1);
    if (close === -1) break;
    out += s.slice(from, open) + " ";
    from = close + 1;
  }
  return out + s.slice(from);
}

/**
 * Classify how a query matches a title.
 *
 *   exact       — normalized equality, or equality once parentheticals
 *                 (jurisdiction suffixes like "(Cth)") are stripped from
 *                 either side. "Privacy Act 1988" ≡ "Privacy Act 1988 (Cth)".
 *   near-exact  — one is a whole-word PREFIX of the other. Covers topic
 *                 claim-sentence titles ("Privacy Act 1988 (Cth) establishes
 *                 13 Australian Privacy Principles…") for the citation query
 *                 "Privacy Act 1988". Requires the query to be ≥ 2 words so a
 *                 one-word query ("act") can never claim a prefix tier.
 *   none        — anything else. Body-text matches never reach this function.
 */
export function titleMatchTier(query: string, title: string): TitleMatchTier {
  const q = normalize(query);
  const t = normalize(title);
  if (!q || !t) return "none";

  if (q === t) return "exact";
  const qStripped = normalize(stripParentheticals(query));
  const tStripped = normalize(stripParentheticals(title));
  if (qStripped && tStripped && qStripped === tStripped) return "exact";

  // Prefix tiers require a multi-word query (citation-shaped, not a bare word).
  if (q.split(" ").length < 2) return "none";
  if (t.startsWith(`${q} `) || q.startsWith(`${t} `)) return "near-exact";
  if (
    qStripped &&
    tStripped &&
    (tStripped.startsWith(`${qStripped} `) || qStripped.startsWith(`${tStripped} `))
  ) {
    return "near-exact";
  }
  return "none";
}

/** Highest title-tier boost across a set of candidate titles. */
export function titleMatchBoost(query: string, ...titles: (string | null | undefined)[]): number {
  let best = 0;
  for (const title of titles) {
    if (!title) continue;
    const boost = TITLE_TIER_BOOST[titleMatchTier(query, title)];
    if (boost > best) best = boost;
  }
  return best;
}

/**
 * Designation boost: +10 per extracted designation whose canonical form
 * appears in any of the candidate texts (title, section id, source_ref…);
 * +2 more when the query's edition year also matches. Sits above ordinary
 * keyword boosts (+3) but below the title tiers — a designation hit lifts
 * standards nodes over stray numeric matches without overriding an exact
 * title elsewhere.
 */
export function designationMatchBoost(
  designations: DesignationToken[],
  ...texts: (string | null | undefined)[]
): number {
  let score = 0;
  for (const d of designations) {
    const withYear = d.year ? `${d.canonical}:${d.year}` : null;
    for (const text of texts) {
      if (!text) continue;
      const lower = text.toLowerCase();
      if (lower.includes(d.canonical)) {
        score += 10;
        if (withYear && lower.includes(withYear)) score += 2;
        break; // count each designation once across the candidate texts
      }
    }
  }
  return score;
}

/**
 * Escape SQL LIKE wildcards in user text destined for a LIKE pattern.
 * (Postgres default escape char is backslash.)
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}
