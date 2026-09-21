/**
 * tailor-group#37 — unique section ids per document.
 *
 * An amending Act's schedule can amend one section of a principal Act many
 * times ("308 Amendment of ..." five times over), and the parsers emit one
 * section per heading occurrence. `normalizeLegislationDocuments` rejects a
 * document whose sectionIds repeat, so every batch carrying such an Act was
 * discarded whole. The rule here is shared by both parsers: the first
 * occurrence keeps its id, later ones carry a deterministic ordinal suffix
 * ("s 308", "s 308 [2]", "s 308 [3]", ...). Nothing is dropped and the
 * `order` values are untouched.
 */
export function uniqueSectionIds<T extends { sectionId: string }>(sections: readonly T[]): T[] {
  const seen = new Map<string, number>();
  const taken = new Set(sections.map((section) => section.sectionId));
  return sections.map((section) => {
    const count = (seen.get(section.sectionId) ?? 0) + 1;
    seen.set(section.sectionId, count);
    if (count === 1) return section;
    let ordinal = count;
    let candidate = `${section.sectionId} [${ordinal}]`;
    // A literal "s 308 [2]" heading is not expected, but never collide with one.
    while (taken.has(candidate)) candidate = `${section.sectionId} [${++ordinal}]`;
    taken.add(candidate);
    return { ...section, sectionId: candidate };
  });
}
