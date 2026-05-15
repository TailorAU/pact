import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { loadProof } from '../proof.js';

interface Credential {
  id: string;
  type: string;
  public_key: string;
  enrolled_at: string;
  revoked: boolean;
}

interface Principal {
  id: string;
  display_name?: string;
  credentials?: Credential[];
  tombstoned_at?: string;
}

interface Registry {
  version: string;
  principals: Principal[];
  supported_types?: string[];
}

function isDid(s: unknown): boolean {
  return typeof s === 'string' && /^did:[a-z0-9]+:.+/.test(s);
}

function parseTime(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

interface Result {
  result: 'verified' | 'rejected' | 'unverifiable';
  failing_step?: number;     // 1..6 from §17.7
  reason?: string;
  notes: string[];
}

function verify(proof: Record<string, unknown>, registry: Registry | null, nowMs: number, clockSkewMs: number, verifierId: string | null): Result {
  const notes: string[] = [];

  // Step 1: type dispatch
  const type = proof.type;
  const v20FirstClass = ['fido2-assertion', 'voice-biometric'];
  if (typeof type !== 'string') {
    return { result: 'unverifiable', failing_step: 1, reason: 'authorization_proof.type missing or not a string', notes };
  }
  const isReverseDomain = /^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(type);
  if (!v20FirstClass.includes(type) && !isReverseDomain) {
    return { result: 'unverifiable', failing_step: 1, reason: `unknown attestation type '${type}' (not a v2.0 first-class type and not in reverse-domain form)`, notes };
  }
  if (isReverseDomain && !v20FirstClass.includes(type)) {
    notes.push(`type '${type}' is a custom attestation type; verification is type-defined per §18.5`);
  }

  // Required envelope fields per §17.6
  for (const f of ['principal_id', 'credential_id', 'challenge_nonce', 'asserted_at', 'signature']) {
    if (proof[f] === undefined || proof[f] === null || proof[f] === '') {
      return { result: 'unverifiable', failing_step: 1, reason: `required §17.6 field '${f}' missing`, notes };
    }
  }
  if (!isDid(proof.principal_id)) {
    return { result: 'rejected', failing_step: 2, reason: `principal_id '${String(proof.principal_id)}' is not a DID (§17.4)`, notes };
  }

  // Step 2: principal resolution
  if (registry) {
    const principal = registry.principals.find((p) => p.id === proof.principal_id);
    if (!principal) {
      return { result: 'rejected', failing_step: 2, reason: `principal '${String(proof.principal_id)}' not found in registry`, notes };
    }
    if (principal.tombstoned_at) {
      return { result: 'rejected', failing_step: 2, reason: `principal '${principal.id}' is tombstoned (cryptographically erased ${principal.tombstoned_at}) — prior proofs check as having-been-valid-then-revoked`, notes };
    }
    // Step 3: signature verification — we check structural prerequisites
    const cred = (principal.credentials ?? []).find((c) => c.id === proof.credential_id);
    if (!cred) {
      return { result: 'rejected', failing_step: 3, reason: `credential '${String(proof.credential_id)}' not enrolled for principal '${principal.id}'`, notes };
    }
    if (cred.revoked) {
      return { result: 'rejected', failing_step: 3, reason: `credential '${cred.id}' is revoked (§17.8)`, notes };
    }
    notes.push(`credential '${cred.id}' resolved + not revoked; cryptographic signature verification is type-defined (${type}) and not performed locally by this helper`);
  } else {
    notes.push('no --registry provided; skipping principal resolution (step 2) and credential revocation (step 3)');
  }

  // Step 4: freshness
  const assertedMs = parseTime(proof.asserted_at);
  if (assertedMs === null) {
    return { result: 'unverifiable', failing_step: 4, reason: `asserted_at '${String(proof.asserted_at)}' is not a valid ISO 8601 timestamp`, notes };
  }
  if (Math.abs(nowMs - assertedMs) > clockSkewMs) {
    return { result: 'rejected', failing_step: 4, reason: `asserted_at outside clock skew (${Math.round((nowMs - assertedMs) / 1000)}s vs allowed ±${Math.round(clockSkewMs / 1000)}s)`, notes };
  }

  // Step 5: replay — nonce binding to a verifier
  const nonce = proof.challenge_nonce;
  const verifierIdInProof = proof.verifier_id;
  if (typeof nonce !== 'string' || nonce.length === 0) {
    return { result: 'unverifiable', failing_step: 5, reason: 'challenge_nonce missing or empty', notes };
  }
  // The §17.6 / §17.7-step-5 rule (v2.0.2): nonce MUST satisfy ONE of:
  //   (a) be in the verifier's issued_nonces list
  //   (b) be cryptographically verifier-signed (asserted via verifier_signed_nonce: true; we cannot
  //       check the signature locally without the verifier's public key, but the assertion must be present)
  //   (c) carry a verifier_id field WHOSE VALUE EXACTLY EQUALS the receiving verifier's identity.
  // v2.0.2 sharpens this: with --verifier passed, equality is REQUIRED (not just hinted at).
  // Without --verifier, the CLI cannot prove (c) is satisfied — it can only confirm verifier_id
  // is present, which §17.6 marks as schema-valid-but-not-replay-safe.
  const verifierSignedNonce = proof.verifier_signed_nonce === true;
  if (verifierSignedNonce) {
    notes.push('proof asserts verifier_signed_nonce: true; cryptographic check of nonce signature is type-defined and not performed locally — verifier MUST run that check at §17.7 step 5');
  } else if (!verifierIdInProof) {
    return { result: 'rejected', failing_step: 5, reason: 'challenge_nonce has neither verifier_signed_nonce: true nor a verifier_id field — §17.6 verifier-binding rule violated', notes };
  } else if (verifierId) {
    // Equality is the v2.0.2 requirement.
    if (verifierIdInProof !== verifierId) {
      return { result: 'rejected', failing_step: 5, reason: `verifier_id mismatch: proof claims '${String(verifierIdInProof)}', this verifier is '${verifierId}'. §17.7 step 5 requires exact equality (see also §17.6).`, notes };
    }
    notes.push(`verifier_id equality check passed: proof's verifier_id matches --verifier (${verifierId})`);
  } else {
    notes.push(`proof's verifier_id is '${String(verifierIdInProof)}'; --verifier not supplied so equality check was SKIPPED. In production, this is a §17.7 step 5 failure — run with --verifier <your-did> to enforce.`);
  }

  return { result: 'verified', notes };
}

export function registerVerifyProofCommand(program: Command): void {
  program
    .command('verify-proof <file>')
    .description('Locally verify a §17.6 authorization_proof JSON file. Performs structural checks + freshness + nonce binding + (with --registry) principal resolution and credential revocation. Cryptographic signature verification is attestation-type-specific and is NOT performed here — that comes via the real conformance runner (T9) or an attestation-type-specific tool.')
    .option('--registry <file>', 'Path to a principal-registry.json file (§17.8) to resolve principal_id against')
    .option('--verifier <did>', 'Expected verifier_id for the nonce binding check (§17.6 / §17.7 step 5)')
    .option('--now <iso>', 'Override the verifier clock (default: system time)')
    .option('--clock-skew-seconds <n>', 'Allowed clock skew in seconds for asserted_at (default: 300 = ±5min)', (v) => parseInt(v, 10))
    .option('--json', 'Output as JSON')
    .action(async (file: string, opts: { registry?: string; verifier?: string; now?: string; clockSkewSeconds?: number; json?: boolean }) => {
      try {
        const proof = loadProof(file);

        let registry: Registry | null = null;
        if (opts.registry) {
          const raw = readFileSync(opts.registry, 'utf8');
          const parsed = JSON.parse(raw) as Registry;
          if (!parsed.principals || !Array.isArray(parsed.principals)) {
            throw new Error('registry file is not a valid principal-registry.json (missing `principals` array)');
          }
          registry = parsed;
        }

        const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
        if (!Number.isFinite(nowMs)) {
          throw new Error(`--now '${opts.now}' is not a valid ISO 8601 timestamp`);
        }
        const clockSkewMs = (opts.clockSkewSeconds ?? 300) * 1000;
        const result = verify(proof, registry, nowMs, clockSkewMs, opts.verifier ?? null);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const status =
            result.result === 'verified' ? '✓ verified'
            : result.result === 'rejected' ? `✗ rejected (step ${result.failing_step})`
            : '? unverifiable';
          console.log(status);
          if (result.reason) console.log(`  reason: ${result.reason}`);
          for (const note of result.notes) console.log(`  note: ${note}`);
        }
        process.exit(result.result === 'verified' ? 0 : 1);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
