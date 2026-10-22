/**
 * #5535 criterion 3, second clause — "a declaration the vector set accepts",
 * made mechanical.
 *
 * The KG publishes a live no-external-irreversible declaration on
 * `/.well-known/pact.json` (every advertised resource type
 * internal-reversible / not-required; authorizationProof and
 * executionCapability false; the fail-closed §25.6 applyGuard true). The
 * upstream runner has no capability-keyed skip, so acceptance is recorded
 * the way the pact expected-failures pattern records it (#5640): a COMMITTED
 * exact-set results manifest, pinned by this suite in BOTH directions —
 *
 *  - against the generated corpus inventory
 *    (`fixtures/pact-v23/execution-boundary-vectors.json`, TailorAU/pact @
 *    the pinned commit): every one of the 11 execution-boundary vector ids
 *    is either EXECUTED or CAPABILITY-EXCLUDED, no id is both, no phantom id
 *    exists, and each exclusion names a vector whose OWN declared
 *    preconditions fix `effect_class: external-irreversible`;
 *  - against the SERVED profile (`buildPactProfile()` — the same builder the
 *    discovery route serializes): the declaration each exclusion cites must
 *    actually be on the wire. The day the profile advertises an
 *    external-irreversible or attestation-required type, or flips a §25
 *    capability, every exclusion reason becomes false and this suite goes
 *    red — the manifest must be re-argued, not silently kept.
 *
 * The two EXECUTED ids run end-to-end against the real route handlers on
 * real Postgres in `execution-boundary-vectors.itest.ts` (CI:
 * kg-integration); this suite additionally pins that the executed set is
 * EXACTLY the internal-reversible subset of the corpus — the executability
 * predicate, not a hand list.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildPactProfile, unadvertisableResourceTypes } from "./pact-profile";
import { guardedAdvertisedTypes } from "./effect-class";

interface InventoryEntry {
  id: string;
  path: string;
  sha256: string;
  kind: string;
  classification: {
    declared_at: string;
    resource_type: string | null;
    effect_class: string | null;
    human_attestation: string | null;
  };
}

interface Fixture {
  source: { commit: string };
  inventory: InventoryEntry[];
  vectors: { id: string; sha256: string; raw_yaml: string; parsed: { metadata: { id: string } } }[];
}

interface AcceptanceManifest {
  pact_commit: string;
  vector_set: string;
  declaration: { served_at: string; fields: string[]; statement: string };
  executed: string[];
  capability_excluded: { id: string; requires: { effect_class: string }; reason: string }[];
}

const FIXTURE_DIR = path.join(__dirname, "fixtures", "pact-v23");

const fixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "execution-boundary-vectors.json"), "utf8")
) as Fixture;

const manifest = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "execution-boundary-acceptance.json"), "utf8")
) as AcceptanceManifest;

const profile = buildPactProfile();

/**
 * The exact-set check, extracted pure so the tamper tests below can prove it
 * bites in every direction. Returns failure strings; [] means accepted.
 */
export function acceptanceFailures(m: AcceptanceManifest, inventory: InventoryEntry[]): string[] {
  const failures: string[] = [];
  const inventoryIds = inventory.map((e) => e.id);
  const accounted = [...m.executed, ...m.capability_excluded.map((e) => e.id)];

  for (const id of inventoryIds) {
    if (!accounted.includes(id)) failures.push(`unaccounted vector: ${id}`);
  }
  for (const id of accounted) {
    if (!inventoryIds.includes(id)) failures.push(`phantom id (not in the corpus): ${id}`);
  }
  if (new Set(accounted).size !== accounted.length) {
    failures.push("an id appears more than once across executed + capability_excluded");
  }

  const byId = new Map(inventory.map((e) => [e.id, e]));
  for (const id of m.executed) {
    const entry = byId.get(id);
    if (entry && entry.classification.effect_class !== "internal-reversible") {
      failures.push(`${id} is executed but its declared effect_class is ${entry.classification.effect_class}`);
    }
  }
  for (const excluded of m.capability_excluded) {
    const entry = byId.get(excluded.id);
    if (!entry) continue; // already reported as phantom
    if (entry.classification.effect_class !== "external-irreversible") {
      failures.push(
        `${excluded.id} is capability-excluded but its declared effect_class is ` +
          `${entry.classification.effect_class} — the exclusion is not capability-keyed`
      );
    }
    if (excluded.requires.effect_class !== entry.classification.effect_class) {
      failures.push(
        `${excluded.id}: manifest requires.effect_class (${excluded.requires.effect_class}) ` +
          `has drifted from the vector's own declaration (${entry.classification.effect_class})`
      );
    }
  }
  return failures;
}

describe("execution-boundary acceptance — the exact set, both directions", () => {
  it("pins the same pact commit as the generated fixture", () => {
    expect(manifest.pact_commit).toBe(fixture.source.commit);
  });

  it("covers all 11 corpus ids: executed + capability-excluded, disjoint, no phantoms", () => {
    expect(fixture.inventory).toHaveLength(11);
    expect(acceptanceFailures(manifest, fixture.inventory)).toEqual([]);
    expect(manifest.executed).toHaveLength(2);
    expect(manifest.capability_excluded).toHaveLength(9);
  });

  it("the executed set IS the internal-reversible subset of the corpus — a predicate, not a hand list", () => {
    const internalReversible = fixture.inventory
      .filter((e) => e.classification.effect_class === "internal-reversible")
      .map((e) => e.id)
      .sort();
    expect([...manifest.executed].sort()).toEqual(internalReversible);
  });

  it("carries each executed vector verbatim, SHA-pinned — a hand edit fails", () => {
    expect(fixture.vectors.map((v) => v.id).sort()).toEqual([...manifest.executed].sort());
    for (const vector of fixture.vectors) {
      const recomputed = crypto.createHash("sha256").update(vector.raw_yaml, "utf8").digest("hex");
      expect(recomputed, vector.id).toBe(vector.sha256);
      expect(vector.parsed.metadata.id).toBe(vector.id);
      const inventoried = fixture.inventory.find((e) => e.id === vector.id);
      expect(inventoried?.sha256, vector.id).toBe(vector.sha256);
    }
  });
});

describe("execution-boundary acceptance — the cited declaration is live on the served profile", () => {
  it("names the discovery document and the fields the reasons rest on", () => {
    expect(manifest.declaration.served_at).toBe("/.well-known/pact.json");
    expect(manifest.declaration.fields).toEqual([
      "resourceTypes[*].effectClass",
      "resourceTypes[*].humanAttestation",
      "capabilities.applyGuard",
      "capabilities.authorizationProof",
      "capabilities.executionCapability",
    ]);
  });

  it("resourceTypes[*]: every advertised type is internal-reversible / not-required", () => {
    expect(profile.resourceTypes.length).toBeGreaterThan(0);
    for (const advertised of profile.resourceTypes) {
      expect(advertised.effectClass, advertised.type).toBe("internal-reversible");
      expect(advertised.humanAttestation, advertised.type).toBe("not-required");
    }
  });

  it("capabilities: applyGuard true, authorizationProof false, executionCapability false", () => {
    expect(profile.capabilities.applyGuard).toBe(true);
    expect(profile.capabilities.authorizationProof).toBe(false);
    expect(profile.capabilities.executionCapability).toBe(false);
  });

  it("the declaration hides nothing: no guarded type is advertised OR silently withheld", () => {
    // A guarded registration would be dropped from the advertisement by the
    // §25.6 filter and named in declaredGaps — at which point the exclusion
    // reasons' "advertises none" would be technically true and honestly
    // false. Red here forces the manifest to be re-argued instead.
    expect(guardedAdvertisedTypes()).toEqual([]);
    expect(unadvertisableResourceTypes()).toEqual([]);
  });
});

describe("execution-boundary acceptance — every check can actually fail", () => {
  const clone = (): AcceptanceManifest => JSON.parse(JSON.stringify(manifest)) as AcceptanceManifest;

  it("a dropped exclusion is an unaccounted vector", () => {
    const doctored = clone();
    doctored.capability_excluded.pop();
    expect(acceptanceFailures(doctored, fixture.inventory)).not.toEqual([]);
  });

  it("a phantom id is refused", () => {
    const doctored = clone();
    doctored.executed.push("extended/execution-boundary/does-not-exist");
    expect(acceptanceFailures(doctored, fixture.inventory)).not.toEqual([]);
  });

  it("an id claimed both ways is refused", () => {
    const doctored = clone();
    doctored.executed.push(doctored.capability_excluded[0].id);
    expect(acceptanceFailures(doctored, fixture.inventory)).not.toEqual([]);
  });

  it("excluding an internal-reversible vector is refused — exclusion must be capability-keyed", () => {
    const doctored = clone();
    const moved = doctored.executed.pop()!;
    doctored.capability_excluded.push({
      id: moved,
      requires: { effect_class: "external-irreversible" },
      reason: "doctored",
    });
    expect(acceptanceFailures(doctored, fixture.inventory)).not.toEqual([]);
  });

  it("…and the committed manifest itself passes", () => {
    expect(acceptanceFailures(manifest, fixture.inventory)).toEqual([]);
  });
});
