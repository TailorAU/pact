/**
 * pact#28 ask-2 — unit tests for the designation-aware tokenisation +
 * exact-title ranking primitives (legislation-ranking.ts).
 *
 * Live repros these primitives must fix (observed 2026-07-13):
 *   - "AS/NZS 4308" tokenised to ["nzs","4308"] → designation lost.
 *   - "Privacy Act 1988" ranked body-text mentions above Privacy Act titles.
 *   - "Coal Mining Safety and Health Regulation 2017" ranked the Act above
 *     the Regulation.
 */
import { describe, it, expect } from "vitest";
import {
  extractDesignations,
  tokenizeQuery,
  titleMatchTier,
  titleMatchBoost,
  designationMatchBoost,
  escapeLike,
  TITLE_TIER_BOOST,
} from "./legislation-ranking";

describe("extractDesignations", () => {
  it("extracts AS/NZS designations with the full body preserved", () => {
    const d = extractDesignations("AS/NZS 4308");
    expect(d).toHaveLength(1);
    expect(d[0].canonical).toBe("as/nzs 4308");
    expect(d[0].body).toBe("AS/NZS");
    expect(d[0].number).toBe("4308");
    expect(d[0].year).toBeNull();
  });

  it("captures the edition year when present", () => {
    const d = extractDesignations("AS/NZS 4308:2008 urine testing");
    expect(d).toHaveLength(1);
    expect(d[0].year).toBe("2008");
    expect(d[0].canonical).toBe("as/nzs 4308");
  });

  it("matches ISO designations case-insensitively", () => {
    const d = extractDesignations("iso 45001:2018");
    expect(d).toHaveLength(1);
    expect(d[0].body).toBe("ISO");
    expect(d[0].canonical).toBe("iso 45001");
    expect(d[0].year).toBe("2018");
  });

  it("matches uppercase two-letter bodies (AS 3547)", () => {
    const d = extractDesignations("AS 3547 breathalyser");
    expect(d).toHaveLength(1);
    expect(d[0].canonical).toBe("as 3547");
  });

  it("does NOT treat the lowercase English word 'as' as a designation", () => {
    expect(extractDesignations("known as 4308")).toHaveLength(0);
    expect(extractDesignations("such as 2008 amendments")).toHaveLength(0);
  });

  it("does not double-claim the AS inside AS/NZS", () => {
    const d = extractDesignations("AS/NZS 4760:2019");
    expect(d).toHaveLength(1);
    expect(d[0].body).toBe("AS/NZS");
  });

  it("returns an empty list for citation-shaped legislation queries", () => {
    expect(extractDesignations("Privacy Act 1988 (Cth)")).toHaveLength(0);
    expect(extractDesignations("Coal Mining Safety and Health Regulation 2017")).toHaveLength(0);
  });
});

describe("tokenizeQuery", () => {
  it("live repro: 'AS/NZS 4308' keeps the designation as a searchable token", () => {
    const tokens = tokenizeQuery("AS/NZS 4308");
    // Pre-existing behaviour retained…
    expect(tokens).toContain("nzs");
    expect(tokens).toContain("4308");
    // …and the designation itself is now a first-class token.
    expect(tokens).toContain("as/nzs 4308");
  });

  it("keeps plain-word tokenisation unchanged for non-designation queries", () => {
    expect(tokenizeQuery("Privacy Act 1988")).toEqual(["privacy", "act", "1988"]);
  });

  it("does not duplicate designation tokens", () => {
    const tokens = tokenizeQuery("AS/NZS 4308 and AS/NZS 4308:2008");
    expect(tokens.filter((t) => t === "as/nzs 4308")).toHaveLength(1);
  });
});

describe("titleMatchTier", () => {
  it("exact: normalized equality", () => {
    expect(
      titleMatchTier("Coal Mining Safety and Health Regulation 2017", "Coal Mining Safety and Health Regulation 2017")
    ).toBe("exact");
  });

  it("exact: jurisdiction parenthetical is ignored on either side", () => {
    expect(titleMatchTier("Privacy Act 1988", "Privacy Act 1988 (Cth)")).toBe("exact");
    expect(titleMatchTier("Privacy Act 1988 (Cth)", "Privacy Act 1988")).toBe("exact");
  });

  it("near-exact: citation query is a whole-word prefix of a topic claim-sentence title", () => {
    expect(
      titleMatchTier(
        "Privacy Act 1988",
        "Privacy Act 1988 (Cth) establishes 13 Australian Privacy Principles for personal information"
      )
    ).toBe("near-exact");
  });

  it("none: the Act is NOT a near-exact match for the Regulation citation", () => {
    expect(
      titleMatchTier("Coal Mining Safety and Health Regulation 2017", "Coal Mining Safety and Health Act 1999")
    ).toBe("none");
  });

  it("none: single-word queries never claim a prefix tier", () => {
    expect(titleMatchTier("act", "Act interpretation handbook")).toBe("none");
  });

  it("none: partial-word prefixes do not match (word boundary respected)", () => {
    expect(titleMatchTier("Privacy Act 19", "Privacy Act 1988 (Cth)")).toBe("none");
  });
});

describe("titleMatchBoost", () => {
  it("title tiers dominate any plausible body-text fuzzy score", () => {
    // Body text scores +1 per occurrence and +3 per title keyword; even a
    // pathological chunk with hundreds of occurrences stays far below the
    // near-exact tier.
    expect(TITLE_TIER_BOOST["near-exact"]).toBeGreaterThan(1000);
    expect(TITLE_TIER_BOOST.exact).toBeGreaterThan(TITLE_TIER_BOOST["near-exact"]);
  });

  it("takes the best tier across candidate titles and ignores null/undefined", () => {
    const boost = titleMatchBoost("Privacy Act 1988", null, undefined, "Privacy Act 1988 (Cth)");
    expect(boost).toBe(TITLE_TIER_BOOST.exact);
    expect(titleMatchBoost("Privacy Act 1988", "Coal Mining Safety and Health Act 1999")).toBe(0);
  });
});

describe("designationMatchBoost", () => {
  it("boosts titles containing the canonical designation", () => {
    const designations = extractDesignations("AS/NZS 4308");
    const boost = designationMatchBoost(
      designations,
      "AS/NZS 4308:2008 sets the procedures for specimen collection and quantitation of drugs of abuse in urine"
    );
    expect(boost).toBe(10);
  });

  it("adds the year bonus when the query carries a matching edition year", () => {
    const designations = extractDesignations("AS/NZS 4308:2008");
    const boost = designationMatchBoost(designations, "AS/NZS 4308:2008 urine drug screening");
    expect(boost).toBe(12);
  });

  it("scores zero when the designation is absent", () => {
    const designations = extractDesignations("AS/NZS 4308");
    expect(designationMatchBoost(designations, "Work Health and Safety Act 2011")).toBe(0);
  });

  it("counts each designation once across candidate texts", () => {
    const designations = extractDesignations("ISO 45001");
    const boost = designationMatchBoost(designations, "ISO 45001:2018 OHS", "ISO 45001 summary");
    expect(boost).toBe(10);
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("100% pure_gold\\")).toBe("100\\% pure\\_gold\\\\");
  });
});
