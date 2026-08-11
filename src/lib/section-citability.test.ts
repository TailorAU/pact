/**
 * #5092 — unit tests for section-id citability (section-citability.ts),
 * the API-side mirror of the Tailor-side #5083 fix
 * (SourceLegislationResolver.IsCitableSectionId / FormatRecordLocator).
 *
 * Live repro these primitives must fix (observed 2026-08-11):
 *   GET /api/axiom/legislation/search?q=planning&jurisdiction=QLD returned
 *   sourceRef: "Planning Act 2016 chunk-1" — the knowledge graph's internal
 *   storage key composed into a legal citation string and served to every
 *   consumer of the free API.
 *
 * The real-pinpoint cases below are the guard that the fix does not erase
 * genuine citations — they must stay green against BOTH the pre-fix and
 * post-fix implementations (#5083's "six real-pinpoint cases stayed green
 * throughout" discipline).
 */
import { describe, it, expect } from "vitest";
import {
  isCitableSectionId,
  sectionKindOf,
  formatSourceRef,
} from "./section-citability";

describe("isCitableSectionId — synthetic storage keys are not citable", () => {
  it.each([
    "chunk-1",
    "chunk-12",
    "CHUNK-1",
    "planning-act-2016-chunk-12",
    "frag-2",
    "fragment 3",
    "segment-1",
    "excerpt",
    "extract-7",
    "doc chunk 4",
  ])("rejects the synthetic fragment key %j", (id) => {
    expect(isCitableSectionId(id)).toBe(false);
  });

  it.each([
    "d84af1ae-133c-4f00-b815-64079c5b0a28",
    "{d84af1ae-133c-4f00-b815-64079c5b0a28}",
    "D84AF1AE133C4F00B81564079C5B0A28",
  ])("rejects the raw GUID %j", (id) => {
    expect(isCitableSectionId(id)).toBe(false);
  });

  it.each(["", "   ", null, undefined])(
    "rejects missing/whitespace %j",
    (id) => {
      expect(isCitableSectionId(id as string | null | undefined)).toBe(false);
    }
  );
});

describe("isCitableSectionId — real pinpoints pass through untouched", () => {
  it.each([
    "s 10",
    "s 124A",
    "s 6(1)",
    "s 302",
    "Part 3",
    "21A",
    "Schedule 2",
    "APP 3",
    "r 89",
    "cl 4",
    // Boundary semantics mirrored from the C# regex: the synthetic token
    // must stand alone — a word merely CONTAINING one does not match.
    "chunky",
  ])("accepts the real pinpoint %j", (id) => {
    expect(isCitableSectionId(id)).toBe(true);
  });
});

describe("sectionKindOf", () => {
  it("classifies a real pinpoint", () => {
    expect(sectionKindOf("s 302")).toBe("pinpoint");
  });
  it("classifies a synthetic storage key", () => {
    expect(sectionKindOf("chunk-1")).toBe("extract");
  });
  it("classifies a missing id", () => {
    expect(sectionKindOf(null)).toBe("extract");
  });
});

describe("formatSourceRef", () => {
  it("keeps the existing '<short||doc> <id>' shape for a citable id (byte-identical to pre-#5092)", () => {
    expect(
      formatSourceRef("Criminal Code 1899", "Criminal Code Act 1899 (Qld)", "s 302")
    ).toBe("Criminal Code 1899 s 302");
  });

  it("falls back to doc_title when short_title is absent, still appending a citable id", () => {
    expect(
      formatSourceRef(null, "Anti-Discrimination Act 1991 (Qld)", "s 124A")
    ).toBe("Anti-Discrimination Act 1991 (Qld) s 124A");
  });

  it("drops a synthetic storage key entirely — doc-level citation only", () => {
    expect(
      formatSourceRef("Planning Act 2016", "Planning Act 2016 (Qld)", "chunk-1")
    ).toBe("Planning Act 2016");
  });

  it("never lets a chunk token reach the citation string (regression sentinel for the raw `${short} ${section_id}` composition)", () => {
    const ref = formatSourceRef(
      "Planning Act 2016",
      "Planning Act 2016 (Qld)",
      "chunk-1"
    );
    expect(ref.toLowerCase()).not.toContain("chunk");
  });

  it("doc-level citation for a missing id", () => {
    expect(
      formatSourceRef("Building Act 1975", "Building Act 1975 (Qld)", null)
    ).toBe("Building Act 1975");
  });

  it("does not append an '(extract)' marker — the kind signal rides on sectionKind, sourceRef stays verbatim-citable", () => {
    const ref = formatSourceRef(
      "Planning Act 2016",
      "Planning Act 2016 (Qld)",
      "chunk-1"
    );
    expect(ref).not.toContain("extract");
  });
});
