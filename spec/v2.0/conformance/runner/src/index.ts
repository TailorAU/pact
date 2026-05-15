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

// ─── types ──────────────────────────────────────────────────────────────

interface Vector {
  kind?: 'http' | 'verification';
  metadata: {
    id: string;
    description?: string;
    spec_section?: string;
    conformance_level?: string;
    track?: string;
  };
  // kind: http
  preconditions?: unknown;
  request?: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  expected_response?: {
    status: number;
    headers?: Record<string, string>;
    body_match?: { mode: 'exact' | 'subset' | 'schema'; value: unknown };
    body_ignore_fields?: string[];
  };
  expected_events?: unknown;
  postconditions?: unknown;
  // kind: verification
  verification?: {
    proof: Record<string, unknown>;
    registry?: Registry;
    did_documents?: Record<string, unknown>;
    verifier_clock?: string;
    issued_nonces?: string[];
    operation_requires_uv?: boolean;
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
    credentials?: Array<{ id: string; revoked: boolean }>;
    tombstoned_at?: string;
  }>;
}

type Outcome =
  | { status: 'pass' }
  | { status: 'fail'; reason: string }
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
}

function runVerification(v: Vector['verification']): VerificationResult {
  if (!v) return { result: 'unverifiable' };
  const proof = v.proof;

  // Step 1: type dispatch + envelope shape
  const type = proof.type;
  const v20FirstClass = ['fido2-assertion', 'voice-biometric'];
  if (typeof type !== 'string') return { result: 'unverifiable', failing_step: 1 };
  if (!v20FirstClass.includes(type) && !isReverseDomain(type)) return { result: 'unverifiable', failing_step: 1 };
  for (const f of ['principal_id', 'credential_id', 'challenge_nonce', 'asserted_at', 'signature']) {
    if (proof[f] === undefined || proof[f] === null || proof[f] === '') return { result: 'unverifiable', failing_step: 1 };
  }
  if (!isDid(proof.principal_id)) return { result: 'rejected', failing_step: 2 };

  // Step 2 + 3: principal + credential resolution
  if (v.registry) {
    const principal = v.registry.principals.find((p) => p.id === proof.principal_id);
    if (!principal) return { result: 'rejected', failing_step: 2 };
    if (principal.tombstoned_at) return { result: 'rejected', failing_step: 2 };
    const cred = (principal.credentials ?? []).find((c) => c.id === proof.credential_id);
    if (!cred) return { result: 'rejected', failing_step: 3 };
    if (cred.revoked) return { result: 'rejected', failing_step: 3 };
    // Step 3 signature verification proper is attestation-type-specific and out of
    // scope for the structural runner. Test vectors that expect step-3 failure
    // for non-revocation reasons must say so via expected.failing_step = 3 AND
    // a specific failure mode the runner can detect (e.g. revoked).
  }

  // Step 4: freshness
  const assertedMs = parseTimeMs(proof.asserted_at);
  if (assertedMs === null) return { result: 'unverifiable', failing_step: 4 };
  const verifierClockMs = v.verifier_clock ? (parseTimeMs(v.verifier_clock) ?? Date.now()) : Date.now();
  const SKEW_MS = 5 * 60 * 1000;
  if (Math.abs(verifierClockMs - assertedMs) > SKEW_MS) return { result: 'rejected', failing_step: 4 };

  // Step 5: replay — nonce binding
  const nonce = proof.challenge_nonce;
  if (typeof nonce !== 'string' || nonce.length === 0) return { result: 'unverifiable', failing_step: 5 };
  const issued = v.issued_nonces ?? [];
  const verifierIdInProof = proof.verifier_id;
  // Rule: nonce MUST be either verifier-signed (we approximate: verifier_id present)
  // OR present in `issued_nonces`. Otherwise rejected at step 5.
  if (!verifierIdInProof && !issued.includes(nonce)) {
    return { result: 'rejected', failing_step: 5 };
  }

  return { result: 'verified' };
}

function checkVerification(vec: Vector): Outcome {
  if (!vec.verification) return { status: 'fail', reason: 'kind: verification but no `verification` block' };
  const got = runVerification(vec.verification);
  const want = vec.verification.expected;
  if (got.result !== want.result) {
    return { status: 'fail', reason: `expected result=${want.result}, got ${got.result}${got.failing_step ? ` (failing_step=${got.failing_step})` : ''}` };
  }
  if (want.failing_step !== undefined && got.failing_step !== want.failing_step) {
    return { status: 'fail', reason: `expected failing_step=${want.failing_step}, got ${got.failing_step ?? '<none>'}` };
  }
  return { status: 'pass' };
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

async function checkHttp(vec: Vector, serverUrl: string | null): Promise<Outcome> {
  if (!serverUrl) return { status: 'skip', reason: 'no --server provided; HTTP vectors need a server target' };
  if (!vec.request || !vec.expected_response) return { status: 'fail', reason: 'kind: http but missing `request` / `expected_response`' };

  const url = new URL(vec.request.path, serverUrl).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      method: vec.request.method,
      headers: { 'Content-Type': 'application/json', ...(vec.request.headers ?? {}) },
      body: vec.request.body !== undefined ? JSON.stringify(vec.request.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { status: 'fail', reason: `request failed: ${(err as Error).message}` };
  }

  if (res.status !== vec.expected_response.status) {
    return { status: 'fail', reason: `expected status ${vec.expected_response.status}, got ${res.status}` };
  }

  const bodyMatch = vec.expected_response.body_match;
  if (bodyMatch) {
    const text = await res.text();
    let actual: unknown = null;
    try { actual = text ? JSON.parse(text) : null; } catch { actual = text; }
    const ignore = vec.expected_response.body_ignore_fields ?? [];
    const actualPruned = pruneIgnored(actual, ignore);
    if (bodyMatch.mode === 'exact') {
      if (JSON.stringify(actualPruned) !== JSON.stringify(bodyMatch.value)) {
        return { status: 'fail', reason: `body mismatch (exact): got ${JSON.stringify(actualPruned).slice(0, 200)}` };
      }
    } else if (bodyMatch.mode === 'subset') {
      if (!subsetMatch(actualPruned, bodyMatch.value)) {
        return { status: 'fail', reason: `body mismatch (subset): expected ${JSON.stringify(bodyMatch.value)} ⊆ ${JSON.stringify(actualPruned).slice(0, 200)}` };
      }
    } else if (bodyMatch.mode === 'schema') {
      // Schema-mode validation is left for a follow-up (would need ajv).
      return { status: 'skip', reason: 'body_match mode: schema not implemented yet in the runner skeleton' };
    }
  }
  // expected_events checking needs a running event-log subscription; deferred.
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

  const results: { path: string; id: string; kind: string; outcome: Outcome }[] = [];
  for (const { path, vec } of vectors) {
    const kind = vec.kind ?? (vec.verification ? 'verification' : 'http');
    let outcome: Outcome;
    if (kind === 'verification') {
      outcome = checkVerification(vec);
    } else if (kind === 'http') {
      outcome = await checkHttp(vec, args.server);
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
  const httpVectorCount = results.filter((r) => r.kind === 'http').length;
  const httpExecutedCount = results.filter((r) => r.kind === 'http' && r.outcome.status !== 'skip').length;

  if (args.json) {
    console.log(JSON.stringify({
      counts,
      results,
      runner_disclaimer: 'kind:verification PASS results omit cryptographic signature verification (§17.7 step 3) — they are structural-only. Use a per-attestation-type verifier for end-to-end crypto.',
      http_coverage: { total: httpVectorCount, executed: httpExecutedCount },
    }, null, 2));
  } else {
    for (const r of results) {
      const tag = r.outcome.status === 'pass'
        ? (r.kind === 'verification' ? '✓ verified-structural' : '✓')
        : r.outcome.status === 'fail' ? '✗' : '·';
      const detail = r.outcome.status === 'pass' ? '' : ` — ${r.outcome.reason}`;
      console.log(`${tag} [${r.kind}] ${r.id}${detail}`);
    }
    console.log(`\n${counts.pass} pass · ${counts.fail} fail · ${counts.skip} skip`);
    if (counts.pass > 0 && results.some((r) => r.kind === 'verification' && r.outcome.status === 'pass')) {
      console.log(`\nNOTE: kind:verification "✓ verified-structural" PASSes omit cryptographic signature verification (§17.7 step 3 is attestation-type-specific and out of scope for this structural runner). A passing vector here proves the envelope, principal resolution, freshness and replay-binding rules — not that the signature is cryptographically valid.`);
    }
    if (httpVectorCount > 0 && httpExecutedCount === 0) {
      console.error(`\nWARNING: ${httpVectorCount} kind:http vector(s) skipped (no --server). HTTP-runner regressions cannot be detected without a server target. Pass --server <url> for full coverage.`);
    }
  }

  process.exit(counts.fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Conformance runner crashed:', err);
  process.exit(2);
});
