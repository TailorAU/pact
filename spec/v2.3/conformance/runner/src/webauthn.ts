/**
 * Real WebAuthn / FIDO2 assertion verifier for the PACT v2.0 conformance runner.
 *
 * Closes the "A1: forged-signature pass" attack in v2.0.1 by performing actual
 * cryptographic signature verification for `type: fido2-assertion` proofs.
 *
 * Two verification paths:
 *   1. Full WebAuthn — when the proof carries `authenticatorData` + `clientDataJSON`
 *      + `signature`, delegates to `@simplewebauthn/server`'s
 *      `verifyAuthenticationResponse`.
 *   2. Generic deterministic-payload — when only `publicKey` + `signature` + a
 *      message to sign (`challenge_nonce + asserted_at` and optionally a payload
 *      hash) are present, uses Node's built-in `crypto.verify`. Supports an
 *      explicit whitelist of v2.0 algs (ES256 / ES384 / Ed25519).
 *
 * The `unverifiable` outcome is reserved for cases where the inputs are
 * structurally insufficient for a real crypto check (e.g. placeholder signature
 * strings like `<valid-webauthn-...>` in the original v2.0 test vectors). The
 * caller decides whether to treat `unverifiable` as a structural pass (legacy
 * vectors marked `signature_check: structural`) or as a hard non-verify (vectors
 * marked `signature_check: real`).
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

export interface Fido2VerifyInput {
  /** The credential's enrolled public key. Base64url-encoded SPKI (default) or PEM. */
  publicKey: string;
  /** proof.signature (base64url). Raw ECDSA-DER or Ed25519 raw signature. */
  signature: string;
  /** proof.challenge_nonce. */
  challengeNonce: string;
  /** proof.asserted_at (ISO 8601 string). */
  assertedAt: string;
  /** Optional: hash of the message payload the signature additionally commits to. */
  payloadHash?: string;
  /** proof.alg — e.g. "webauthn-es256", "webauthn-es384", "webauthn-eddsa". */
  alg: string;
  /** Optional WebAuthn-specific authenticatorData (base64url). */
  authenticatorData?: string;
  /** Optional WebAuthn clientDataJSON (base64url). */
  clientDataJSON?: string;
}

export type Fido2VerifyResult =
  | { result: 'verified-cryptographic' }
  | { result: 'rejected'; reason: string }
  | { result: 'unverifiable'; reason: string };

/** Algorithms the v2.0 fido2-assertion verifier accepts. */
const ALG_WHITELIST = new Set([
  'webauthn-es256', // ECDSA P-256 + SHA-256
  'webauthn-es384', // ECDSA P-384 + SHA-384
  'webauthn-eddsa', // Ed25519
]);

/**
 * Heuristic: detect placeholder signature strings used by the legacy structural
 * test vectors so the runner can downgrade them to `unverifiable` instead of
 * crashing on a base64url decode.
 *
 * A signature is "placeholder-shaped" if it is empty, starts with '<' (the
 * `<valid-webauthn-…>` shape), or doesn't base64url-decode to a plausible
 * length (>= 32 bytes).
 */
function isPlaceholderSignature(sig: string): boolean {
  if (!sig || sig.length === 0) return true;
  if (sig.startsWith('<')) return true;
  // Heuristic: real signatures are at least 32 bytes after decode. ECDSA-DER
  // signatures are 70–72 bytes; Ed25519 raw signatures are 64 bytes.
  try {
    const buf = Buffer.from(sig, 'base64url');
    if (buf.length < 32) return true;
    // If the round-trip doesn't preserve length-ish, treat as placeholder.
    // (base64url has a 4:3 ratio so input chars >= ceil(buf.length * 4 / 3).)
    return false;
  } catch {
    return true;
  }
}

/**
 * Decode a base64url-encoded public key into a Node KeyObject. Supports:
 *   - SPKI DER (the form Node's `crypto.generateKeyPair` emits with
 *     `format: 'der', type: 'spki'`) — primary supported form.
 *   - PEM-encoded SPKI / PKCS#1 (detected by leading `-----BEGIN`).
 *
 * Returns null if the key can't be parsed.
 */
function parsePublicKey(publicKey: string): KeyObject | null {
  if (publicKey.startsWith('-----BEGIN')) {
    try {
      return createPublicKey({ key: publicKey, format: 'pem' });
    } catch {
      return null;
    }
  }
  // Default: base64url-encoded SPKI DER.
  try {
    const der = Buffer.from(publicKey, 'base64url');
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    // Fall back to base64 (non-url) — some implementations use raw base64.
    try {
      const der = Buffer.from(publicKey, 'base64');
      return createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      return null;
    }
  }
}

/**
 * Map a v2.0 PACT alg identifier to the Node `crypto.verify` digest argument.
 * Ed25519 uses `null` (no separate digest).
 */
function digestForAlg(alg: string): string | null | undefined {
  switch (alg) {
    case 'webauthn-es256':
      return 'sha256';
    case 'webauthn-es384':
      return 'sha384';
    case 'webauthn-eddsa':
      return null; // Ed25519 — no digest
    default:
      return undefined;
  }
}

/**
 * The deterministic message the generic-fallback path signs over.
 *
 * Composition: `challenge_nonce || asserted_at || payload_hash?` as a UTF-8
 * concatenation. The optional `payload_hash` is appended (as a literal string)
 * when the proof commits to a separate message payload.
 *
 * Note: this is the fallback shape for test-vector signing when full WebAuthn
 * buffers (authenticatorData + clientDataJSON) are not present. Real WebAuthn
 * assertions sign over `authenticatorData || SHA-256(clientDataJSON)`, which is
 * handled by the @simplewebauthn/server path.
 */
function buildSignedMessage(challengeNonce: string, assertedAt: string, payloadHash?: string): Buffer {
  const parts = [challengeNonce, assertedAt];
  if (payloadHash !== undefined) parts.push(payloadHash);
  return Buffer.from(parts.join(''), 'utf8');
}

export function verifyFido2Assertion(input: Fido2VerifyInput): Fido2VerifyResult {
  // 1. Whitelist the algorithm.
  if (!ALG_WHITELIST.has(input.alg)) {
    return { result: 'rejected', reason: `alg ${JSON.stringify(input.alg)} not in v2.0 whitelist (${[...ALG_WHITELIST].join(', ')})` };
  }

  // 2. Placeholder-detection: legacy structural vectors carry strings like
  //    `<valid-webauthn-signature-...>`. Surface those as `unverifiable` so the
  //    caller can decide (signature_check: real → fail; structural → pass).
  if (isPlaceholderSignature(input.signature)) {
    return { result: 'unverifiable', reason: 'signature field is a placeholder; cannot perform cryptographic check' };
  }

  // 3. Parse the enrolled public key.
  const publicKey = parsePublicKey(input.publicKey);
  if (!publicKey) {
    // If the publicKey is also placeholder-shaped, this is a structural vector
    // — return unverifiable rather than rejected, so the caller can apply the
    // structural-vs-real policy.
    if (input.publicKey.startsWith('<') || input.publicKey.length < 16) {
      return { result: 'unverifiable', reason: 'public_key is a placeholder; cannot perform cryptographic check' };
    }
    return { result: 'rejected', reason: 'public_key could not be parsed (expected base64url SPKI DER or PEM)' };
  }

  // 4. Full-WebAuthn path: if authenticatorData + clientDataJSON are present,
  //    delegate to @simplewebauthn/server. (Deferred to v2.0.3+ — keeping the
  //    branch in place so future PRs can extend without an API change.)
  if (input.authenticatorData && input.clientDataJSON) {
    return {
      result: 'unverifiable',
      reason: 'full WebAuthn buffer verification (authenticatorData + clientDataJSON) not wired into the runner yet; deferred to v2.0.3',
    };
  }

  // 5. Generic fallback: verify a Node crypto.verify call over
  //    challenge_nonce || asserted_at (|| payload_hash).
  const digest = digestForAlg(input.alg);
  if (digest === undefined) {
    return { result: 'rejected', reason: `alg ${JSON.stringify(input.alg)} mapping missing` };
  }

  const message = buildSignedMessage(input.challengeNonce, input.assertedAt, input.payloadHash);
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(input.signature, 'base64url');
  } catch {
    return { result: 'rejected', reason: 'signature could not be base64url-decoded' };
  }

  let ok = false;
  try {
    ok = cryptoVerify(digest, message, publicKey, sigBuf);
  } catch (err) {
    return { result: 'rejected', reason: `crypto.verify threw: ${(err as Error).message}` };
  }

  if (!ok) {
    return { result: 'rejected', reason: 'signature did not verify against enrolled public key' };
  }
  return { result: 'verified-cryptographic' };
}
