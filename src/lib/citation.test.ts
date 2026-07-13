/**
 * pact#28 ask-4 — unit tests for the deterministic citation parser
 * behind GET /api/axiom/resolve.
 */
import { describe, it, expect } from "vitest";
import { parseCitation, jurisdictionMatches, citationJurisdiction } from "./citation";

describe("parseCitation", () => {
  it("parses instrument + jurisdiction parenthetical + subsection", () => {
    expect(parseCitation("Privacy Act 1988 (Cth) s 6(1)")).toEqual({
      name: "Privacy Act 1988",
      jurisdiction: "CTH",
      jurisdictionRaw: "Cth",
      section: "6(1)",
    });
  });

  it("parses a bare instrument name", () => {
    expect(parseCitation("Coal Mining Safety and Health Regulation 2017")).toEqual({
      name: "Coal Mining Safety and Health Regulation 2017",
      jurisdiction: null,
      jurisdictionRaw: null,
      section: null,
    });
  });

  it("parses the long 'section' keyword and state jurisdictions", () => {
    expect(parseCitation("Work Health and Safety Act 2011 (Qld) section 19")).toEqual({
      name: "Work Health and Safety Act 2011",
      jurisdiction: "QLD",
      jurisdictionRaw: "Qld",
      section: "19",
    });
  });

  it("parses alphanumeric sections and dotted abbreviations", () => {
    expect(parseCitation("Criminal Code Act 1995 (Cth) s. 92A").section).toBe("92A");
    expect(parseCitation("Fair Work Act 2009 s 394").section).toBe("394");
  });

  it("does NOT mistake a year for a section number", () => {
    const p = parseCitation("Privacy Act 1988");
    expect(p.section).toBeNull();
    expect(p.name).toBe("Privacy Act 1988");
  });

  it("leaves standards designations intact", () => {
    const p = parseCitation("AS/NZS 4308:2008");
    expect(p.name).toBe("AS/NZS 4308:2008");
    expect(p.jurisdiction).toBeNull();
    expect(p.section).toBeNull();
  });

  it("normalises whitespace", () => {
    expect(parseCitation("  Privacy   Act  1988   (Cth)  ").name).toBe("Privacy Act 1988");
  });
});

describe("jurisdictionMatches", () => {
  it("no hint matches everything", () => {
    expect(jurisdictionMatches("AU-QLD", null)).toBe(true);
  });
  it("matches bare and AU-prefixed forms", () => {
    expect(jurisdictionMatches("QLD", "QLD")).toBe(true);
    expect(jurisdictionMatches("AU-QLD", "QLD")).toBe(true);
    expect(jurisdictionMatches("AU-NSW", "QLD")).toBe(false);
    expect(jurisdictionMatches("CTH", "CTH")).toBe(true);
  });
});

describe("citationJurisdiction", () => {
  it("renders conventional citation parentheticals", () => {
    expect(citationJurisdiction("AU-QLD")).toBe("Qld");
    expect(citationJurisdiction("CTH")).toBe("Cth");
    expect(citationJurisdiction("AU-CTH")).toBe("Cth");
    expect(citationJurisdiction("NSW")).toBe("NSW");
    expect(citationJurisdiction("AU-TAS")).toBe("Tas");
    expect(citationJurisdiction("AU")).toBeNull();
    expect(citationJurisdiction(null)).toBeNull();
  });
});
