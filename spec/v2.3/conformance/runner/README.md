# @pact-protocol/conformance-runner

The PACT v2.0 conformance runner. Loads test-vector YAML files (per [`../test-vector-format.yaml`](../test-vector-format.yaml)) and executes them, reporting pass/fail.

## Vector kinds

- **`kind: verification`** — runs the §17.7 authorization-proof verification flow locally (no server). Structural checks + freshness + nonce binding + (with `registry`) principal resolution and credential revocation.
- **`kind: http`** — executes the recorded HTTP request against a PACT server (`--server`), compares status + body using `body_match.mode` (`exact` / `subset`; `schema` deferred). Event-sequence assertion is deferred to a follow-up.

`kind: verification` runs unconditionally in CI; `kind: http` SKIPs when no `--server` is provided.

## Usage

```bash
cd spec/v2.0/conformance/runner
npm install
npm run build
node dist/index.js run --vectors ..              # all vectors under spec/v2.0/conformance/
node dist/index.js run --vectors .. --filter verify    # only ids containing 'verify'
node dist/index.js run --vectors .. --server https://pact.example.com   # also run http vectors
node dist/index.js run --vectors .. --json       # JSON report (for CI gating)
```

Exit code: `0` if all selected vectors `pass` (or are `skip`ped for documented reasons); `1` otherwise.

## What's covered today

- §17.7 verification flow steps 1, 2, 4, 5 + §17.8 revocation/tombstone.
- **§17.7 step 3 (cryptographic signature verification)** for `type: fido2-assertion` proofs when the vector declares `verification.signature_check: real`. The runner uses Node's built-in `crypto.verify` over the SPKI-DER-encoded enrolled public key, with the v2.0 alg whitelist `webauthn-es256` / `webauthn-es384` / `webauthn-eddsa`. The fallback signed-payload composition is `UTF-8(challenge_nonce || asserted_at [|| payload_hash])`. Full WebAuthn buffer verification (`authenticatorData` + `clientDataJSON`) via `@simplewebauthn/server` is wired in as a branch but deferred to v2.0.3.
- HTTP execution + status/body match (exact/subset). Body-ignore-fields supported.

## What's NOT covered yet (TODO)

- `body_match.mode: schema` — needs ajv (or equivalent) plugged in.
- `expected_events` — needs an event-log subscription. Most servers expose this via SignalR or polling; the runner will subscribe and verify the sequence with a configurable timeout.
- Full WebAuthn `authenticatorData + clientDataJSON` buffer verification via `@simplewebauthn/server` (deferred to v2.0.3 — the generic fallback covers the v2.0.2 self-contained vectors).
- `voice-biometric` cryptographic verification (per HMAN's #3 PR — §18.6).
- HTTP record-and-replay (rather than live-execute) — useful for offline conformance checks.
- A self-certification badge generator.

## Honesty disclosure

The runner now performs **real cryptographic signature verification** for `type: fido2-assertion` proofs whenever the vector declares `verification.signature_check: real`. Such vectors PASS only if the runner can verify the proof's `signature` against the SPKI-DER public key enrolled in the vector's `registry`. A real-shape signature that does NOT verify is rejected at §17.7 step 3 (`failing_step: 3`). This closes the v2.0.1 "A1: forged-signature pass" attack — see `spec/v2.0/conformance/extended/attestation/verify-fido2-real-signature.yaml` (positive) and `verify-fido2-forged-signature.yaml` (negative) for the smoke test.

Two PASS shapes:

- **`✓ verified-cryptographic`** (JSON `verification_mode: cryptographic`) — §17.7 step 3 ran and the signature verified against the enrolled public key. The result `verified` here means the same thing it does in §17.7: the proof is end-to-end valid.
- **`✓ verified-structural`** (JSON `verification_mode: structural`) — the runner exercised envelope / principal resolution / freshness / replay only. Step 3 was skipped because the vector opted in via `signature_check: structural` (legacy v2.0.1 placeholder-signature vectors), or because the attestation type is not `fido2-assertion` (`voice-biometric` defers to HMAN's #3 PR; custom types defer to their implementation-defined verifiers).

A structural-only PASS does **NOT** prove the signature is cryptographically valid. New `fido2-assertion` vectors SHOULD use `signature_check: real` and carry a real signature + matching public key.

## External implementers

This runner is currently a **private package** (`private: true` in `package.json`). External implementers can use it via:

- **Source checkout:** `git clone TailorAU/pact && cd spec/v2.0/conformance/runner && npm install && npm run build`. This is the supported path while npm publish is gated on issue [#5](https://github.com/TailorAU/pact/issues/5) (the `pact-protocol` org).
- **Self-cert flow:** run the suite locally against your server, then PR the result manifest into `docs/IMPLEMENTERS.md` (TODO until first implementer arrives).

When `pact-protocol` is on npm, this package will publish alongside `@pact-protocol/cli` and `@pact-protocol/mcp` and external implementers can `npx @pact-protocol/conformance-runner run --server …`.

## Status

First usable version, v0.1.0-dev. Ride-along with the conformance scaffold (`spec/v2.0/conformance/`) and the `.github/workflows/conformance.yml` CI gate.
