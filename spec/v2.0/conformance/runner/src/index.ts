#!/usr/bin/env node
/**
 * PACT v2.0 conformance runner.
 *
 * Loads test-vector YAML files (per ../test-vector-format.yaml) and executes
 * them. Two vector kinds:
 *   - kind: verification — runs the §17.7 authorization-proof verification
 *     flow locally (no server needed); compares result + failing_step against
 *     `expected`.
 *   - kind: http — executes the HTTP request against a server (--server),
 *     compares status + body (with body_ignore_fields).
 *
 * CLI:
 *   pact-conformance run --vectors '../**\/*.yaml' [--server <url>] [--filter <substr>] [--json]
 *
 * Exit code: 0 if all selected vectors pass (or are SKIPped for documented
 * reasons), 1 otherwise.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { verifyFido2Assertion } from './webauthn.js';

// ─── types ──────────────────────────────────────────────────────────────

interface HttpRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface HttpExpectedResponse {
  status: number;
  headers?: Record<string, string>;
  body_match?: { mode: 'exact' | 'subset' | 'schema'; value: unknown };
  body_ignore_fields?: string[];
}

/**
 * Cross-call assertion run against a step's response body AFTER the basic
 * status + body_match checks pass. Used by kind: session vectors to express
 * "MUST NOT contain" invariants on collection bodies — e.g. after a rejected
 * onboard, the /_status response's `members` array MUST NOT contain the
 * rejected caller's principal_id.
 *
 * Two v2.0.3 kinds:
 *   - negative_membership: walks `body_path` (dot-pathed array of objects);
 *     rejects if any entry has `principalId === principal_id`.
 *   - negative_obligation: walks `body_path` (dot-pathed array of objects);
 *     rejects if any entry's keys match ALL keys in `match`.
 */
interface CrossCallAssertion {
  kind: 'negative_membership' | 'negative_obligation';
  body_path: string;
  principal_id?: string;
  match?: Record<string, unknown>;
}

interface SessionStep {
  id: string;
  request: HttpRequest;
  expected_response: HttpExpectedResponse;
  cross_call_assertions?: CrossCallAssertion[];
}

interface Vector {
  kind?: 'http' | 'verification' | 'session';
  metadata: {
    id: string;
    description?: string;
    spec_section?: string;
    conformance_level?: string;
    track?: string;
  };
  // kind: http
  preconditions?: unknown;
  request?: HttpRequest;
  expected_response?: HttpExpectedResponse;
  expected_events?: unknown;
  postconditions?: unknown;
  // kind: session — sequenced HTTP steps with cross-call assertions
  steps?: SessionStep[];
  // kind: verification
  verification?: {
    proof: Record<string, unknown>;
    registry?: Registry;
    did_documents?: Record<string, unknown>;
    verifier_clock?: string;
    issued_nonces?: string[];
    operation_requires_uv?: boolean;
    /**
     * The receiving verifier's identity (DID), used to enforce the §17.6 / §17.7-step-5
     * `verifier_id` EQUALITY rule. If the proof carries a `verifier_id`, it MUST equal
     * this value; otherwise the runner rejects at step 5. Absent → equality check is
     * skipped (presence-only, legacy v2.0.1 behaviour).
     */
    receiving_verifier_id?: string;
    /**
     * 'real' (default): the runner attempts real cryptographic signature
     * verification for first-class attestation types (`fido2-assertion`). An
     * `unverifiable` outcome from the verifier counts as a non-pass.
     * 'structural': the runner skips cryptographic checks (or treats
     * `unverifiable` placeholder signatures as a structural pass). Used for the
     * legacy v2.0.1 vectors that exercise envelope / freshness / replay only.
     */
    signature_check?: 'real' | 'structural';
    expected: {
      result: 'verified' | 'rejected' | 'unverifiable';
      failing_step?: number;
      emits_trust_violation?: boolean;
    };
  };
  failure_classification?: unknown;
}

interface Registry {
  version: string;
  principals: Array<{
    id: string;
    credentials?: Array<{ id: string; revoked: boolean; public_key?: string; type?: string }>;
    tombstoned_at?: string;
  }>;
}

type Outcome =
  | { status: 'pass'; verification_mode?: 'cryptographic' | 'structural' }
  | { status: 'fail'; reason: string; verification_mode?: 'cryptographic' | 'structural' }
  | { status: 'skip'; reason: string };

// ─── vector loading ─────────────────────────────────────────────────────

function* walkYaml(root: string): Iterable<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkYaml(full);
    } else if (entry.endsWith('.yaml') && !entry.startsWith('test-vector-format')) {
      yield full;
    }
  }
}

function loadVector(path: string): Vector | null {
  const raw = readFileSync(path, 'utf8');
  const parsed = yamlLoad(raw) as Record<string, unknown> | null | undefined;
  if (!parsed || typeof parsed !== 'object') return null;
  // We only consider top-level vectors (with `metadata`), not the format schema or examples-block files.
  if (!parsed.metadata) return null;
  return parsed as unknown as Vector;
}

// ─── kind: verification ─────────────────────────────────────────────────

function isDid(s: unknown): boolean {
  return typeof s === 'string' && /^did:[a-z0-9]+:.+/.test(s);
}

function isReverseDomain(s: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(s);
}

function parseTimeMs(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

interface VerificationResult {
  result: 'verified' | 'rejected' | 'unverifiable';
  failing_step?: number;
  /** Reason string surfaced to the runner output (when result != 'verified'). */
  reason?: string;
  /**
   * 'cryptographic' when the §17.7 step-3 signature check was performed with
   * real crypto. 'structural' when the step-3 check was skipped (legacy
   * structural vectors, voice-biometric — deferred to HMAN's #3 PR).
   */
  verification_mode?: 'cryptographic' | 'structural';
}

function runVerification(v: Vector['verification']): VerificationResult {
  if (!v) return { result: 'unverifiable', verification_mode: 'structural' };
  const proof = v.proof;
  // Default signature_check is 'real' per the v2.0.2 hardening — vectors that
  // want to keep the v2.0.1 envelope-only behaviour must opt into 'structural'.
  const signatureCheck = v.signature_check ?? 'real';

  // Step 1: type dispatch + envelope shape
  const type = proof.type;
  const v20FirstClass = ['fido2-assertion', 'voice-biometric'];
  if (typeof type !== 'string') return { result: 'unverifiable', failing_step: 1, verification_mode: 'structural' };
  if (!v20FirstClass.includes(type) && !isReverseDomain(type)) return { result: 'unverifiable', failing_step: 1, verification_mode: 'structural' };
  for (const f of ['principal_id', 'credential_id', 'challenge_nonce', 'asserted_at', 'signature']) {
    if (proof[f] === undefined || proof[f] === null || proof[f] === '') return { result: 'unverifiable', failing_step: 1, verification_mode: 'structural' };
  }
  if (!isDid(proof.principal_id)) return { result: 'rejected', failing_step: 2, verification_mode: 'structural' };

  // Step 2 + 3 (resolution half): principal + credential resolution
  let resolvedPublicKey: string | undefined;
  if (v.registry) {
    const principal = v.registry.principals.find((p) => p.id === proof.principal_id);
    if (!principal) return { result: 'rejected', failing_step: 2, verification_mode: 'structural' };
    if (principal.tombstoned_at) return { result: 'rejected', failing_step: 2, verification_mode: 'structural' };
    const cred = (principal.credentials ?? []).find((c) => c.id === proof.credential_id);
    if (!cred) return { result: 'rejected', failing_step: 3, verification_mode: 'structural' };
    if (cred.revoked) return { result: 'rejected', failing_step: 3, reason: 'credential revoked (§17.8)', verification_mode: 'structural' };
    resolvedPublicKey = cred.public_key;
  }

  // Step 4: freshness
  const assertedMs = parseTimeMs(proof.asserted_at);
  if (assertedMs === null) return { result: 'unverifiable', failing_step: 4, verification_mode: 'structural' };
  const verifierClockMs = v.verifier_clock ? (parseTimeMs(v.verifier_clock) ?? Date.now()) : Date.now();
  const SKEW_MS = 5 * 60 * 1000;
  if (Math.abs(verifierClockMs - assertedMs) > SKEW_MS) return { result: 'rejected', failing_step: 4, verification_mode: 'structural' };

  // Step 5: replay — nonce binding (§17.6 / §17.7 step 5)
  const nonce = proof.challenge_nonce;
  if (typeof nonce !== 'string' || nonce.length === 0) return { result: 'unverifiable', failing_step: 5, verification_mode: 'structural' };
  const issued = v.issued_nonces ?? [];
  const verifierIdInProof = proof.verifier_id;
  // v2.0.2 rule: nonce MUST satisfy ONE of:
  //   (a) be in the verifier's issued_nonces list, OR
  //   (b) carry verifier_signed_nonce: true (asserted — runtime crypto check is type-defined; we accept the assertion structurally), OR
  //   (c) carry a verifier_id field that EQUALS the receiving verifier's identity (`receiving_verifier_id` in the vector).
  // If the vector sets `receiving_verifier_id`, the runner enforces equality; otherwise (legacy
  // vectors), presence-only is accepted as it was in v2.0.1.
  const verifierSignedNonce = proof.verifier_signed_nonce === true;
  if (issued.includes(nonce)) {
    // (a) satisfied — fine
  } else if (verifierSignedNonce) {
    // (b) asserted — fine for the structural runner
  } else if (verifierIdInProof) {
    if (v.receiving_verifier_id !== undefined && verifierIdInProof !== v.receiving_verifier_id) {
      return { result: 'rejected', failing_step: 5, verification_mode: 'structural' };
    }
    // verifier_id present and (no receiving_verifier_id to check against, OR equal): satisfied
  } else {
    return { result: 'rejected', failing_step: 5, verification_mode: 'structural' };
  }

  // Step 3 (cryptographic half): real signature verification for fido2-assertion.
  // Voice-biometric and custom types defer to their own verifiers — HMAN's #3 PR
  // for `voice-biometric`, implementation-defined for custom types — so the
  // runner accepts them as structurally-verified here.
  if (type === 'fido2-assertion' && resolvedPublicKey !== undefined) {
    const fidoResult = verifyFido2Assertion({
      publicKey: resolvedPublicKey,
      signature: String(proof.signature ?? ''),
      challengeNonce: String(proof.challenge_nonce ?? ''),
      assertedAt: String(proof.asserted_at ?? ''),
      payloadHash: typeof proof.payload_hash === 'string' ? proof.payload_hash : undefined,
      alg: typeof proof.alg === 'string' ? proof.alg : '',
      authenticatorData: typeof proof.authenticator_data === 'string' ? proof.authenticator_data : undefined,
      clientDataJSON: typeof proof.client_data_json === 'string' ? proof.client_data_json : undefined,
    });

    if (fidoResult.result === 'verified-cryptographic') {
      return { result: 'verified', verification_mode: 'cryptographic' };
    }
    if (fidoResult.result === 'rejected') {
      return { result: 'rejected', failing_step: 3, reason: fidoResult.reason, verification_mode: 'cryptographic' };
    }
    // unverifiable: surface depending on signature_check policy.
    if (signatureCheck === 'real') {
      return { result: 'unverifiable', failing_step: 3, reason: fidoResult.reason, verification_mode: 'cryptographic' };
    }
    // structural: legacy v2.0.1 vector — accept the structural pass.
    return { result: 'verified', verification_mode: 'structural' };
  }

  // Step 3 (cryptographic half): voice-biometric. The normative crypto lands
  // via HMAN's #3 PR (§18.6); until then the runner has no voice verifier.
  // FAIL CLOSED — a `signature_check: real` voice proof MUST NOT pass
  // structurally just because we haven't built the verifier. That was the
  // A1 "forged proof passes" footgun (closed for fido2 in v2.0.2; closed
  // for voice here). The §17.6 alg whitelist is enforced FIRST because it
  // does not need the crypto verifier — so alg-disallowed asserts real
  // behaviour today. Contract + flip conditions:
  // docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml.
  if (type === 'voice-biometric') {
    // v2.0 placeholder set; HMAN's #3 PR pins the normative whitelist.
    const VOICE_ALG_WHITELIST = new Set(['resemblyzer-v1']);
    const valg = typeof proof.alg === 'string' ? proof.alg : '';
    if (!VOICE_ALG_WHITELIST.has(valg)) {
      return {
        result: 'rejected',
        failing_step: 3,
        reason: `voice-biometric alg '${valg}' outside the §17.6 whitelist`,
        verification_mode: 'cryptographic',
      };
    }
    if (signatureCheck === 'real') {
      return {
        result: 'unverifiable',
        failing_step: 3,
        reason: 'voice-biometric crypto verifier not implemented (HMAN #3, §18.6) — failing closed',
        verification_mode: 'cryptographic',
      };
    }
    // Only explicitly-structural vectors reach here (none exist yet); the
    // envelope / freshness / replay / verifier-binding checks above already
    // ran. The signature itself is NOT asserted.
    return { result: 'verified', verification_mode: 'structural' };
  }

  // No crypto check attempted (custom reverse-domain type, or no registry —
  // a pure envelope test). Custom types defer to their own verifiers (§18.5);
  // a no-registry vector is an envelope-shape test only.
  return { result: 'verified', verification_mode: 'structural' };
}

function checkVerification(vec: Vector): Outcome {
  if (!vec.verification) return { status: 'fail', reason: 'kind: verification but no `verification` block' };
  const got = runVerification(vec.verification);
  const want = vec.verification.expected;
  if (got.result !== want.result) {
    const detail = got.reason ? ` [${got.reason}]` : '';
    return { status: 'fail', reason: `expected result=${want.result}, got ${got.result}${got.failing_step ? ` (failing_step=${got.failing_step})` : ''}${detail}`, verification_mode: got.verification_mode };
  }
  if (want.failing_step !== undefined && got.failing_step !== want.failing_step) {
    return { status: 'fail', reason: `expected failing_step=${want.failing_step}, got ${got.failing_step ?? '<none>'}`, verification_mode: got.verification_mode };
  }
  return { status: 'pass', verification_mode: got.verification_mode };
}

// ─── kind: http ─────────────────────────────────────────────────────────

function pruneIgnored(obj: unknown, ignore: string[]): unknown {
  if (!ignore || ignore.length === 0) return obj;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const k of ignore) delete out[k];
  return out;
}

function subsetMatch(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    if (!subsetMatch(a[k], e[k])) return false;
  }
  return true;
}

/**
 * Resolve a dot-pathed accessor against an object body. Returns undefined if
 * any segment is missing. e.g. resolvePath({a: {b: 1}}, "a.b") === 1.
 */
function resolveBodyPath(body: unknown, path: string): unknown {
  if (!path) return body;
  let cur: unknown = body;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * Run a cross-call assertion against a step's response body. Returns null on
 * pass, a human-readable failure reason on fail.
 */
function checkCrossCallAssertion(body: unknown, a: CrossCallAssertion): string | null {
  const target = resolveBodyPath(body, a.body_path);
  if (a.kind === 'negative_membership') {
    if (!Array.isArray(target)) {
      // Absence-of-collection is a structural pass for a negative assertion:
      // if there's no `members` array at all, the principal trivially isn't in it.
      return null;
    }
    for (const entry of target) {
      if (entry && typeof entry === 'object' && (entry as Record<string, unknown>).principalId === a.principal_id) {
        return `negative_membership violated: ${a.principal_id} present in ${a.body_path}`;
      }
    }
    return null;
  }
  if (a.kind === 'negative_obligation') {
    if (!Array.isArray(target)) return null;
    const m = a.match ?? {};
    for (const entry of target) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      let allMatch = true;
      for (const k of Object.keys(m)) {
        if (JSON.stringify(e[k]) !== JSON.stringify(m[k])) { allMatch = false; break; }
      }
      if (allMatch) {
        return `negative_obligation violated: entry matching ${JSON.stringify(m)} present in ${a.body_path}`;
      }
    }
    return null;
  }
  return `unknown cross_call_assertion kind: ${(a as { kind: string }).kind}`;
}

/**
 * Run a single HTTP request + assertions block. Used both directly (kind:
 * http) and per-step (kind: session). Returns { outcome, body? } so callers
 * can do cross-call assertions against the parsed body if they want.
 */
async function runHttpStep(
  req: HttpRequest,
  expected: HttpExpectedResponse,
  serverUrl: string,
): Promise<{ outcome: Outcome; body?: unknown }> {
  const url = new URL(req.path, serverUrl).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', ...(req.headers ?? {}) },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { outcome: { status: 'fail', reason: `request failed: ${(err as Error).message}` } };
  }

  if (res.status !== expected.status) {
    return { outcome: { status: 'fail', reason: `expected status ${expected.status}, got ${res.status}` } };
  }

  // Always read the body so callers can do cross-call assertions even when
  // body_match is omitted (the negative-membership / negative-obligation tests
  // assert on shape without enumerating positive matches).
  const text = await res.text();
  let actual: unknown = null;
  try { actual = text ? JSON.parse(text) : null; } catch { actual = text; }

  const bodyMatch = expected.body_match;
  if (bodyMatch) {
    const ignore = expected.body_ignore_fields ?? [];
    const actualPruned = pruneIgnored(actual, ignore);
    if (bodyMatch.mode === 'exact') {
      if (JSON.stringify(actualPruned) !== JSON.stringify(bodyMatch.value)) {
        return { outcome: { status: 'fail', reason: `body mismatch (exact): got ${JSON.stringify(actualPruned).slice(0, 200)}` }, body: actual };
      }
    } else if (bodyMatch.mode === 'subset') {
      if (!subsetMatch(actualPruned, bodyMatch.value)) {
        return { outcome: { status: 'fail', reason: `body mismatch (subset): expected ${JSON.stringify(bodyMatch.value)} ⊆ ${JSON.stringify(actualPruned).slice(0, 200)}` }, body: actual };
      }
    } else if (bodyMatch.mode === 'schema') {
      // Schema-mode validation is left for a follow-up (would need ajv).
      return { outcome: { status: 'skip', reason: 'body_match mode: schema not implemented yet in the runner skeleton' }, body: actual };
    }
  }
  return { outcome: { status: 'pass' }, body: actual };
}

async function checkHttp(vec: Vector, serverUrl: string | null): Promise<Outcome> {
  if (!serverUrl) return { status: 'skip', reason: 'no --server provided; HTTP vectors need a server target' };
  if (!vec.request || !vec.expected_response) return { status: 'fail', reason: 'kind: http but missing `request` / `expected_response`' };

  const { outcome } = await runHttpStep(vec.request, vec.expected_response, serverUrl);
  // expected_events checking needs a running event-log subscription; deferred.
  return outcome;
}

// ─── kind: session ──────────────────────────────────────────────────────
//
// A session vector is a sequence of HTTP calls representing a compound
// scenario whose assertions cross call boundaries (e.g. "after onboard
// fails, /_status MUST show non-membership"). The runner walks `steps[]` in
// order; each step is an HTTP request + expected response + optional
// `cross_call_assertions` evaluated against the parsed response body.
//
// A vector PASSes iff every step passes (status, body_match, AND every
// cross_call_assertion). A vector SKIPs as a unit if no --server is
// provided. A step FAILing aborts the run for that vector with the
// failing step's reason — we don't continue after a failure because the
// later steps' preconditions may not hold.

async function checkSession(vec: Vector, serverUrl: string | null): Promise<Outcome> {
  if (!serverUrl) return { status: 'skip', reason: 'no --server provided; session vectors need a server target' };
  if (!vec.steps || vec.steps.length === 0) return { status: 'fail', reason: 'kind: session but missing or empty `steps`' };

  for (const step of vec.steps) {
    if (!step.request || !step.expected_response) {
      return { status: 'fail', reason: `step ${step.id}: missing request / expected_response` };
    }
    const { outcome, body } = await runHttpStep(step.request, step.expected_response, serverUrl);
    if (outcome.status === 'fail') {
      return { status: 'fail', reason: `step ${step.id}: ${outcome.reason}` };
    }
    if (outcome.status === 'skip') {
      // A skipped step (e.g. body_match: schema) skips the whole vector;
      // partial-pass would be misleading.
      return { status: 'skip', reason: `step ${step.id}: ${outcome.reason}` };
    }
    // Cross-call assertions, evaluated against the parsed body.
    for (const a of step.cross_call_assertions ?? []) {
      const violation = checkCrossCallAssertion(body, a);
      if (violation !== null) {
        return { status: 'fail', reason: `step ${step.id}: ${violation}` };
      }
    }
  }
  // expected_events across steps is deferred (needs event-log subscription).
  return { status: 'pass' };
}

// ─── CLI ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { vectors: string; server: string | null; filter: string | null; json: boolean } {
  const out = { vectors: '', server: null as string | null, filter: null as string | null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vectors') out.vectors = argv[++i] ?? '';
    else if (a === '--server') out.server = argv[++i] ?? null;
    else if (a === '--filter') out.filter = argv[++i] ?? null;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: pact-conformance run [--vectors <dir>] [--server <url>] [--filter <substr>] [--json]');
      console.log('  --vectors <dir>    directory to recursively scan for vector YAML files (default: spec/v2.0/conformance)');
      console.log('  --server <url>     PACT server base URL for kind:http vectors (skipped if absent)');
      console.log('  --filter <substr>  only run vectors whose id contains <substr>');
      console.log('  --json             output a JSON report');
      process.exit(0);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const sub = process.argv[2];
  if (sub !== 'run') {
    console.error('Usage: pact-conformance run [--vectors <dir>] [--server <url>] [--filter <substr>] [--json]');
    process.exit(2);
  }
  const args = parseArgs(process.argv.slice(3));
  const root = resolvePath(args.vectors || '.');

  const vectors: { path: string; vec: Vector }[] = [];
  for (const path of walkYaml(root)) {
    const vec = loadVector(path);
    if (!vec) continue;
    if (args.filter && !vec.metadata.id.includes(args.filter)) continue;
    vectors.push({ path, vec });
  }

  // Best-effort state reset before server-bound vectors run. Several
  // session vectors are stateful (an onboard adds a member, a vote
  // discharges an obligation); re-running the suite against a long-lived
  // server would otherwise see stale state. The reference server exposes
  // `POST /__reset` to re-seed deterministic fixtures. A third-party PACT
  // server that does not implement `/__reset` simply returns non-2xx and
  // the runner continues — this is a convenience for deterministic re-runs,
  // not a conformance requirement on the server under test.
  if (args.server && vectors.some((v) => {
    const k = v.vec.kind ?? (v.vec.verification ? 'verification' : (v.vec.steps ? 'session' : 'http'));
    return k === 'http' || k === 'session';
  })) {
    try {
      const resetUrl = new URL('/__reset', args.server).toString();
      const r = await fetch(resetUrl, { method: 'POST', signal: AbortSignal.timeout(5_000) });
      if (!r.ok) {
        console.error(`NOTE: ${resetUrl} returned ${r.status}; server state not reset (re-runs may be non-deterministic if the server is stateful).`);
      }
    } catch {
      console.error('NOTE: server /__reset unreachable; server state not reset (re-runs may be non-deterministic if the server is stateful).');
    }
  }

  const results: { path: string; id: string; kind: string; outcome: Outcome }[] = [];
  for (const { path, vec } of vectors) {
    const kind = vec.kind ?? (vec.verification ? 'verification' : (vec.steps ? 'session' : 'http'));
    let outcome: Outcome;
    if (kind === 'verification') {
      outcome = checkVerification(vec);
    } else if (kind === 'http') {
      outcome = await checkHttp(vec, args.server);
    } else if (kind === 'session') {
      outcome = await checkSession(vec, args.server);
    } else {
      outcome = { status: 'fail', reason: `unknown kind: ${String(kind)}` };
    }
    results.push({ path: relative(process.cwd(), path), id: vec.metadata.id, kind, outcome });
  }

  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.outcome.status]++;

  // Diagnostics for misleading-passes (cold-eye-audit hard-issue #1 + concern #10).
  // 1. kind:verification PASS reports omit cryptographic signature verification (§17.7 step 3).
  //    The runner is structural; rename "verified" to "verified-structural" in the per-vector tag
  //    so a passing vector is not mistaken for a real-crypto check.
  // 2. If every kind:http vector in the suite was skipped (typically because no --server was
  //    passed), HTTP-runner regressions can hide. Print a stderr warning even on a green run.
  // Both kind:http and kind:session need --server to execute; group them
  // under "server-bound" coverage for the warning below.
  const httpVectorCount = results.filter((r) => r.kind === 'http' || r.kind === 'session').length;
  const httpExecutedCount = results.filter((r) => (r.kind === 'http' || r.kind === 'session') && r.outcome.status !== 'skip').length;

  // Per-result JSON shape: surface verification_mode at the top level so JSON
  // consumers (CI gates, badge generators) can branch on cryptographic vs
  // structural without unpacking the discriminated `outcome` union. The same
  // field also lives inside `outcome` for vector-level introspection.
  const jsonResults = results.map((r) => {
    const mode = (r.outcome.status === 'pass' || r.outcome.status === 'fail') ? r.outcome.verification_mode : undefined;
    return {
      path: r.path,
      id: r.id,
      kind: r.kind,
      outcome: r.outcome,
      ...(mode !== undefined ? { verification_mode: mode } : {}),
    };
  });

  // Whether any verification PASS in this run was real crypto vs structural-only.
  const sawCryptographic = results.some((r) => r.kind === 'verification' && r.outcome.status === 'pass' && r.outcome.verification_mode === 'cryptographic');
  const sawStructural = results.some((r) => r.kind === 'verification' && r.outcome.status === 'pass' && r.outcome.verification_mode === 'structural');

  if (args.json) {
    console.log(JSON.stringify({
      counts,
      results: jsonResults,
      runner_disclaimer: 'kind:verification PASS results carry verification_mode: "cryptographic" (real WebAuthn signature verified for fido2-assertion) or "structural" (envelope / freshness / replay only — legacy v2.0.1 vectors and non-fido2 types). Structural-only PASS does NOT prove the signature is cryptographically valid.',
      http_coverage: { total: httpVectorCount, executed: httpExecutedCount },
    }, null, 2));
  } else {
    for (const r of results) {
      let tag: string;
      if (r.outcome.status === 'pass') {
        if (r.kind === 'verification') {
          tag = r.outcome.verification_mode === 'cryptographic' ? '✓ verified-cryptographic' : '✓ verified-structural';
        } else {
          tag = '✓';
        }
      } else if (r.outcome.status === 'fail') {
        tag = '✗';
      } else {
        tag = '·';
      }
      const detail = r.outcome.status === 'pass' ? '' : ` — ${r.outcome.reason}`;
      console.log(`${tag} [${r.kind}] ${r.id}${detail}`);
    }
    console.log(`\n${counts.pass} pass · ${counts.fail} fail · ${counts.skip} skip`);
    if (sawStructural) {
      console.log(`\nNOTE: kind:verification "✓ verified-structural" PASSes omit cryptographic signature verification (§17.7 step 3). They prove the envelope, principal resolution, freshness and replay-binding rules — not that the signature is cryptographically valid. Vectors that opt into real crypto must declare \`verification.signature_check: real\` and supply a real signature (see verify-fido2-real-signature.yaml).`);
    }
    if (sawCryptographic) {
      console.log(`\nNOTE: kind:verification "✓ verified-cryptographic" PASSes additionally verified the FIDO2 / WebAuthn signature against the enrolled public key (§17.7 step 3, §18.2).`);
    }
    if (httpVectorCount > 0 && httpExecutedCount === 0) {
      console.error(`\nWARNING: ${httpVectorCount} server-bound vector(s) (kind:http + kind:session) skipped (no --server). HTTP-runner regressions cannot be detected without a server target. Pass --server <url> for full coverage.`);
    }
  }

  process.exit(counts.fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Conformance runner crashed:', err);
  process.exit(2);
});
