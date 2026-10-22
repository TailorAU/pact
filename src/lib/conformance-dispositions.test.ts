/**
 * #5567 — the 36 v2.3 vector ids OUTSIDE the execution-boundary family,
 * dispositioned honestly and pinned in both directions.
 *
 * `execution-boundary-acceptance.json` (#5535) accounts for the 11
 * execution-boundary ids: 2 executed, 9 capability-excluded. The results
 * document publishes the WHOLE 47-id corpus, so the other 36 need a
 * disposition each — and a hand-authored manifest is only as honest as the
 * tests that hold it to the implementation. This suite pins:
 *
 *  - the exact set: acceptance.executed ∪ acceptance.capability_excluded ∪
 *    conformance-dispositions.json == the fixture's `expected_vector_ids`
 *    (pact's own manifest, vendored at the pinned commit) — disjoint, no
 *    phantom ids, nothing claimed twice, nothing left unaccounted;
 *  - the citations: every capability flag an exclusion cites is served
 *    `false` on `buildPactProfile()` — the SAME builder `/.well-known/pact.json`
 *    serializes — every declared gap it cites is on the wire, and every flag
 *    a `skip` requires is served `true`. Flip a flag and this goes red; the
 *    manifest must then be re-argued, never silently kept;
 *  - the prose: the §15.1 endpoints gap's hand-typed accounting equals the
 *    counts these manifests actually produce.
 *
 * The checks are pure functions exported by `pact-conformance-report.ts`
 * (the builder runs the same ones before it emits a document), so the last
 * section proves each one can actually fail.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildPactProfile } from "./pact-profile";
import {
  DISPOSITIONS,
  accountingFailures,
  citationFailures,
  flattenDispositions,
  type AcceptanceManifest,
  type CorpusFixture,
  type DispositionsManifest,
} from "./pact-conformance-report";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "pact-v23");

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as T;
}

const fixture = readJson<CorpusFixture & { inventory: { id: string }[] }>("execution-boundary-vectors.json");
const acceptance = readJson<AcceptanceManifest>("execution-boundary-acceptance.json");
const dispositions = readJson<DispositionsManifest>("conformance-dispositions.json");
const profile = buildPactProfile();

const EXECUTION_BOUNDARY = "extended/execution-boundary/";
const entries = flattenDispositions(dispositions);
const byId = new Map(entries.map((e) => [e.id, e]));

describe("conformance dispositions — the 47-id exact set (#5567)", () => {
  it("pins the same pact commit as the generated fixture and the acceptance manifest", () => {
    expect(dispositions.pact_commit).toBe(fixture.source.commit);
    expect(acceptance.pact_commit).toBe(fixture.source.commit);
  });

  it("the fixture carries the whole corpus: 47 ids in pact's manifest order, a kind and a path for each", () => {
    expect(fixture.expected_vector_ids).toHaveLength(47);
    expect(new Set(fixture.expected_vector_ids).size).toBe(47);
    for (const id of fixture.expected_vector_ids) {
      expect(["verification", "http", "session", "mandate"], id).toContain(fixture.vector_kinds[id]);
      expect(fixture.vector_paths[id], id).toMatch(/^spec\/v2\.3\/conformance\/(core|extended\/[a-z-]+)\/[a-z0-9-]+\.yaml$/);
    }
    // The 11-id execution-boundary sub-inventory IS the corpus's
    // execution-boundary subset — the same file, one generator.
    expect(fixture.inventory.map((e) => e.id).sort()).toEqual(
      fixture.expected_vector_ids.filter((id) => id.startsWith(EXECUTION_BOUNDARY)).sort()
    );
    // The README's http_coverage grouping: http + session = 18 server-bound ids.
    expect(
      fixture.expected_vector_ids.filter((id) => ["http", "session"].includes(fixture.vector_kinds[id]))
    ).toHaveLength(18);
  });

  it("executed (2) ∪ capability-excluded (9) ∪ dispositions (36) == the 47 ids exactly", () => {
    expect(accountingFailures(fixture.expected_vector_ids, acceptance, dispositions)).toEqual([]);
    expect(acceptance.executed).toHaveLength(2);
    expect(acceptance.capability_excluded).toHaveLength(9);
    expect(entries).toHaveLength(36);
    expect(entries.every((e) => !e.id.startsWith(EXECUTION_BOUNDARY))).toBe(true);
  });

  it("families list only their own ids, every entry carries a reason and a closed-vocabulary disposition", () => {
    for (const family of dispositions.families) {
      expect(family.ids.length).toBeGreaterThan(0);
      for (const id of family.ids) expect(id.startsWith(`${family.family}/`), id).toBe(true);
    }
    for (const entry of entries) {
      expect(entry.reason.trim().length, entry.id).toBeGreaterThan(40);
      expect(DISPOSITIONS, entry.id).toContain(entry.disposition);
    }
    expect(dispositions.families.map((f) => [f.family, f.ids.length])).toEqual([
      ["extended/attestation", 12],
      ["extended/mandate", 12],
      ["extended/matters", 5],
      ["extended/sessions", 6],
    ]);
  });

  it("the one skip is core/join/basic, and it carries a filed tracking reference", () => {
    const skips = entries.filter((e) => e.status === "skip");
    expect(skips.map((e) => e.id)).toEqual(["core/join/basic"]);
    expect(skips[0].disposition).toBe("unharnessed");
    expect(skips[0].tracking).toMatch(/^TailorAU\/tailor-app#\d+$/);
    // A skip claims executability in principle: it must name the served
    // capability that makes the claim true.
    expect(skips[0].requires?.capabilities).toEqual(["inviteTokens"]);
  });
});

describe("conformance dispositions — every citation is live on the served profile", () => {
  it("every cited flag is served false, every cited gap is on the wire, every required flag is served true", () => {
    expect(citationFailures(dispositions, profile)).toEqual([]);
  });

  it("names the flags a reader would look for, per family", () => {
    expect(byId.get("extended/attestation/verify-fido2-valid")?.cites).toEqual({
      capabilities: ["authorizationProof"],
      declaredGap: "§17.4 / §17.6 principals and proofs",
    });
    expect(byId.get("extended/mandate/mandate-valid-passthrough")?.cites).toEqual({ capabilities: ["mandates"] });
    expect(byId.get("extended/matters/matter-open-success")?.cites).toEqual({ capabilities: ["matters"] });
    expect(byId.get("extended/sessions/onboard-success")?.cites).toEqual({
      capabilities: ["atomicOnboard", "manifest", "sessionAwareness"],
    });
    // ...and each of those really is false on the wire, read here directly
    // so the assertion above cannot pass on a citation the profile lacks.
    for (const flag of ["authorizationProof", "mandates", "matters", "atomicOnboard", "manifest", "sessionAwareness"]) {
      expect(profile.capabilities[flag], flag).toBe(false);
    }
    expect(profile.capabilities.inviteTokens).toBe(true);
  });

  it("the §15.1 endpoints gap states the accounting these manifests produce — the numbers cannot drift", () => {
    const executed = acceptance.executed.length;
    const skipped = entries.filter((e) => e.status === "skip").length;
    const excluded = acceptance.capability_excluded.length + entries.filter((e) => e.status === "excluded").length;
    const total = fixture.expected_vector_ids.length;
    expect(executed + skipped + excluded).toBe(total);

    const gap = profile.declaredGaps.find((g) => g.area === "§15.1 endpoints");
    expect(gap).toBeDefined();
    expect(gap!.statement).toContain(`${total} vectors`);
    expect(gap!.statement).toContain(`${executed} are executed`);
    expect(gap!.statement).toContain(`${skipped} is skipped`);
    expect(gap!.statement).toContain(`${excluded} are excluded`);
    expect(gap!.statement).toContain("/.well-known/pact-conformance-v23.json");
    expect(gap!.statement).toContain("TailorAU/tailor-app#5567");
    // The pre-#5567 absence statement is EXTENDED, never deleted.
    expect(gap!.statement).toContain("No realtime endpoint and no credentials registry are advertised");
  });
});

describe("conformance dispositions — every check can actually fail", () => {
  const clone = (): DispositionsManifest => JSON.parse(JSON.stringify(dispositions)) as DispositionsManifest;
  const ids = fixture.expected_vector_ids;

  it("a dropped id is an unaccounted vector", () => {
    const doctored = clone();
    (doctored.families[0].ids as string[]).pop();
    expect(accountingFailures(ids, acceptance, doctored)).toContainEqual(expect.stringContaining("unaccounted vector"));
  });

  it("a phantom id is refused", () => {
    const doctored = clone();
    (doctored.families[1].ids as string[]).push("extended/mandate/does-not-exist");
    expect(accountingFailures(ids, acceptance, doctored)).toContainEqual(expect.stringContaining("phantom id"));
  });

  it("an id claimed both by the acceptance manifest and here is refused", () => {
    const doctored = clone();
    (doctored.families[0].ids as string[]).push(acceptance.executed[0]);
    const failures = accountingFailures(ids, acceptance, doctored);
    expect(failures.some((f) => f.includes("claimed twice") || f.includes("belongs to execution-boundary-acceptance"))).toBe(true);
  });

  it("an execution-boundary id filed here is refused — that family belongs to the acceptance manifest", () => {
    const doctored = clone();
    (doctored.vectors as unknown as unknown[]).push({
      id: acceptance.capability_excluded[0].id,
      status: "excluded",
      disposition: "not-served",
      cites: { capabilities: ["matters"] },
      reason: "doctored — filed in the wrong manifest",
    });
    expect(accountingFailures(ids, acceptance, doctored)).toContainEqual(
      expect.stringContaining("belongs to execution-boundary-acceptance.json")
    );
  });

  it("a skip without tracking, an empty reason, and an exclusion citing nothing are all refused", () => {
    const noTracking = clone();
    delete (noTracking.vectors[0] as unknown as { tracking?: string }).tracking;
    expect(accountingFailures(ids, acceptance, noTracking)).toContainEqual(expect.stringContaining("no tracking reference"));

    const noReason = clone();
    (noReason.families[2] as unknown as { reason: string }).reason = "   ";
    expect(accountingFailures(ids, acceptance, noReason)).toContainEqual(expect.stringContaining("carries no reason"));

    const uncited = clone();
    delete (uncited.families[1] as unknown as { cites?: unknown }).cites;
    expect(accountingFailures(ids, acceptance, uncited)).toContainEqual(expect.stringContaining("cites no served flag"));
  });

  it("citing a flag the profile serves TRUE is refused — the exclusion would be a lie", () => {
    const doctored = clone();
    (doctored.families[2] as unknown as { cites: { capabilities: string[] } }).cites = { capabilities: ["inviteTokens"] };
    expect(citationFailures(doctored, profile)).toContainEqual(expect.stringContaining("capabilities.inviteTokens=false"));
  });

  it("citing an unknown flag or an absent declared gap is refused", () => {
    const unknownFlag = clone();
    (unknownFlag.families[2] as unknown as { cites: { capabilities: string[] } }).cites = { capabilities: ["teleportation"] };
    expect(citationFailures(unknownFlag, profile)).toContainEqual(expect.stringContaining("does not declare"));

    const absentGap = clone();
    (absentGap.families[0] as unknown as { cites: { capabilities: string[]; declaredGap: string } }).cites = {
      capabilities: ["authorizationProof"],
      declaredGap: "§99 imaginary",
    };
    expect(citationFailures(absentGap, profile)).toContainEqual(expect.stringContaining("not on the wire"));
  });

  it("a skip requiring a flag the profile serves FALSE is refused — it would not be executable in principle", () => {
    const doctored = clone();
    (doctored.vectors[0] as unknown as { requires: { capabilities: string[] } }).requires = { capabilities: ["matters"] };
    expect(citationFailures(doctored, profile)).toContainEqual(expect.stringContaining("requires capabilities.matters=true"));
  });

  it("…and the committed manifest itself passes both checks", () => {
    expect(accountingFailures(ids, acceptance, dispositions)).toEqual([]);
    expect(citationFailures(dispositions, profile)).toEqual([]);
  });
});
