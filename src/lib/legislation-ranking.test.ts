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
  MAX_QUERY_LENGTH,
  stripParentheticals,
  TITLE_TIER_BOOST,
  type TitleMatchTier,
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

// tailor-group#7 — CodeQL js/polynomial-redos on the raw search `q`. The
// designation separator and the parenthetical stripper were quadratic on
// long malformed input; both must now run in linear time and keep their
// matching semantics exactly.
describe("ReDoS hardening (tailor-group#7)", () => {
  const N = 50_000;
  // Linear work on 50k chars is well under a millisecond or two; the former
  // quadratic patterns took seconds at this size. The bound is generous so a
  // loaded CI box never flakes, yet far below the quadratic cost.
  const BOUND_MS = 250;
  const time = (fn: () => unknown): number => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  it("MAX_QUERY_LENGTH is a sane citation-sized bound", () => {
    expect(MAX_QUERY_LENGTH).toBeGreaterThanOrEqual(256);
    expect(MAX_QUERY_LENGTH).toBeLessThanOrEqual(2048);
  });

  it("a designation body followed by a long whitespace run and no number is linear", () => {
    for (const body of ["ISO", "AS/NZS", "AS", "EN"]) {
      const q = `${body}${" ".repeat(N)}!`;
      let out: ReturnType<typeof extractDesignations> = [];
      expect(time(() => (out = extractDesignations(q)))).toBeLessThan(BOUND_MS);
      expect(out).toEqual([]);
      expect(time(() => tokenizeQuery(q))).toBeLessThan(BOUND_MS);
    }
  });

  it("many designation bodies each followed by whitespace runs stay linear", () => {
    const q = `ISO ${"\t".repeat(2000)}- ${" ".repeat(2000)}x `.repeat(20);
    expect(time(() => extractDesignations(q))).toBeLessThan(BOUND_MS);
  });

  it("a long run of unmatched '(' is linear through titleMatchTier", () => {
    const q = `Privacy Act ${"(".repeat(N)}`;
    let tier: TitleMatchTier = "none";
    expect(time(() => (tier = titleMatchTier(q, "Privacy Act 1988 (Cth)")))).toBeLessThan(BOUND_MS);
    expect(tier).toBe("near-exact"); // "privacy act" is a whole-word prefix of the title
    expect(time(() => stripParentheticals("(".repeat(N)))).toBeLessThan(BOUND_MS);
  });

  it("keeps separator semantics: space, hyphen, spaced hyphen, none", () => {
    expect(extractDesignations("ISO 45001").map((d) => d.canonical)).toEqual(["iso 45001"]);
    expect(extractDesignations("ISO-45001").map((d) => d.canonical)).toEqual(["iso 45001"]);
    expect(extractDesignations("ISO  -  45001:2018").map((d) => [d.canonical, d.year])).toEqual([["iso 45001", "2018"]]);
    expect(extractDesignations("ISO45001").map((d) => d.canonical)).toEqual(["iso 45001"]);
    expect(extractDesignations("AS\t4308").map((d) => d.canonical)).toEqual(["as 4308"]);
    expect(extractDesignations("ISO -- 45001")).toEqual([]);
  });

  // The pre-fix patterns, kept here only as an oracle on SHORT inputs.
  const OLD_CI = /\b(AS\/NZS|ISO\/IEC|NZS|ISO|IEC|ASTM)\s*[- ]?\s*(\d{2,6})(?::(\d{4}))?\b/gi;
  const OLD_UPPER = /\b(AS|EN|BS)\s*[- ]?\s*(\d{2,6})(?::(\d{4}))?\b/g;
  const NEW_CI = /\b(AS\/NZS|ISO\/IEC|NZS|ISO|IEC|ASTM)\s*(?:-\s*)?(\d{2,6})(?::(\d{4}))?\b/gi;
  const NEW_UPPER = /\b(AS|EN|BS)\s*(?:-\s*)?(\d{2,6})(?::(\d{4}))?\b/g;
  const allMatches = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => [m.index, m[0], m[1], m[2], m[3]]);

  // Deterministic PRNG so a failure is reproducible.
  const prng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const ALPHABET = ["ISO", "iso", "AS/NZS", "AS", "EN", "BS", "IEC", " ", " ", "\t", "-", "4308", "45001", ":2018", ":", "(", ")", "Cth", "x", "1"];
  const randomQuery = (rnd: () => number) =>
    Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join("");

  it("the new designation patterns match exactly what the old ones did (randomised oracle)", () => {
    const rnd = prng(7);
    for (let i = 0; i < 5000; i++) {
      const q = randomQuery(rnd);
      expect(allMatches(NEW_CI, q), q).toEqual(allMatches(OLD_CI, q));
      expect(allMatches(NEW_UPPER, q), q).toEqual(allMatches(OLD_UPPER, q));
    }
  });

  it("stripParentheticals matches the former regex replacement (randomised oracle)", () => {
    const rnd = prng(11);
    for (let i = 0; i < 5000; i++) {
      const s = randomQuery(rnd);
      expect(stripParentheticals(s), s).toBe(s.replace(/\([^)]*\)/g, " "));
    }
    expect(stripParentheticals("a (b (c) d)")).toBe("a   d)");
    expect(stripParentheticals("Privacy Act 1988 (Cth)")).toBe("Privacy Act 1988  ");
    expect(stripParentheticals("x ( y")).toBe("x ( y");
    expect(stripParentheticals("()()")).toBe("  ");
  });

  it("title matching semantics are unchanged for jurisdiction suffixes", () => {
    expect(titleMatchTier("Privacy Act 1988", "Privacy Act 1988 (Cth)")).toBe("exact");
    expect(titleMatchTier("Privacy Act 1988 (Cth) s 6", "Privacy Act 1988 (Cth)")).toBe("near-exact");
  });
});
