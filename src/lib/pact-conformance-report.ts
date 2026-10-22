/**
 * The KG's PACT v2.3 conformance results document — a PURE builder (#5567).
 *
 * `execution-boundary-vectors.itest.ts` records a pass / fail per executed
 * vector as it runs them against the real route handlers on real Postgres,
 * and in its own `afterAll` hands those records — together with the three
 * committed, test-enforced manifests and this run's CI provenance — to
 * {@link buildConformanceReport}, which returns the document CI writes,
 * validates against the run, bakes into `public/.well-known/` and serves at
 * `endpoints.conformanceResults`.
 *
 * ## Why pure
 *
 * No `fs`, no clock, no environment is read here. Everything the document
 * says is either (a) a value handed in by the harness that just ran, (b) a
 * constant imported from the module that enforces it (`spec_version` and
 * the implementation identity come from `./pact-profile` exactly as the
 * served discovery document does — never retyped), or (c) derived by
 * recomputation. That is what makes every refusal below a unit test rather
 * than a CI-only hope, and what keeps the document identical for every
 * caller with the same inputs.
 *
 * ## Vocabulary — the pact runner's, not our own
 *
 * The shape is `spec/v2.3/conformance/runner/README.md` (TailorAU/pact@8d0f305, the
 * last old-main commit that carries the v2.3 spec) "Report schema" +
 * "Consuming implementations": `counts`, `results[{path,id,kind,outcome}]`,
 * `runner_disclaimer`, `http_coverage`, stamped `spec_version` +
 * `vector_set_ref`; `outcome.status` stays inside `pass` / `fail` / `skip`
 * plus the README-sanctioned `excluded` (with a reason and a
 * `counts.excluded` tally). Everything else this document carries is
 * ADDITIVE (`disposition`, `implementation`, `provenance`, `publication`,
 * `vector_set`, per-result `execution` / `cites` / `tracking`), which the
 * README says the gate ignores.
 *
 * ## The status rule (one rule, applied mechanically)
 *
 *  - `pass`     — the vector executed and every expectation held verbatim
 *                 or through a DECLARED pure renaming (surface mapping,
 *                 symbolic-id binding, a key alias with the expected VALUE
 *                 unchanged). The renamings are listed per result.
 *  - `fail`     — executed and at least one expected value, status or
 *                 obligation was replaced by a different actual; the reason
 *                 names it. The document is still produced — a red run
 *                 publishes its red document (the soft-gate posture Knox
 *                 chose on #5567), it does not hide it.
 *  - `skip`     — executable in principle against this implementation but
 *                 not executed; always a reason AND a tracking reference.
 *  - `excluded` — not executable against this implementation by its OWN
 *                 served declaration: a capability flag `/.well-known/pact.json`
 *                 carries as `false`, or a declared gap it states. `cites`
 *                 names the flag; {@link citationFailures} proves it is live.
 *
 * ## What the builder refuses (throws, writes nothing)
 *
 * A record for an id outside the corpus or for an id the harness does not
 * execute; a missing record for an executed id (a skipped or aborted suite
 * must never yield a document); a duplicate record; a `fail` without a
 * message; a fixture pinned to a different spec generation than the
 * profile claims; manifests pinned to different pact commits; an
 * exclusion citing a capability that is actually served `true`; and
 * missing `GITHUB_SHA` / `GITHUB_RUN_ID` unless the caller explicitly asks
 * for an `unstamped` document — which the deploy validator in
 * `cd-source.yml` rejects, so an unstamped document can only ever be a
 * local eyeball, never the wire.
 *
 * ## What the harness completes BEFORE building (the soft gate stays soft)
 *
 * A record is pushed only when a vector's `it` SETTLES, and vitest's
 * `testTimeout` rejects a test without stopping the wrapped promise. Two
 * pure completions close both gaps, and the harness runs them before it
 * builds. {@link reconcileWithRunnerVerdict} (from the harness's
 * `afterEach`) forces the record of any test vitest reported as failed to
 * `fail` + the runner's own error text, so a promise that resolves late can
 * never publish `pass` for a vector CI reported red. Then
 * {@link fillUnsettledRecords} records every executed id still without a
 * record — one that neither settled nor was reported failed — as `fail`
 * carrying {@link UNSETTLED_VECTOR_REASON} (disposition `regression`). The
 * rule this yields: a suite whose fixture-integrity test passed and that
 * reached its `afterAll` always produces a document, red where red. No
 * document is written only when the fixture-integrity check did not pass
 * (including a suite that never executed it), the harness refuses to start
 * (a results path without `DATABASE_URL`), the builder refuses what remains
 * (an unstamped run, a citation no longer live), or the `kg-conformance`
 * job never reaches the harness at all (dependency install,
 * service-container health, runner loss, the 15-minute job timeout) — an
 * absent artifact is refused by the deploy validator the same way. Because
 * the fill runs first, the missing-record refusal above can never fire from
 * the harness path; it remains a unit-tested guard for direct callers.
 */

import {
  CONFORMANCE_RESULTS_PATH,
  IMPLEMENTATION_VERSION,
  PROFILE_NAME,
  PUBLIC_BASE_URL,
  SPEC_VERSION,
  buildPactProfile,
  type PactImplementationProfile,
} from "./pact-profile";

/** The workflow artifact name `cd-source.yml` uploads and downloads. */
export const RESULTS_ARTIFACT_NAME = "kg-v23-conformance-report";

/** The harness that produces the records. */
export const HARNESS_FILE = "execution-boundary-vectors.itest.ts";

/** The workflow + job that produce the document on `main`. */
export const PRODUCING_WORKFLOW = "cd-source.yml";
export const PRODUCING_JOB = "kg-conformance";

export const OUTCOME_STATUSES = ["pass", "fail", "skip", "excluded"] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

/** The closed disposition vocabulary this implementation publishes. */
export const DISPOSITIONS = ["executed-adapted", "regression", "not-served", "unharnessed"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** Server-bound kinds per the README's `http_coverage` grouping. */
const SERVER_BOUND_KINDS = new Set(["http", "session"]);

/**
 * The declared adaptation seam of the executed vectors — the four kinds
 * stated in `execution-boundary-vectors.itest.ts`'s header plus the one
 * key alias. Every entry is a pure renaming (the expected VALUE is
 * unchanged), which is what lets an adapted execution publish as `pass`.
 */
export const DECLARED_ADAPTATIONS: readonly string[] = [
  "surface mapping: GET /_status and GET /manifest dispatch to GET /api/pact/{topicId} — the topic read is the KG's status and export surface (capabilities.manifest stays false)",
  "id binding: the vector's symbolic proposal ids are bound to the ids the KG mints at the create step; the vector's symbolic fabric and section ids are bound to a fresh run-suffixed seed (the event store is append-only, §6.4)",
  "request shaping: the KG's create requires newContent (derived from the vector's own summary), enforces a 30s TTL floor, and its assumption QA gate is satisfied in precondition seeding — vector bodies are otherwise unchanged",
  "engine hooks: where the vector's timeline says the TTL elapses, the hook casts the KG's Silence=Consent endorsement floor, shifts created_at back, and invokes the REAL sweep entry (autoMergeExpired) the cron route calls",
  "key alias: the create response's `status` (the KG's own `pending`, #5564) is asserted against the additive `protocol_status` key; the expected value `open` is unchanged. The KG's create is 201 where the vector says 200 — accepted as the same success class and declared here",
];

export const RUNNER_DISCLAIMER =
  "Self-reported by the Source (KG) implementation's own harness " +
  `(${HARNESS_FILE}: the vendored vectors dispatched to the real route ` +
  "handlers on real Postgres), NOT by @pact-protocol/conformance-runner. " +
  "Status rule: pass = the vector executed and every expectation held " +
  "verbatim or through a DECLARED pure renaming (surface mapping, " +
  "symbolic-id binding, a key alias with the expected value unchanged — " +
  "listed per result under execution.adaptations); fail = executed and at " +
  "least one expected value, status or obligation was replaced by a " +
  "different actual (the reason names it); skip = executable in principle " +
  "against this implementation but not executed (reason + tracking); " +
  "excluded = not executable against this implementation by its OWN " +
  "served declaration — a capability flag /.well-known/pact.json carries " +
  "as false, or a declared gap it states (cites names it) — never a " +
  "silently dropped vector. No result carries verification_mode: every " +
  "kind: verification vector is excluded because this implementation " +
  "verifies no authorization_proof. http_coverage.executed counts " +
  "server-bound (http / session) vectors that actually ran; excluded " +
  "server-bound vectors are not counted as executed.";

// ── Inputs ──────────────────────────────────────────────────────────────

/** One executed vector's outcome, as recorded by the harness. */
export interface VectorRecord {
  readonly id: string;
  readonly status: "pass" | "fail";
  /** Required when `status` is `fail` — the assertion message. */
  readonly message?: string;
}

/**
 * The reason an executed vector publishes with when its `it` never settled
 * AND vitest never reported it failed (skipped, aborted or cancelled, in a
 * run that still reached `afterAll`): `recordVector()` had nothing to push
 * and {@link reconcileWithRunnerVerdict} nothing to force, so
 * {@link fillUnsettledRecords} records the absence as a red result rather
 * than letting the missing-record refusal yield no document. A
 * `testTimeout` does not land here — vitest adjudicates it, and the record
 * carries vitest's own message.
 */
export const UNSETTLED_VECTOR_REASON =
  "no outcome recorded — the test neither settled nor was reported failed by vitest (skipped, aborted or cancelled run)";

/** The reason a vector publishes with when vitest reported its test failed but carried no error message. */
export const RUNNER_FAIL_REASON = "vitest reported the test failed";

/** What vitest itself reported for a vector's test — `ctx.task.result` as the harness's `afterEach` sees it. */
export type RunnerVerdict = { readonly state: "pass" } | { readonly state: "fail"; readonly message?: string };

/** The slice of `fixtures/pact-v23/execution-boundary-vectors.json` the builder reads. */
export interface CorpusFixture {
  readonly source: {
    readonly repo: string;
    readonly commit: string;
    readonly conformance_path: string;
    readonly inventory_path: string;
  };
  readonly expected_vector_ids: readonly string[];
  readonly vector_kinds: Readonly<Record<string, string>>;
  readonly vector_paths: Readonly<Record<string, string>>;
}

/** `fixtures/pact-v23/execution-boundary-acceptance.json`. */
export interface AcceptanceManifest {
  readonly pact_commit: string;
  readonly executed: readonly string[];
  readonly capability_excluded: readonly {
    readonly id: string;
    readonly requires: { readonly effect_class: string };
    readonly reason: string;
  }[];
}

export interface DispositionCitations {
  /** Capability flags the entry rests on — MUST be served `false`. */
  readonly capabilities?: readonly string[];
  /** A declared gap `area` the entry rests on — MUST be on the wire. */
  readonly declaredGap?: string;
}

export interface DispositionRequirements {
  /** Capability flags a `skip` claims are served — MUST be `true`. */
  readonly capabilities?: readonly string[];
}

export interface DispositionFamily {
  readonly family: string;
  readonly status: "excluded" | "skip";
  readonly disposition: Disposition;
  readonly cites?: DispositionCitations;
  readonly requires?: DispositionRequirements;
  readonly reason: string;
  readonly tracking?: string;
  readonly ids: readonly string[];
}

export interface DispositionVector {
  readonly id: string;
  readonly status: "excluded" | "skip";
  readonly disposition: Disposition;
  readonly cites?: DispositionCitations;
  readonly requires?: DispositionRequirements;
  readonly reason: string;
  readonly tracking?: string;
}

/** `fixtures/pact-v23/conformance-dispositions.json`. */
export interface DispositionsManifest {
  readonly pact_commit: string;
  readonly families: readonly DispositionFamily[];
  readonly vectors: readonly DispositionVector[];
}

/** One id's disposition, family entries flattened. */
export interface DispositionEntry {
  readonly id: string;
  readonly status: "excluded" | "skip";
  readonly disposition: Disposition;
  readonly reason: string;
  readonly cites?: DispositionCitations;
  readonly requires?: DispositionRequirements;
  readonly tracking?: string;
  readonly family?: string;
}

/** This run's identity, as the harness reads it from the CI environment. */
export interface RunProvenance {
  /** `GITHUB_SHA` — 40-hex, required unless `unstamped`. */
  readonly commit?: string;
  /** `GITHUB_RUN_ID` — required unless `unstamped`. */
  readonly run_id?: string;
  readonly run_attempt?: string;
  readonly run_url?: string;
  readonly repository?: string;
  readonly workflow?: string;
  readonly job?: string;
  /** ISO-8601 UTC, supplied by the caller — this module reads no clock. */
  readonly generated_at: string;
  /** Explicit opt-in to a document with no run stamp (local eyeballing only). */
  readonly unstamped?: boolean;
}

/** The vendored fixture the records were read from, as the harness hashed it. */
export interface VendoredFixture {
  readonly path: string;
  readonly sha256: string;
}

export interface BuildConformanceReportInput {
  readonly records: readonly VectorRecord[];
  readonly fixture: CorpusFixture;
  readonly acceptance: AcceptanceManifest;
  readonly dispositions: DispositionsManifest;
  readonly provenance: RunProvenance;
  readonly vendored: VendoredFixture;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface ConformanceOutcome {
  readonly status: OutcomeStatus;
  /** Present on every non-pass result; never on a pass (README). */
  readonly reason?: string;
}

export interface ConformanceResult {
  readonly path: string;
  readonly id: string;
  readonly kind: string;
  readonly outcome: ConformanceOutcome;
  readonly disposition: Disposition;
  readonly execution?: { readonly test: string; readonly adaptations: readonly string[] };
  readonly declaration?: { readonly requires: { readonly effect_class: string } };
  readonly cites?: DispositionCitations;
  readonly requires?: DispositionRequirements;
  readonly tracking?: string;
}

export interface ConformanceReport {
  readonly spec_version: string;
  readonly vector_set_ref: string;
  readonly vector_set: {
    readonly repo: string;
    readonly commit: string;
    readonly path: string;
    readonly inventory_path: string;
    readonly vendored_fixture: string;
    readonly fixture_sha256: string;
  };
  readonly implementation: {
    readonly name: string;
    readonly version: string;
    readonly profile: string;
    readonly repo: string | null;
    readonly commit: string | null;
    readonly run_id: string | null;
    readonly run_attempt: string | null;
    readonly run_url: string | null;
    readonly workflow: string;
    readonly job: string;
    readonly generated_at: string;
    readonly harness: { readonly itest: string };
  };
  readonly provenance: { readonly stamped: boolean; readonly produced_by: "ci" | "local" };
  readonly publication: {
    readonly served: string;
    readonly artifact: string;
    readonly artifact_visibility: string;
  };
  readonly counts: Record<OutcomeStatus, number>;
  readonly dispositions: Record<Disposition, number>;
  readonly http_coverage: { readonly total: number; readonly executed: number };
  readonly runner_disclaimer: string;
  readonly results: readonly ConformanceResult[];
}

// ── Pure checks (exported so the tests prove each one bites) ────────────

/** Family entries flattened to one entry per id, plus the per-id entries. */
export function flattenDispositions(m: DispositionsManifest): DispositionEntry[] {
  const out: DispositionEntry[] = [];
  for (const family of m.families) {
    for (const id of family.ids) {
      out.push({
        id,
        family: family.family,
        status: family.status,
        disposition: family.disposition,
        reason: family.reason,
        ...(family.cites ? { cites: family.cites } : {}),
        ...(family.requires ? { requires: family.requires } : {}),
        ...(family.tracking ? { tracking: family.tracking } : {}),
      });
    }
  }
  for (const vector of m.vectors) {
    out.push({
      id: vector.id,
      status: vector.status,
      disposition: vector.disposition,
      reason: vector.reason,
      ...(vector.cites ? { cites: vector.cites } : {}),
      ...(vector.requires ? { requires: vector.requires } : {}),
      ...(vector.tracking ? { tracking: vector.tracking } : {}),
    });
  }
  return out;
}

const TRACKING_SHAPE = /^TailorAU\/[A-Za-z0-9_.-]+#\d+$/;

/**
 * The exact-set accounting: acceptance.executed ∪ acceptance.capability_excluded
 * ∪ dispositions == expectedIds, disjoint, no phantoms; every disposition
 * entry well-formed. Returns failure strings; [] means accepted.
 */
export function accountingFailures(
  expectedIds: readonly string[],
  acceptance: AcceptanceManifest,
  dispositions: DispositionsManifest
): string[] {
  const failures: string[] = [];
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length) failures.push("expected_vector_ids carries a duplicate id");

  const entries = flattenDispositions(dispositions);
  const claimed: { id: string; via: string }[] = [
    ...acceptance.executed.map((id) => ({ id, via: "acceptance.executed" })),
    ...acceptance.capability_excluded.map((e) => ({ id: e.id, via: "acceptance.capability_excluded" })),
    ...entries.map((e) => ({ id: e.id, via: e.family ? `dispositions.families[${e.family}]` : "dispositions.vectors" })),
  ];

  const seen = new Map<string, string>();
  for (const { id, via } of claimed) {
    if (!expected.has(id)) failures.push(`phantom id (not in the corpus): ${id} via ${via}`);
    const prior = seen.get(id);
    if (prior) failures.push(`${id} is claimed twice: ${prior} and ${via}`);
    seen.set(id, via);
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) failures.push(`unaccounted vector: ${id}`);
  }

  for (const family of dispositions.families) {
    if (family.ids.length === 0) failures.push(`family ${family.family} lists no ids`);
    for (const id of family.ids) {
      if (!id.startsWith(`${family.family}/`)) failures.push(`${id} is filed under family ${family.family}`);
    }
  }
  for (const entry of entries) {
    if (entry.id.startsWith("extended/execution-boundary/")) {
      failures.push(`${entry.id} belongs to execution-boundary-acceptance.json, not the dispositions manifest`);
    }
    if (entry.status !== "excluded" && entry.status !== "skip") {
      failures.push(`${entry.id}: status ${String(entry.status)} is not excluded/skip`);
    }
    if (!DISPOSITIONS.includes(entry.disposition)) {
      failures.push(`${entry.id}: disposition ${String(entry.disposition)} is outside the closed vocabulary`);
    }
    if (entry.status === "excluded" && entry.disposition !== "not-served") {
      failures.push(`${entry.id}: an excluded entry must carry disposition not-served`);
    }
    if (entry.status === "skip" && entry.disposition !== "unharnessed") {
      failures.push(`${entry.id}: a skip entry must carry disposition unharnessed`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      failures.push(`${entry.id} carries no reason`);
    }
    if (entry.status === "excluded") {
      const cited = [...(entry.cites?.capabilities ?? []), ...(entry.cites?.declaredGap ? [entry.cites.declaredGap] : [])];
      if (cited.length === 0) failures.push(`${entry.id} is excluded but cites no served flag or declared gap`);
    }
    if (entry.status === "skip") {
      if (!entry.tracking) failures.push(`${entry.id} is a skip with no tracking reference`);
      else if (!TRACKING_SHAPE.test(entry.tracking)) failures.push(`${entry.id}: tracking ${entry.tracking} is not owner/repo#N`);
    }
  }
  return failures;
}

/**
 * Every capability an exclusion cites must be served `false`, every declared
 * gap it cites must be on the wire, and every capability a skip requires
 * must be served `true`. A flag that flips turns this red — the manifest
 * must then be re-argued, not silently kept.
 */
export function citationFailures(dispositions: DispositionsManifest, profile: PactImplementationProfile): string[] {
  const failures: string[] = [];
  const gapAreas = new Set(profile.declaredGaps.map((g) => g.area));
  for (const entry of flattenDispositions(dispositions)) {
    for (const flag of entry.cites?.capabilities ?? []) {
      if (!(flag in profile.capabilities)) failures.push(`${entry.id} cites capabilities.${flag}, which the served profile does not declare`);
      else if (profile.capabilities[flag] !== false) failures.push(`${entry.id} cites capabilities.${flag}=false but the served profile serves ${String(profile.capabilities[flag])}`);
    }
    if (entry.cites?.declaredGap && !gapAreas.has(entry.cites.declaredGap)) {
      failures.push(`${entry.id} cites declared gap '${entry.cites.declaredGap}', which is not on the wire`);
    }
    for (const flag of entry.requires?.capabilities ?? []) {
      if (profile.capabilities[flag] !== true) failures.push(`${entry.id} requires capabilities.${flag}=true but the served profile serves ${String(profile.capabilities[flag])}`);
    }
  }
  return failures;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Re-checks a finished document the way the deploy validator does (and
 * more): results are exactly `expectedIds` in order, statuses inside the
 * vocabulary, counts recompute, every non-pass carries a reason, no pass
 * carries one, and a stamped document names a 40-hex commit + a run id.
 * Pure over the document so a tampered copy is provably refused.
 */
export function verifyConformanceReport(document: unknown, expectedIds: readonly string[]): string[] {
  const failures: string[] = [];
  if (!isRecord(document)) return ["document is not an object"];
  const results = document.results;
  if (!Array.isArray(results)) return ["results is not an array"];

  const ids = results.map((r) => (isRecord(r) ? r.id : undefined));
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    failures.push("results ids are not exactly the corpus expected_vector_ids in order");
  }
  if (new Set(ids).size !== ids.length) failures.push("duplicate result ids");

  const tally: Record<string, number> = { pass: 0, fail: 0, skip: 0, excluded: 0 };
  for (const result of results) {
    if (!isRecord(result) || !isRecord(result.outcome)) {
      failures.push("a result carries no outcome");
      continue;
    }
    const status = result.outcome.status;
    if (typeof status !== "string" || !(OUTCOME_STATUSES as readonly string[]).includes(status)) {
      failures.push(`${String(result.id)}: outcome.status ${String(status)} is outside pass/fail/skip/excluded`);
      continue;
    }
    tally[status] += 1;
    const reason = result.outcome.reason;
    if (status === "pass" && reason !== undefined) failures.push(`${String(result.id)}: a pass must not carry a reason`);
    if (status !== "pass" && (typeof reason !== "string" || reason.trim().length === 0)) {
      failures.push(`${String(result.id)}: a ${status} carries no reason`);
    }
    if (status === "skip" && typeof result.tracking !== "string") failures.push(`${String(result.id)}: a skip carries no tracking`);
  }
  const counts = document.counts;
  if (!isRecord(counts)) failures.push("counts is not an object");
  else {
    for (const status of OUTCOME_STATUSES) {
      if (counts[status] !== tally[status]) failures.push(`counts.${status} (${String(counts[status])}) does not recompute (${tally[status]})`);
    }
  }
  if (document.spec_version !== SPEC_VERSION) failures.push(`spec_version ${String(document.spec_version)} is not ${SPEC_VERSION}`);
  const provenance = document.provenance;
  const implementation = document.implementation;
  if (!isRecord(provenance) || !isRecord(implementation)) failures.push("provenance / implementation missing");
  else if (provenance.stamped === true) {
    if (typeof implementation.commit !== "string" || !/^[0-9a-f]{40}$/.test(implementation.commit)) {
      failures.push("a stamped document must name a 40-hex implementation.commit");
    }
    if (typeof implementation.run_id !== "string" || implementation.run_id.length === 0) {
      failures.push("a stamped document must name implementation.run_id");
    }
  }
  return failures;
}

// ── Harness completion (exported so the tests prove the soft gate stays soft) ──

/**
 * Complete a harness's records for the build: every id in `executedIds`
 * with no record becomes a `fail` carrying {@link UNSETTLED_VECTOR_REASON},
 * so a hung or aborted vector publishes as red (disposition `regression`)
 * instead of yielding no document at all — which `cd-source.yml`'s
 * validator would refuse, turning the soft deploy gate hard. Records present
 * are returned untouched and first, in their own order; the fills follow in
 * `executedIds` order. Nothing is laundered: a duplicate, an id outside the
 * corpus or a `fail` without a message still meets the builder's refusals.
 */
export function fillUnsettledRecords(records: readonly VectorRecord[], executedIds: readonly string[]): VectorRecord[] {
  const recorded = new Set(records.map((record) => record.id));
  const fills: VectorRecord[] = executedIds
    .filter((id) => !recorded.has(id))
    .map((id) => ({ id, status: "fail", message: UNSETTLED_VECTOR_REASON }));
  return [...records, ...fills];
}

/**
 * Reconcile the harness's records with vitest's own verdict for one
 * executed vector — the runner's verdict is the document's verdict. A
 * `fail` verdict FORCES the record for `id` to `fail` carrying the runner's
 * error message ({@link RUNNER_FAIL_REASON} when it carried none): replaced
 * in place when a record is already there, appended otherwise. That is what
 * stops a `testTimeout` — which rejects the test but does not stop the
 * wrapped promise — from publishing `pass` because the promise resolved
 * later. A `pass` verdict changes nothing: it never overturns a recorded
 * `fail` and never invents a record. Nothing is laundered: a duplicate
 * record for `id` is replaced occurrence-for-occurrence and still meets the
 * builder's refusal. Pure — the input array and its records are never
 * mutated.
 */
export function reconcileWithRunnerVerdict(
  records: readonly VectorRecord[],
  id: string,
  verdict: RunnerVerdict
): VectorRecord[] {
  if (verdict.state !== "fail") return [...records];
  const forced: VectorRecord = { id, status: "fail", message: verdict.message?.trim() || RUNNER_FAIL_REASON };
  if (!records.some((record) => record.id === id)) return [...records, forced];
  return records.map((record) => (record.id === id ? forced : record));
}

// ── The builder ─────────────────────────────────────────────────────────

function refuse(message: string): never {
  throw new Error(`conformance report refused: ${message}`);
}

export function buildConformanceReport(input: BuildConformanceReportInput): ConformanceReport {
  const { records, fixture, acceptance, dispositions, provenance, vendored } = input;
  const expectedIds = fixture.expected_vector_ids;
  if (expectedIds.length === 0) refuse("the fixture carries no expected_vector_ids");

  // The fixture must be pinned to the spec generation the profile claims —
  // spec_version is derived, never typed, and the two sources must agree.
  const expectedConformancePath = `spec/v${SPEC_VERSION}/conformance`;
  if (fixture.source.conformance_path !== expectedConformancePath) {
    refuse(`fixture conformance_path ${fixture.source.conformance_path} is not ${expectedConformancePath}`);
  }
  if (acceptance.pact_commit !== fixture.source.commit) {
    refuse(`acceptance manifest pins ${acceptance.pact_commit}, fixture pins ${fixture.source.commit}`);
  }
  if (dispositions.pact_commit !== fixture.source.commit) {
    refuse(`dispositions manifest pins ${dispositions.pact_commit}, fixture pins ${fixture.source.commit}`);
  }
  for (const id of expectedIds) {
    if (typeof fixture.vector_kinds[id] !== "string") refuse(`fixture carries no kind for ${id}`);
    if (typeof fixture.vector_paths[id] !== "string") refuse(`fixture carries no path for ${id}`);
  }

  const accounting = accountingFailures(expectedIds, acceptance, dispositions);
  if (accounting.length > 0) refuse(accounting.join("; "));
  const citations = citationFailures(dispositions, buildPactProfile());
  if (citations.length > 0) refuse(citations.join("; "));

  // Records: exactly one per executed id, none for anything else.
  const executed = new Set(acceptance.executed);
  const byId = new Map<string, VectorRecord>();
  for (const record of records) {
    if (!expectedIds.includes(record.id)) refuse(`record for ${record.id}, which is not in the corpus`);
    if (!executed.has(record.id)) refuse(`record for ${record.id}, which the harness does not execute`);
    if (byId.has(record.id)) refuse(`duplicate record for ${record.id}`);
    if (record.status !== "pass" && record.status !== "fail") refuse(`${record.id}: record status ${String(record.status)}`);
    if (record.status === "fail" && (!record.message || record.message.trim().length === 0)) {
      refuse(`${record.id} failed without a message — a non-pass must carry a reason`);
    }
    byId.set(record.id, record);
  }
  for (const id of acceptance.executed) {
    if (!byId.has(id)) refuse(`no record for executed vector ${id} — a skipped or aborted suite must never yield a document`);
  }

  // Provenance: stamped unless the caller explicitly opted out.
  const stamped = provenance.unstamped !== true;
  if (stamped) {
    if (!provenance.commit || !/^[0-9a-f]{40}$/.test(provenance.commit)) refuse("GITHUB_SHA is missing or not a 40-hex commit");
    if (!provenance.run_id || provenance.run_id.trim().length === 0) refuse("GITHUB_RUN_ID is missing");
  }

  const acceptanceExcluded = new Map(acceptance.capability_excluded.map((e) => [e.id, e]));
  const dispositioned = new Map(flattenDispositions(dispositions).map((e) => [e.id, e]));

  const results: ConformanceResult[] = expectedIds.map((id) => {
    const base = { path: fixture.vector_paths[id], id, kind: fixture.vector_kinds[id] };
    const record = byId.get(id);
    if (record) {
      const execution = { test: HARNESS_FILE, adaptations: [...DECLARED_ADAPTATIONS] };
      return record.status === "pass"
        ? { ...base, outcome: { status: "pass" }, disposition: "executed-adapted", execution }
        : { ...base, outcome: { status: "fail", reason: record.message! }, disposition: "regression", execution };
    }
    const excluded = acceptanceExcluded.get(id);
    if (excluded) {
      return {
        ...base,
        outcome: { status: "excluded", reason: excluded.reason },
        disposition: "not-served",
        declaration: { requires: { effect_class: excluded.requires.effect_class } },
      };
    }
    const entry = dispositioned.get(id)!; // accountingFailures proved every id is covered
    return {
      ...base,
      outcome: { status: entry.status, reason: entry.reason },
      disposition: entry.disposition,
      ...(entry.cites ? { cites: entry.cites } : {}),
      ...(entry.requires ? { requires: entry.requires } : {}),
      ...(entry.tracking ? { tracking: entry.tracking } : {}),
    };
  });

  const counts: Record<OutcomeStatus, number> = { pass: 0, fail: 0, skip: 0, excluded: 0 };
  const dispositionTally: Record<Disposition, number> = {
    "executed-adapted": 0,
    regression: 0,
    "not-served": 0,
    unharnessed: 0,
  };
  let serverBoundTotal = 0;
  let serverBoundExecuted = 0;
  for (const result of results) {
    counts[result.outcome.status] += 1;
    dispositionTally[result.disposition] += 1;
    if (SERVER_BOUND_KINDS.has(result.kind)) {
      serverBoundTotal += 1;
      if (result.outcome.status === "pass" || result.outcome.status === "fail") serverBoundExecuted += 1;
    }
  }

  const profile = buildPactProfile(PUBLIC_BASE_URL, { conformanceReportShipped: true });

  const document: ConformanceReport = {
    spec_version: SPEC_VERSION,
    vector_set_ref: fixture.source.commit,
    vector_set: {
      repo: fixture.source.repo,
      commit: fixture.source.commit,
      path: fixture.source.conformance_path,
      inventory_path: fixture.source.inventory_path,
      vendored_fixture: vendored.path,
      fixture_sha256: vendored.sha256,
    },
    implementation: {
      name: PROFILE_NAME,
      version: IMPLEMENTATION_VERSION,
      profile: profile.endpoints.wellKnown,
      repo: provenance.repository ?? null,
      commit: stamped ? provenance.commit! : (provenance.commit ?? null),
      run_id: stamped ? provenance.run_id! : (provenance.run_id ?? null),
      run_attempt: provenance.run_attempt ?? null,
      run_url: provenance.run_url ?? null,
      workflow: provenance.workflow ?? PRODUCING_WORKFLOW,
      job: provenance.job ?? PRODUCING_JOB,
      generated_at: provenance.generated_at,
      harness: { itest: HARNESS_FILE },
    },
    provenance: { stamped, produced_by: stamped ? "ci" : "local" },
    publication: {
      // Derived from the same builder that serves the profile, so the two
      // advertisements of this URL cannot disagree.
      served: profile.endpoints.conformanceResults,
      artifact: RESULTS_ARTIFACT_NAME,
      artifact_visibility:
        "GitHub Actions workflow artifact on a PRIVATE repository — reachable only by authenticated collaborators " +
        "and subject to the repository's artifact retention (observed ~48h on this repository). The served URL " +
        "above is the canonical public location; the artifact is the per-run immutable copy.",
    },
    counts,
    dispositions: dispositionTally,
    http_coverage: { total: serverBoundTotal, executed: serverBoundExecuted },
    runner_disclaimer: RUNNER_DISCLAIMER,
    results,
  };

  if (document.publication.served !== `${PUBLIC_BASE_URL}${CONFORMANCE_RESULTS_PATH}`) {
    refuse("the shipped profile does not advertise the results path this document publishes");
  }
  const selfCheck = verifyConformanceReport(document, expectedIds);
  if (selfCheck.length > 0) refuse(selfCheck.join("; "));
  return document;
}
