import { describe, it, expect } from "vitest";
import { dependencyGateOk, VERIFIED_TOPIC_STATUSES } from "./consensus-gate";
import fs from "fs";
import path from "path";

describe("dependencyGateOk (#2888)", () => {
  it("blocks promotion/keeps demotion armed when a non-axiom topic has unmet deps", () => {
    expect(dependencyGateOk("practice", 1)).toBe(false);
    expect(dependencyGateOk("institutional", 3)).toBe(false);
    expect(dependencyGateOk("policy", 1)).toBe(false);
  });

  it("passes when all dependencies are verified", () => {
    expect(dependencyGateOk("practice", 0)).toBe(true);
    expect(dependencyGateOk("institutional", 0)).toBe(true);
  });

  it("exempts axiom-tier topics regardless of unmet count", () => {
    expect(dependencyGateOk("axiom", 0)).toBe(true);
    expect(dependencyGateOk("axiom", 5)).toBe(true);
  });

  it("treats a missing tier as non-axiom (default 'practice' at call sites)", () => {
    expect(dependencyGateOk(null, 1)).toBe(false);
    expect(dependencyGateOk(undefined, 0)).toBe(true);
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
    expect(subqueries.length).toBe(2);
    for (const sq of subqueries) {
      for (const status of VERIFIED_TOPIC_STATUSES) {
        expect(sq).toContain(`'${status}'`);
      }
    }
  });
});
