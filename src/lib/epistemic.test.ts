import { describe, it, expect } from "vitest";
import {
  WARRANT_KINDS,
  warrantKindFromTier,
  tierFromWarrantKind,
  consensusStateFor,
  credenceFromRatio,
  CREDENCE_ASYMPTOTE,
  CREDENCE_FLOOR,
  computeEffectiveCredences,
  validateDefeater,
  challengeSimilarity,
  DEFEATER_TYPES,
} from "./epistemic";

describe("Axis A — warrant kinds (#3691 W1)", () => {
  it("has exactly four unordered kinds and no axiom", () => {
    expect([...WARRANT_KINDS].sort()).toEqual(["conjectural", "empirical", "institutional", "interpretive"]);
    expect(WARRANT_KINDS).not.toContain("axiom");
  });

  it("maps the legacy axiom rank onto institutional warrant", () => {
    expect(warrantKindFromTier("axiom")).toBe("institutional");
  });

  it("round-trips the four kinds through the tier column", () => {
    for (const kind of WARRANT_KINDS) {
      const tier = tierFromWarrantKind(kind);
      expect(tier).toBeTruthy();
      expect(warrantKindFromTier(tier!)).toBe(kind);
    }
    expect(tierFromWarrantKind("axiom")).toBeNull();
  });
});

describe("Axis B — state + credence (#3691 W1)", () => {
  it("maps internal statuses to the user-facing lifecycle", () => {
    expect(consensusStateFor("open")).toBe("open");
    expect(consensusStateFor("challenged")).toBe("contested");
    expect(consensusStateFor("consensus")).toBe("aligned");
    expect(consensusStateFor("stable")).toBe("verified");
    expect(consensusStateFor("locked")).toBe("verified");
    // #5425 — terminal rejection of a proposed topic surfaces as its own
    // state, never as "open".
    expect(consensusStateFor("rejected")).toBe("rejected");
  });

  it("credence cannot produce 1.0 by construction — even at unanimity", () => {
    expect(credenceFromRatio(1.0)).toBeLessThan(1.0);
    expect(credenceFromRatio(1.0)).toBeCloseTo(CREDENCE_ASYMPTOTE, 10);
  });

  it("is a monotone transform of the honest ratio, never a clamp of it", () => {
    let prev = -1;
    for (const r of [0, 0.25, 0.5, 0.9, 0.95, 1.0]) {
      const c = credenceFromRatio(r);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeLessThan(1.0);
      prev = c;
    }
    expect(credenceFromRatio(null)).toBe(0);
    expect(credenceFromRatio(undefined)).toBe(0);
  });
});

describe("Defeasible propagation P1–P3 (#3691 W3)", () => {
  // Chain: c builds_on b, b assumes a. Defeating a must attenuate b
  // (collapse — assumes) and, transitively, c (weaken — builds_on).
  const edges = [
    { topicId: "b", dependsOn: "a", relationship: "assumes" },
    { topicId: "c", dependsOn: "b", relationship: "builds_on" },
  ];

  it("P1: defeat propagates transitively up 2 hops", () => {
    const healthy = computeEffectiveCredences(
      [
        { id: "a", base: 0.95, defeated: false },
        { id: "b", base: 0.95, defeated: false },
        { id: "c", base: 0.95, defeated: false },
      ],
      edges
    );
    const defeated = computeEffectiveCredences(
      [
        { id: "a", base: 0.1, defeated: true },
        { id: "b", base: 0.95, defeated: false },
        { id: "c", base: 0.95, defeated: false },
      ],
      edges
    );
    // b collapses hard (assumes); c attenuates but less (builds_on)…
    expect(defeated.get("b")!).toBeLessThan(healthy.get("b")!);
    expect(defeated.get("c")!).toBeLessThanOrEqual(healthy.get("c")!);
    // …because b itself is not "defeated" (status unchanged in this fixture),
    // c only weakens via b's status flips. Flip b defeated to see the hop:
    const cascaded = computeEffectiveCredences(
      [
        { id: "a", base: 0.1, defeated: true },
        { id: "b", base: 0.95, defeated: true },
        { id: "c", base: 0.95, defeated: false },
      ],
      edges
    );
    expect(cascaded.get("c")!).toBeLessThan(healthy.get("c")!);
  });

  it("P2: attenuation floors — never zeroes, never deletes", () => {
    const result = computeEffectiveCredences(
      [
        { id: "a", base: 0.0, defeated: true },
        { id: "b", base: 0.9, defeated: true },
        { id: "c", base: 0.9, defeated: false },
      ],
      edges
    );
    expect(result.get("b")!).toBeGreaterThanOrEqual(CREDENCE_FLOOR);
    expect(result.get("c")!).toBeGreaterThanOrEqual(CREDENCE_FLOOR);
    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(true);
  });

  it("P3: recovery self-heals — credence is derived, not latched", () => {
    const nodes = (aDefeated: boolean) => [
      { id: "a", base: aDefeated ? 0.1 : 0.95, defeated: aDefeated },
      { id: "b", base: 0.95, defeated: false },
      { id: "c", base: 0.95, defeated: false },
    ];
    const during = computeEffectiveCredences(nodes(true), edges);
    const after = computeEffectiveCredences(nodes(false), edges);
    expect(after.get("b")!).toBeGreaterThan(during.get("b")!);
    // fully recovered: no residual penalty
    expect(after.get("b")!).toBeCloseTo(0.95, 10);
  });

  it("terminates on (pathological) cycles instead of recursing forever", () => {
    const result = computeEffectiveCredences(
      [
        { id: "x", base: 0.5, defeated: true },
        { id: "y", base: 0.5, defeated: true },
      ],
      [
        { topicId: "x", dependsOn: "y", relationship: "builds_on" },
        { topicId: "y", dependsOn: "x", relationship: "builds_on" },
      ]
    );
    expect(result.get("x")).toBeGreaterThan(0);
    expect(result.get("y")).toBeGreaterThan(0);
  });
});

describe("Typed defeaters (#3691 W4)", () => {
  it("carries the six-type taxonomy including reopen-convention", () => {
    expect(DEFEATER_TYPES).toContain("reopen-convention");
    expect(DEFEATER_TYPES).toHaveLength(6);
  });

  it("rejects a missing/unknown type and lazy substance", () => {
    expect(validateDefeater(undefined, "a perfectly substantive explanation of the failure").valid).toBe(false);
    expect(validateDefeater("vibes", "a perfectly substantive explanation of the failure").valid).toBe(false);
    expect(validateDefeater("counter-evidence", "wrong").valid).toBe(false);
    expect(validateDefeater("counter-evidence", "This is wrong.").valid).toBe(false);
  });

  it("accepts a typed, substantive challenge", () => {
    expect(
      validateDefeater(
        "reopen-convention",
        "The 2019 CGPM redefinition shows this reference convention can and should be revisited against the fixed Planck constant."
      ).valid
    ).toBe(true);
  });

  it("coalesces near-identical defeaters", () => {
    const a = "The boiling point claim omits the atmospheric pressure scope condition entirely";
    const b = "This boiling point claim omits its atmospheric pressure scope condition";
    expect(challengeSimilarity(a, b)).toBeGreaterThanOrEqual(0.6);
    expect(challengeSimilarity(a, "Completely different counter evidence about neutrino oscillation data")).toBeLessThan(0.6);
  });
});
