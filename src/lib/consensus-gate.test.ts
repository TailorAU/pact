import { describe, it, expect } from "vitest";
import { dependencyGateOk, VERIFIED_TOPIC_STATUSES } from "./consensus-gate";
import fs from "fs";
import path from "path";

describe("dependencyGateOk (#2888, floor removed by #3691)", () => {
  it("blocks promotion/keeps demotion armed for any node with unmet deps", () => {
    expect(dependencyGateOk("practice", 1)).toBe(false);
    expect(dependencyGateOk("institutional", 3)).toBe(false);
    expect(dependencyGateOk("policy", 1)).toBe(false);
  });

  it("passes when all dependencies are verified", () => {
    expect(dependencyGateOk("practice", 0)).toBe(true);
    expect(dependencyGateOk("institutional", 0)).toBe(true);
  });

  it("has no privileged floor: the former axiom exemption is gone (#3691)", () => {
    // No first argument buys an exemption — including the legacy "axiom"
    // value and the empty string the DoD assertion uses.
    expect(dependencyGateOk("axiom", 1)).toBe(false);
    expect(dependencyGateOk("axiom", 5)).toBe(false);
    expect(dependencyGateOk("", 1)).toBe(false);
    expect(dependencyGateOk("axiom", 0)).toBe(true);
  });

  it("treats a missing tier like every other value", () => {
    expect(dependencyGateOk(null, 1)).toBe(false);
    expect(dependencyGateOk(undefined, 0)).toBe(true);
  });

  it("the source carries no axiom special-case", () => {
    const gateSource = fs.readFileSync(path.join(__dirname, "consensus-gate.ts"), "utf8");
    expect(gateSource).not.toContain('=== "axiom"');
    expect(gateSource).not.toContain("they are ground truth");
  });
});

describe("VERIFIED_TOPIC_STATUSES stays in sync with db.ts SQL (#2888)", () => {
  // The dependency-met semantics live in two places: this constant and the
  // raw SQL `NOT IN (...)` lists inside db.ts's unmetDependencies
  // subqueries. The latent bug #2888 fixed was exactly this drift —
  // 'locked' (the terminal verified state) was missing from the SQL. This
  // test greps the source so the drift cannot silently reopen.
  it("every verified status appears in both db.ts unmetDependencies subqueries", () => {
    const dbSource = fs.readFileSync(path.join(__dirname, "db.ts"), "utf8");
    const subqueries = dbSource.match(/AND dep\.status NOT IN \(([^)]*)\)/g) ?? [];
    // Two unmetDependencies subqueries (#2888) + the Phase-4 assumes-defeat
    // sweep (#3691 W3) — every occurrence must carry the full verified set.
    expect(subqueries.length).toBeGreaterThanOrEqual(2);
    for (const sq of subqueries) {
      for (const status of VERIFIED_TOPIC_STATUSES) {
        expect(sq).toContain(`'${status}'`);
      }
    }
  });
});
