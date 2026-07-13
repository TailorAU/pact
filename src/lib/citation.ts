/**
 * pact#28 ask-4 — deterministic citation parsing for GET /api/axiom/resolve.
 *
 * Pure and DB-free (unit-tested in citation.test.ts). Parses citations of
 * the shape:
 *
 *   <instrument name> [ (Cth|Qld|NSW|Vic|SA|WA|Tas|NT|ACT) ] [ s ###(#) ]
 *
 *   "Privacy Act 1988 (Cth) s 6(1)"
 *   "Coal Mining Safety and Health Regulation 2017"
 *   "Work Health and Safety Act 2011 (Qld) section 19"
 *   "AS/NZS 4308:2008"
 */

const JURISDICTION_MAP: Record<string, string> = {
  cth: "CTH",
  commonwealth: "CTH",
  qld: "QLD",
  queensland: "QLD",
  nsw: "NSW",
  vic: "VIC",
  victoria: "VIC",
  sa: "SA",
  wa: "WA",
  tas: "TAS",
  tasmania: "TAS",
  nt: "NT",
  act: "ACT",
};

export interface ParsedCitation {
  /** Instrument name with jurisdiction parenthetical + section suffix removed. */
  name: string;
  /** Normalised jurisdiction code (CTH/QLD/…) or null. */
  jurisdiction: string | null;
  /** Raw jurisdiction parenthetical as typed ("Cth"), or null. */
  jurisdictionRaw: string | null;
  /** Section reference as typed, e.g. "6(1)", "42", "19A". Null when absent. */
  section: string | null;
}

export function parseCitation(citation: string): ParsedCitation {
  let rest = citation.trim().replace(/\s+/g, " ");

  // Trailing section suffix: "s 6", "s. 6(1)", "sec 42", "section 19A".
  let section: string | null = null;
  const sectionMatch = rest.match(
    /(?:^|[\s,])(?:s|ss|sec|sect|section)\.?\s*(\d+[A-Za-z]{0,3}(?:\([0-9A-Za-z]+\))*)\s*$/i
  );
  if (sectionMatch) {
    section = sectionMatch[1];
    rest = rest.slice(0, rest.length - sectionMatch[0].length).trim();
  }

  // Jurisdiction parenthetical anywhere in the remaining text.
  let jurisdiction: string | null = null;
  let jurisdictionRaw: string | null = null;
  const jm = rest.match(
    /\((Cth|Commonwealth|Qld|Queensland|NSW|Vic|Victoria|SA|WA|Tas|Tasmania|NT|ACT)\.?\)/i
  );
  if (jm) {
    jurisdictionRaw = jm[1];
    jurisdiction = JURISDICTION_MAP[jm[1].toLowerCase()] ?? null;
    rest = (rest.slice(0, jm.index) + rest.slice((jm.index ?? 0) + jm[0].length))
      .replace(/\s+/g, " ")
      .trim();
  }

  return { name: rest.replace(/[\s,;]+$/, "").trim(), jurisdiction, jurisdictionRaw, section };
}

/** Does a legislation_docs / topics jurisdiction value satisfy a parsed hint? */
export function jurisdictionMatches(rowJurisdiction: unknown, hint: string | null): boolean {
  if (!hint) return true;
  const j = String(rowJurisdiction ?? "").toUpperCase();
  return j === hint || j === `AU-${hint}`;
}

/** DB jurisdiction code → citation parenthetical: AU-QLD → "Qld", CTH → "Cth". */
export function citationJurisdiction(rowJurisdiction: unknown): string | null {
  const j = String(rowJurisdiction ?? "").toUpperCase().replace(/^AU-/, "");
  if (!j || j === "AU") return null;
  if (j === "CTH") return "Cth";
  // All-caps conventional forms stay all-caps; the rest title-case.
  if (["NSW", "ACT", "NT", "SA", "WA"].includes(j)) return j;
  return j.charAt(0) + j.slice(1).toLowerCase();
}
