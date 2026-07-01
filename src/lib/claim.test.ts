import { describe, it, expect } from "vitest";
import { CANONICAL_CLAIM_MAX, lintAtomicClaim, classifyClaimAtomicity } from "./claim";

describe("lintAtomicClaim (#3691 W2)", () => {
  it("accepts an atomic claim", () => {
    const r = lintAtomicClaim("Water boils at 100 °C");
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("rejects an over-length claim (141 chars) with an externalize hint", () => {
    const r = lintAtomicClaim("x".repeat(CANONICAL_CLAIM_MAX + 1));
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(CANONICAL_CLAIM_MAX));
    expect(r.hint).toContain("assumes");
  });

  it("rejects bundled conjunctions of verb-bearing clauses", () => {
    const r = lintAtomicClaim("Water boils at 100 °C and ice melts at 0 °C");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("bundles");
  });

  it("allows a conjunction inside a single proposition (no second clause verb)", () => {
    expect(lintAtomicClaim("Sodium and chlorine form table salt").ok).toBe(true);
  });

  it("rejects multi-sentence claims", () => {
    expect(lintAtomicClaim("Water boils. Ice melts.").ok).toBe(false);
  });

  it("rejects motte-and-bailey hedges", () => {
    expect(lintAtomicClaim("Water arguably boils at 100 °C").ok).toBe(false);
    expect(lintAtomicClaim("Some might say water boils at 100 °C").ok).toBe(false);
  });

  it("warns (not rejects) on embedded conditions that belong on edges", () => {
    const r = lintAtomicClaim("Water boils at 100 °C assuming standard pressure");
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toContain("assumes");
  });
});

describe("classifyClaimAtomicity — read-only backfill (#3691 W6)", () => {
  it("classifies without ever mutating the input", () => {
    const long = "y".repeat(2000);
    expect(classifyClaimAtomicity(long)).toBe("needs_split");
    expect(long).toHaveLength(2000); // untouched — no truncation
    expect(classifyClaimAtomicity("Water boils at 100 °C")).toBe("atomic");
    expect(classifyClaimAtomicity(null)).toBe("legacy_unchecked");
    expect(classifyClaimAtomicity("")).toBe("legacy_unchecked");
  });
});
