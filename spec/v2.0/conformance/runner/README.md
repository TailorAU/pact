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

- §17.7 verification flow steps 1, 2, 4, 5 + §17.8 revocation/tombstone. Step 3 (cryptographic signature verification proper) is attestation-type-specific and out of scope for the structural runner; vectors expecting a step-3 rejection use a detectable failure mode (e.g. revoked credential).
- HTTP execution + status/body match (exact/subset). Body-ignore-fields supported.

## What's NOT covered yet (TODO)

- `body_match.mode: schema` — needs ajv (or equivalent) plugged in.
- `expected_events` — needs an event-log subscription. Most servers expose this via SignalR or polling; the runner will subscribe and verify the sequence with a configurable timeout.
- Attestation-type-specific cryptographic signature verification (fido2-assertion WebAuthn assertion check, voice-biometric per HMAN's #3 PR).
- HTTP record-and-replay (rather than live-execute) — useful for offline conformance checks.
- A self-certification badge generator.

## Honesty disclosure

`kind: verification` PASS results are **structural-only**. The runner explicitly does NOT perform §17.7 step 3 (cryptographic signature verification) — that's attestation-type-specific (WebAuthn assertion check for `fido2-assertion`, the HMAN voice-pipeline for `voice-biometric`). A passing vector here proves the envelope is well-formed, the principal resolves, the credential isn't revoked, the timestamp is fresh, and the nonce binding holds. **It does NOT prove the signature is real.** A forged proof against an existing un-revoked credential will currently pass.

The runner makes this loud in two places: the per-vector tag prints as `✓ verified-structural` (not `✓ verified`), and the report footer reminds you. End-to-end crypto needs a per-attestation-type verifier — see the §17.11 / §18 deferred items.

## External implementers

This runner is currently a **private package** (`private: true` in `package.json`). External implementers can use it via:

- **Source checkout:** `git clone TailorAU/pact && cd spec/v2.0/conformance/runner && npm install && npm run build`. This is the supported path while npm publish is gated on issue [#5](https://github.com/TailorAU/pact/issues/5) (the `pact-protocol` org).
- **Self-cert flow:** run the suite locally against your server, then PR the result manifest into `docs/IMPLEMENTERS.md` (TODO until first implementer arrives).

When `pact-protocol` is on npm, this package will publish alongside `@pact-protocol/cli` and `@pact-protocol/mcp` and external implementers can `npx @pact-protocol/conformance-runner run --server …`.

## Status

First usable version, v0.1.0-dev. Ride-along with the conformance scaffold (`spec/v2.0/conformance/`) and the `.github/workflows/conformance.yml` CI gate.
