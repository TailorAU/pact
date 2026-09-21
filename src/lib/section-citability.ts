/**
 * #5092 — section-id citability for the free legislation API, mirrored from
 * the Tailor-side #5083 fix (SourceLegislationResolver.IsCitableSectionId /
 * FormatRecordLocator) so both sides of the seam classify identically.
 *
 * A knowledge-graph `section_id` is a storage key, not automatically a legal
 * pinpoint. Ingestion splits a long instrument into fragments and keys them
 * `chunk-1`, `chunk-2`, …; composing those into the citation string served
 * to consumers ("Planning Act 2016 chunk-1") hands every non-Tailor consumer
 * an internal locator shaped as a legal citation — a reader who spots it
 * stops trusting the corpus.
 *
 * Non-citable shapes: missing/whitespace; a synthetic fragment key (any
 * `chunk` / `frag` / `fragment` / `segment` / `excerpt` / `extract` token,
 * bare or prefixed — `chunk-1` and `planning-act-2016-chunk-12` both match);
 * a raw GUID; or a parser ordinal suffix (`s 308 [2]`, tailor-group#37).
 * `s 10` / `Part 3` / `21A` / `Schedule 2` and friends are real pinpoints
 * and pass through untouched.
 */

// Mirror of the C# SyntheticSectionId regex (#5083): the token must stand
// alone at a non-letter boundary — "chunky" does not match.
const SYNTHETIC_SECTION_ID =
  /(?:^|[^a-z])(chunk|frag|fragment|segment|excerpt|extract)(?:[^a-z]|$)/i;

// The GUID shapes C#'s Guid.TryParse accepts that plausibly occur as storage
// keys: dashed UUID (optionally brace-wrapped) and the bare 32-hex "N" form.
const GUID_DASHED =
  /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const GUID_BARE = /^[0-9a-f]{32}$/i;

// tailor-group#37: the parsers keep every heading of an amending Act by
// suffixing a repeated id with a deterministic ordinal ("s 308", "s 308 [2]",
// "s 308 [3]", … — src/lib/legislation-section-ids.ts). The suffix is a
// storage disambiguator, not a locator a reader can look up in the Act, so
// the row is served like a chunk key: findable, cited at document level.
// The first occurrence keeps its bare id and stays a pinpoint. (The C#
// mirror of #5083 predates this shape.)
const ORDINAL_SUFFIX = /\s\[\d+\]$/;

export type SectionKind = "pinpoint" | "extract";

/** True iff the section id is a real, citable pinpoint. */
export function isCitableSectionId(
  sectionId: string | null | undefined
): boolean {
  if (!sectionId) return false;
  const trimmed = sectionId.trim();
  if (trimmed.length === 0) return false;
  if (SYNTHETIC_SECTION_ID.test(trimmed)) return false;
  if (GUID_DASHED.test(trimmed) || GUID_BARE.test(trimmed)) return false;
  if (ORDINAL_SUFFIX.test(trimmed)) return false;
  return true;
}

/** Machine-readable classification carried on every legislation search hit. */
export function sectionKindOf(
  sectionId: string | null | undefined
): SectionKind {
  return isCitableSectionId(sectionId) ? "pinpoint" : "extract";
}

/**
 * Compose the citable `sourceRef` for a legislation search hit.
 *
 * A citable section id keeps the pre-existing `"<short||doc> <id>"` shape
 * byte-identically. A non-citable one yields the DOC-level citation — no
 * section id appended, and no "(extract)" marker either: `sourceRef` must
 * remain a string a document can cite verbatim; the extract signal rides on
 * `sectionKind`.
 */
export function formatSourceRef(
  shortTitle: string | null | undefined,
  docTitle: string | null | undefined,
  sectionId: string | null | undefined
): string {
  const doc = (shortTitle || docTitle || "").trim();
  if (isCitableSectionId(sectionId)) {
    return `${doc} ${(sectionId as string).trim()}`;
  }
  return doc;
}
