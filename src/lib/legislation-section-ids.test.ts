/**
 * tailor-group#37 — the shared section-id uniqueness rule.
 *
 * The first list is the id sequence parseActHtml produced from
 * cth/act-2026-082 (Combatting Illicit Tobacco Act 2026) on 21 Sep 2026,
 * which `normalizeLegislationDocuments` rejected as "must be unique within
 * the document" and took its whole five-document batch down with it.
 */
import { describe, expect, it } from "vitest";
import { normalizeLegislationDocuments } from "./legislation-ingest";
import { uniqueSectionIds } from "./legislation-section-ids";

const CAPTURED_IDS = [
  "s 1", "s 2", "s 3", "s 117C",
  "s 308", "s 308", "s 308", "s 308", "s 308",
  "s 228AA", "s 244A", "s 245A",
];

function sections(ids: readonly string[]) {
  return ids.map((sectionId, order) => ({ sectionId, content: `Text of ${sectionId} #${order}`, order }));
}

describe("uniqueSectionIds", () => {
  it("keeps the first occurrence and suffixes later ones in order", () => {
    const out = uniqueSectionIds(sections(CAPTURED_IDS));
    expect(out.map((s) => s.sectionId)).toEqual([
      "s 1", "s 2", "s 3", "s 117C",
      "s 308", "s 308 [2]", "s 308 [3]", "s 308 [4]", "s 308 [5]",
      "s 228AA", "s 244A", "s 245A",
    ]);
  });

  it("drops nothing and leaves order and content untouched", () => {
    const input = sections(CAPTURED_IDS);
    const out = uniqueSectionIds(input);
    expect(out).toHaveLength(input.length);
    expect(out.map((s) => s.order)).toEqual(input.map((s) => s.order));
    expect(out.map((s) => s.content)).toEqual(input.map((s) => s.content));
    expect(input.map((s) => s.sectionId)).toEqual(CAPTURED_IDS); // input not mutated
  });

  it("is a no-op on already-unique ids", () => {
    const input = sections(["s 1", "s 2", "s 2A"]);
    expect(uniqueSectionIds(input)).toEqual(input);
  });

  it("never collides with a literal suffixed id", () => {
    const out = uniqueSectionIds(sections(["s 308", "s 308", "s 308 [2]", "s 308"]));
    expect(out.map((s) => s.sectionId)).toEqual(["s 308", "s 308 [3]", "s 308 [2]", "s 308 [4]"]);
  });

  it("makes the captured cth/act-2026-082 id list pass ingest validation", () => {
    const rejected = () => normalizeLegislationDocuments([{
      id: "cth/act-2026-082",
      jurisdiction: "CTH",
      type: "act",
      title: "Combatting Illicit Tobacco Act 2026 (Cth)",
      sections: sections(CAPTURED_IDS),
    }]);
    expect(rejected).toThrow("Legislation payload validation failed");

    const [doc] = normalizeLegislationDocuments([{
      id: "cth/act-2026-082",
      jurisdiction: "CTH",
      type: "act",
      title: "Combatting Illicit Tobacco Act 2026 (Cth)",
      sections: uniqueSectionIds(sections(CAPTURED_IDS)),
    }]);
    expect(doc.sections).toHaveLength(12);
    expect(doc.sections.map((s) => s.order)).toEqual(CAPTURED_IDS.map((_, i) => i));
  });
});
