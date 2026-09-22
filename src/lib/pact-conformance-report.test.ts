/**
 * #5567 — the pure results-document builder, proven over the REAL committed
 * manifests and proven to refuse every input it must refuse.
 *
 * Two families of test. The round-trip family feeds the builder the
 * committed fixture + acceptance + dispositions manifests, two passing
 * records and a stamped provenance, and asserts the document that comes
 * back is the one `cd-source.yml`'s validator and the served profile
 * expect — counts, order, identity, publication URL — with every value
 * DERIVED (compared against the constants and the profile builder, never
 * against a literal typed here). The refusal family proves each `throw` in
 * the builder bites, and that `verifyConformanceReport` refuses a tampered
 * copy of a good document.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DECLARED_ADAPTATIONS,
  HARNESS_FILE,
  OUTCOME_STATUSES,
  PRODUCING_JOB,
  PRODUCING_WORKFLOW,
  RESULTS_ARTIFACT_NAME,
  RUNNER_DISCLAIMER,
  RUNNER_FAIL_REASON,
  UNSETTLED_VECTOR_REASON,
  buildConformanceReport,
  fillUnsettledRecords,
  reconcileWithRunnerVerdict,
  verifyConformanceReport,
  type AcceptanceManifest,
  type BuildConformanceReportInput,
  type ConformanceReport,
  type CorpusFixture,
  type DispositionsManifest,
  type VectorRecord,
} from "./pact-conformance-report";
import {
  CONFORMANCE_RESULTS_PATH,
  IMPLEMENTATION_VERSION,
  PROFILE_NAME,
  PUBLIC_BASE_URL,
  SPEC_VERSION,
  buildPactProfile,
} from "./pact-profile";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "pact-v23");
const fixtureBytes = fs.readFileSync(path.join(FIXTURE_DIR, "execution-boundary-vectors.json"));
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as CorpusFixture;
const acceptance = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "execution-boundary-acceptance.json"), "utf8")
) as AcceptanceManifest;
const dispositions = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "conformance-dispositions.json"), "utf8")
) as DispositionsManifest;

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = "33388893508";

const passing: VectorRecord[] = acceptance.executed.map((id) => ({ id, status: "pass" }));

function input(overrides: Partial<BuildConformanceReportInput> = {}): BuildConformanceReportInput {
  return {
    records: passing,
    fixture,
    acceptance,
    dispositions,
    provenance: {
      commit: SHA,
      run_id: RUN_ID,
      run_attempt: "1",
      run_url: `https://github.com/TailorAU/tailor-app/actions/runs/${RUN_ID}`,
      repository: "TailorAU/tailor-app",
      workflow: "cd-source.yml",
      job: "kg-conformance",
      generated_at: "2026-09-02T00:00:00.000Z",
    },
    vendored: {
      path: "sites/source/src/lib/fixtures/pact-v23/execution-boundary-vectors.json",
      sha256: crypto.createHash("sha256").update(fixtureBytes).digest("hex"),
    },
    ...overrides,
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("conformance report — round-trip over the committed manifests (#5567)", () => {
  const document = buildConformanceReport(input());

  it("publishes every corpus id, in pact's manifest order, with pass 2 / fail 0 / skip 1 / excluded 44", () => {
    expect(document.results.map((r) => r.id)).toEqual(fixture.expected_vector_ids);
    expect(document.results).toHaveLength(47);
    expect(document.counts).toEqual({ pass: 2, fail: 0, skip: 1, excluded: 44 });
    expect(document.dispositions).toEqual({ "executed-adapted": 2, regression: 0, "not-served": 44, unharnessed: 1 });
    // Derived from the fixture's own kinds, not typed: 12 http + 6 session.
    const serverBound = fixture.expected_vector_ids.filter((id) =>
      ["http", "session"].includes(fixture.vector_kinds[id])
    );
    expect(document.http_coverage).toEqual({ total: serverBound.length, executed: 2 });
    expect(document.http_coverage.total).toBe(18);
  });

  it("derives spec_version, vector_set_ref and the implementation identity — nothing retyped", () => {
    expect(document.spec_version).toBe(SPEC_VERSION);
    expect(document.vector_set_ref).toBe(fixture.source.commit);
    expect(document.vector_set).toEqual({
      repo: "TailorAU/pact",
      commit: fixture.source.commit,
      path: `spec/v${SPEC_VERSION}/conformance`,
      inventory_path: ".github/conformance/v2.3-reference-server-expected-failures.json",
      vendored_fixture: "sites/source/src/lib/fixtures/pact-v23/execution-boundary-vectors.json",
      fixture_sha256: crypto.createHash("sha256").update(fixtureBytes).digest("hex"),
    });
    expect(document.implementation.name).toBe(PROFILE_NAME);
    expect(document.implementation.version).toBe(IMPLEMENTATION_VERSION);
    expect(document.implementation.profile).toBe(buildPactProfile().endpoints.wellKnown);
    expect(document.implementation.harness).toEqual({ itest: HARNESS_FILE });
    expect(document.runner_disclaimer).toBe(RUNNER_DISCLAIMER);
  });

  it("publishes at the URL the SHIPPED profile advertises — the two advertisements share one builder", () => {
    const shipped = buildPactProfile(PUBLIC_BASE_URL, { conformanceReportShipped: true });
    expect(document.publication.served).toBe(shipped.endpoints.conformanceResults);
    expect(document.publication.served).toBe(`${PUBLIC_BASE_URL}${CONFORMANCE_RESULTS_PATH}`);
    expect(document.publication.artifact).toBe(RESULTS_ARTIFACT_NAME);
    expect(document.publication.artifact_visibility).toMatch(/PRIVATE repository/);
  });

  it("stamps this run's provenance", () => {
    expect(document.provenance).toEqual({ stamped: true, produced_by: "ci" });
    expect(document.implementation.commit).toBe(SHA);
    expect(document.implementation.run_id).toBe(RUN_ID);
    expect(document.implementation.run_attempt).toBe("1");
    expect(document.implementation.run_url).toContain(RUN_ID);
    expect(document.implementation.repo).toBe("TailorAU/tailor-app");
    expect(document.implementation.workflow).toBe(PRODUCING_WORKFLOW);
    expect(document.implementation.job).toBe(PRODUCING_JOB);
    expect(document.implementation.generated_at).toBe("2026-09-02T00:00:00.000Z");
  });

  it("a pass carries no reason and lists the declared adaptations; every non-pass carries a reason", () => {
    for (const result of document.results) {
      expect(OUTCOME_STATUSES).toContain(result.outcome.status);
      expect(result.kind).toBe(fixture.vector_kinds[result.id]);
      expect(result.path).toBe(fixture.vector_paths[result.id]);
      if (result.outcome.status === "pass") {
        expect(result.outcome).toEqual({ status: "pass" });
        expect(result.disposition).toBe("executed-adapted");
        expect(result.execution).toEqual({ test: HARNESS_FILE, adaptations: [...DECLARED_ADAPTATIONS] });
      } else {
        expect(result.outcome.reason?.trim().length ?? 0).toBeGreaterThan(0);
        expect(result.execution).toBeUndefined();
      }
      // The README reserves verification_mode for verification pass/fail;
      // every verification vector is excluded here, so none carries one.
      expect("verification_mode" in result).toBe(false);
    }
    const executedIds = document.results.filter((r) => r.outcome.status === "pass").map((r) => r.id);
    expect(executedIds.sort()).toEqual([...acceptance.executed].sort());
  });

  it("each exclusion says WHY in the manifest's own words, and the skip carries its tracking", () => {
    const acceptanceExcluded = new Map(acceptance.capability_excluded.map((e) => [e.id, e]));
    for (const result of document.results) {
      const fromAcceptance = acceptanceExcluded.get(result.id);
      if (fromAcceptance) {
        expect(result.outcome).toEqual({ status: "excluded", reason: fromAcceptance.reason });
        expect(result.declaration).toEqual({ requires: { effect_class: fromAcceptance.requires.effect_class } });
        expect(result.disposition).toBe("not-served");
      }
    }
    const join = document.results.find((r) => r.id === "core/join/basic")!;
    expect(join.outcome.status).toBe("skip");
    expect(join.disposition).toBe("unharnessed");
    expect(join.tracking).toMatch(/^TailorAU\/tailor-app#\d+$/);
    expect(join.requires).toEqual({ capabilities: ["inviteTokens"] });
    const attest = document.results.find((r) => r.id === "extended/attestation/verify-fido2-valid")!;
    expect(attest.outcome.status).toBe("excluded");
    expect(attest.cites).toEqual({ capabilities: ["authorizationProof"], declaredGap: "§17.4 / §17.6 principals and proofs" });
  });

  it("re-verifies clean, serialises deterministically, and every id is unique", () => {
    expect(verifyConformanceReport(document, fixture.expected_vector_ids)).toEqual([]);
    expect(JSON.stringify(buildConformanceReport(input()))).toBe(JSON.stringify(document));
    expect(new Set(document.results.map((r) => r.id)).size).toBe(document.results.length);
  });
});

describe("conformance report — a red run still produces its red document (#5567 soft gate)", () => {
  it("a failing record publishes fail + the assertion message + disposition regression, and counts recompute", () => {
    const [first, second] = acceptance.executed;
    const document = buildConformanceReport(
      input({
        records: [
          { id: first, status: "pass" },
          { id: second, status: "fail", message: `${second} / read-back: HTTP status: expected 200, got 500` },
        ],
      })
    );
    expect(document.counts).toEqual({ pass: 1, fail: 1, skip: 1, excluded: 44 });
    expect(document.dispositions).toEqual({ "executed-adapted": 1, regression: 1, "not-served": 44, unharnessed: 1 });
    const red = document.results.find((r) => r.id === second)!;
    expect(red.outcome).toEqual({ status: "fail", reason: `${second} / read-back: HTTP status: expected 200, got 500` });
    expect(red.disposition).toBe("regression");
    expect(red.execution?.test).toBe(HARNESS_FILE);
    // Both executed server-bound vectors RAN — a fail is still an execution.
    expect(document.http_coverage).toEqual({ total: 18, executed: 2 });
    expect(verifyConformanceReport(document, fixture.expected_vector_ids)).toEqual([]);
  });
});

describe("conformance report — a vector that never settled publishes as red, never as no document (#5567 soft gate)", () => {
  const [first, second] = acceptance.executed;
  const unsettled = (id: string): VectorRecord => ({ id, status: "fail", message: UNSETTLED_VECTOR_REASON });

  it("fillUnsettledRecords fills every executed id without a record, in acceptance order, and never touches a settled one", () => {
    // Nothing settled — the whole suite hung, or was aborted after beforeAll.
    expect(fillUnsettledRecords([], acceptance.executed)).toEqual(acceptance.executed.map(unsettled));
    // One settled, one hung: the recorded outcome stays first, the fill follows.
    expect(fillUnsettledRecords([{ id: first, status: "pass" }], acceptance.executed)).toEqual([
      { id: first, status: "pass" },
      unsettled(second),
    ]);
    // A settled FAIL keeps its own assertion message — the fill never overwrites a record.
    const red: VectorRecord = { id: second, status: "fail", message: "read-back: HTTP status: expected 200, got 500" };
    expect(fillUnsettledRecords([red], acceptance.executed)).toEqual([red, unsettled(first)]);
    // A complete record set comes back unchanged.
    expect(fillUnsettledRecords(passing, acceptance.executed)).toEqual(passing);
  });

  it("with the fill, a suite in which every vector hung still builds its document — fail + the unsettled reason + regression, counts recompute, verifies clean", () => {
    const document = buildConformanceReport(input({ records: fillUnsettledRecords([], acceptance.executed) }));
    const hung = acceptance.executed.length;
    expect(document.counts).toEqual({ pass: 0, fail: hung, skip: 1, excluded: 44 });
    expect(document.dispositions).toEqual({ "executed-adapted": 0, regression: hung, "not-served": 44, unharnessed: 1 });
    for (const id of acceptance.executed) {
      const result = document.results.find((r) => r.id === id)!;
      expect(result.outcome).toEqual({ status: "fail", reason: UNSETTLED_VECTOR_REASON });
      expect(result.disposition).toBe("regression");
      expect(result.execution?.test).toBe(HARNESS_FILE);
    }
    expect(verifyConformanceReport(document, fixture.expected_vector_ids)).toEqual([]);
  });

  it("without the fill the same record sets are refused — the fill is what keeps the deploy gate soft on a hang", () => {
    expect(() => buildConformanceReport(input({ records: [] }))).toThrow(/no record for executed vector/);
    expect(() => buildConformanceReport(input({ records: [{ id: first, status: "pass" }] }))).toThrow(
      /no record for executed vector/
    );
  });

  it("the fill launders nothing the builder must still refuse — a foreign id or a duplicate stays refused", () => {
    const foreign: VectorRecord[] = [{ id: "extended/nope/x", status: "pass" }];
    expect(() => buildConformanceReport(input({ records: fillUnsettledRecords(foreign, acceptance.executed) }))).toThrow(
      /not in the corpus/
    );
    const duplicated: VectorRecord[] = [{ id: first, status: "pass" }, { id: first, status: "pass" }];
    expect(() => buildConformanceReport(input({ records: fillUnsettledRecords(duplicated, acceptance.executed) }))).toThrow(
      /duplicate record/
    );
  });
});

describe("conformance report — vitest's verdict is the document's verdict (#5567 late-settle race)", () => {
  const [first, second] = acceptance.executed;
  // vitest 4's own testTimeout text, as ctx.task.result.errors[0].message carries it.
  const timedOut =
    'Test timed out in 60000ms.\nIf this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".';

  it("a late pass after a fail verdict — fail wins, in place, with the runner's own error text", () => {
    // testTimeout rejected the test; the wrapped promise then resolved and a
    // `pass` was pushed anyway (the harness ignores such a settle, but the
    // reconciliation must not depend on that).
    const late: VectorRecord[] = [
      { id: first, status: "pass" },
      { id: second, status: "pass" },
    ];
    expect(reconcileWithRunnerVerdict(late, second, { state: "fail", message: timedOut })).toEqual([
      { id: first, status: "pass" },
      { id: second, status: "fail", message: timedOut },
    ]);
    // The promise is still pending when vitest rules: the verdict is
    // appended, and the unsettled fill then has nothing left to fill.
    const pending = reconcileWithRunnerVerdict([{ id: first, status: "pass" }], second, { state: "fail", message: timedOut });
    expect(pending).toEqual([
      { id: first, status: "pass" },
      { id: second, status: "fail", message: timedOut },
    ]);
    expect(fillUnsettledRecords(pending, acceptance.executed)).toEqual(pending);
    // The input was never mutated.
    expect(late[1]).toEqual({ id: second, status: "pass" });
  });

  it("a normal pass stays pass; a pass verdict never overturns a recorded fail and never invents a record", () => {
    expect(reconcileWithRunnerVerdict(passing, first, { state: "pass" })).toEqual(passing);
    const red: VectorRecord[] = [{ id: first, status: "fail", message: "read-back: HTTP status: expected 200, got 500" }];
    expect(reconcileWithRunnerVerdict(red, first, { state: "pass" })).toEqual(red);
    expect(reconcileWithRunnerVerdict([], first, { state: "pass" })).toEqual([]);
  });

  it("a fail is a fail with the message — the runner's text, or the fallback reason when it carried none", () => {
    const message = `${first} / read-back: HTTP status: expected 200, got 500`;
    const settled: VectorRecord[] = [{ id: first, status: "fail", message }];
    expect(reconcileWithRunnerVerdict(settled, first, { state: "fail", message })).toEqual(settled);
    expect(reconcileWithRunnerVerdict([], first, { state: "fail" })).toEqual([
      { id: first, status: "fail", message: RUNNER_FAIL_REASON },
    ]);
    expect(reconcileWithRunnerVerdict([{ id: first, status: "pass" }], first, { state: "fail", message: "  " })).toEqual([
      { id: first, status: "fail", message: RUNNER_FAIL_REASON },
    ]);
  });

  it("the reconciled records build a document that says fail where CI said fail, and it verifies clean", () => {
    const document = buildConformanceReport(
      input({ records: reconcileWithRunnerVerdict(passing, second, { state: "fail", message: timedOut }) })
    );
    expect(document.counts).toEqual({ pass: 1, fail: 1, skip: 1, excluded: 44 });
    const red = document.results.find((r) => r.id === second)!;
    expect(red.outcome).toEqual({ status: "fail", reason: timedOut });
    expect(red.disposition).toBe("regression");
    expect(verifyConformanceReport(document, fixture.expected_vector_ids)).toEqual([]);
  });

  it("launders nothing — a duplicate is replaced occurrence-for-occurrence and stays refused", () => {
    const duplicated: VectorRecord[] = [
      { id: first, status: "pass" },
      { id: first, status: "pass" },
      { id: second, status: "pass" },
    ];
    const reconciled = reconcileWithRunnerVerdict(duplicated, first, { state: "fail", message: timedOut });
    expect(reconciled.filter((r) => r.id === first)).toHaveLength(2);
    expect(() => buildConformanceReport(input({ records: reconciled }))).toThrow(/duplicate record/);
  });
});

describe("conformance report — every refusal bites (#5567)", () => {
  const [first, second] = acceptance.executed;

  it("a record for an id outside the corpus", () => {
    expect(() => buildConformanceReport(input({ records: [...passing, { id: "extended/nope/x", status: "pass" }] }))).toThrow(
      /not in the corpus/
    );
  });

  it("a record for a corpus id the harness does not execute", () => {
    const excludedId = acceptance.capability_excluded[0].id;
    expect(() => buildConformanceReport(input({ records: [...passing, { id: excludedId, status: "pass" }] }))).toThrow(
      /does not execute/
    );
  });

  it("a duplicate record", () => {
    expect(() => buildConformanceReport(input({ records: [...passing, { id: first, status: "pass" }] }))).toThrow(/duplicate record/);
  });

  it("a missing record for an executed id — a skipped or aborted suite never yields a document", () => {
    expect(() => buildConformanceReport(input({ records: [{ id: first, status: "pass" }] }))).toThrow(
      new RegExp(`no record for executed vector ${second.replace(/[/.]/g, "\\$&")}`)
    );
    expect(() => buildConformanceReport(input({ records: [] }))).toThrow(/no record for executed vector/);
  });

  it("a fail without a message — a non-pass must carry a reason", () => {
    expect(() =>
      buildConformanceReport(input({ records: [{ id: first, status: "pass" }, { id: second, status: "fail" }] }))
    ).toThrow(/failed without a message/);
    expect(() =>
      buildConformanceReport(input({ records: [{ id: first, status: "pass" }, { id: second, status: "fail", message: "  " }] }))
    ).toThrow(/failed without a message/);
  });

  it("missing or malformed GITHUB_SHA / GITHUB_RUN_ID, unless the caller opts into an unstamped document", () => {
    const base = input().provenance;
    expect(() => buildConformanceReport(input({ provenance: { ...base, commit: undefined } }))).toThrow(/GITHUB_SHA/);
    expect(() => buildConformanceReport(input({ provenance: { ...base, commit: "abc123" } }))).toThrow(/40-hex/);
    expect(() => buildConformanceReport(input({ provenance: { ...base, run_id: "" } }))).toThrow(/GITHUB_RUN_ID/);
    expect(() => buildConformanceReport(input({ provenance: { ...base, run_id: undefined } }))).toThrow(/GITHUB_RUN_ID/);

    const local = buildConformanceReport(
      input({ provenance: { generated_at: base.generated_at, unstamped: true } })
    );
    expect(local.provenance).toEqual({ stamped: false, produced_by: "local" });
    expect(local.implementation.commit).toBeNull();
    expect(local.implementation.run_id).toBeNull();
    // ...and the validator's own rule: an unstamped document is not shippable.
    expect(local.provenance.stamped).toBe(false);
  });

  it("manifests pinned to different pact commits", () => {
    const drifted = clone(acceptance);
    (drifted as unknown as { pact_commit: string }).pact_commit = "f".repeat(40);
    expect(() => buildConformanceReport(input({ acceptance: drifted }))).toThrow(/acceptance manifest pins/);
    const driftedDispositions = clone(dispositions);
    (driftedDispositions as unknown as { pact_commit: string }).pact_commit = "f".repeat(40);
    expect(() => buildConformanceReport(input({ dispositions: driftedDispositions }))).toThrow(/dispositions manifest pins/);
  });

  it("a fixture pinned to a different spec generation than the profile claims", () => {
    const other = clone(fixture);
    (other.source as unknown as { conformance_path: string }).conformance_path = "spec/v9.9/conformance";
    expect(() => buildConformanceReport(input({ fixture: other }))).toThrow(/conformance_path/);
  });

  it("a fixture missing a kind or a path for a corpus id", () => {
    const noKind = clone(fixture);
    delete (noKind.vector_kinds as unknown as Record<string, string>)["core/join/basic"];
    expect(() => buildConformanceReport(input({ fixture: noKind }))).toThrow(/no kind for core\/join\/basic/);
    const noPath = clone(fixture);
    delete (noPath.vector_paths as unknown as Record<string, string>)["core/join/basic"];
    expect(() => buildConformanceReport(input({ fixture: noPath }))).toThrow(/no path for core\/join\/basic/);
  });

  it("a disposition manifest that drops an id or cites a flag the profile serves true", () => {
    const dropped = clone(dispositions);
    (dropped.families[0].ids as string[]).pop();
    expect(() => buildConformanceReport(input({ dispositions: dropped }))).toThrow(/unaccounted vector/);

    const lying = clone(dispositions);
    (lying.families[2] as unknown as { cites: { capabilities: string[] } }).cites = { capabilities: ["inviteTokens"] };
    expect(() => buildConformanceReport(input({ dispositions: lying }))).toThrow(/capabilities\.inviteTokens=false/);
  });
});

describe("verifyConformanceReport — a tampered document is refused (#5567)", () => {
  const good = buildConformanceReport(input());
  const ids = fixture.expected_vector_ids;
  const tamper = (mutate: (doc: ConformanceReport) => void): string[] => {
    const copy = clone(good);
    mutate(copy);
    return verifyConformanceReport(copy, ids);
  };

  it("the good document passes; non-documents are refused", () => {
    expect(verifyConformanceReport(good, ids)).toEqual([]);
    expect(verifyConformanceReport(null, ids)).not.toEqual([]);
    expect(verifyConformanceReport({ results: "no" }, ids)).not.toEqual([]);
  });

  it("counts that do not recompute", () => {
    expect(tamper((d) => ((d.counts as unknown as { pass: number }).pass = 47))).toContainEqual(expect.stringContaining("counts.pass"));
    expect(tamper((d) => ((d.counts as unknown as { excluded: number }).excluded = 0))).toContainEqual(expect.stringContaining("counts.excluded"));
  });

  it("a dropped, duplicated or reordered result", () => {
    expect(tamper((d) => (d.results as unknown[]).pop())).toContainEqual(expect.stringContaining("not exactly the corpus"));
    expect(tamper((d) => (d.results as unknown[]).push(clone(d.results[0])))).toContainEqual(expect.stringContaining("duplicate result ids"));
    expect(tamper((d) => (d.results as unknown[]).reverse())).toContainEqual(expect.stringContaining("not exactly the corpus"));
  });

  it("a status outside the vocabulary, a pass with a reason, a non-pass without one, a skip without tracking", () => {
    expect(tamper((d) => ((d.results[1].outcome as unknown as { status: string }).status = "adapted"))).toContainEqual(
      expect.stringContaining("outside pass/fail/skip/excluded")
    );
    const passIndex = good.results.findIndex((r) => r.outcome.status === "pass");
    expect(tamper((d) => ((d.results[passIndex].outcome as unknown as { reason?: string }).reason = "why"))).toContainEqual(
      expect.stringContaining("must not carry a reason")
    );
    expect(tamper((d) => delete (d.results[1].outcome as unknown as { reason?: string }).reason)).toContainEqual(
      expect.stringContaining("carries no reason")
    );
    const skipIndex = good.results.findIndex((r) => r.outcome.status === "skip");
    expect(tamper((d) => delete (d.results[skipIndex] as unknown as { tracking?: string }).tracking)).toContainEqual(
      expect.stringContaining("carries no tracking")
    );
  });

  it("a stamped document whose commit or run id is not a real stamp", () => {
    expect(tamper((d) => ((d.implementation as unknown as { commit: string }).commit = "deadbeef"))).toContainEqual(
      expect.stringContaining("40-hex")
    );
    expect(tamper((d) => ((d.implementation as unknown as { run_id: string }).run_id = ""))).toContainEqual(
      expect.stringContaining("run_id")
    );
    expect(tamper((d) => ((d as unknown as { spec_version: string }).spec_version = "2.2"))).toContainEqual(
      expect.stringContaining("spec_version")
    );
  });
});
