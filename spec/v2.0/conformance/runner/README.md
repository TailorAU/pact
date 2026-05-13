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

## Status

Scaffold / first usable version, v0.1.0-dev. Not published to npm. Ride-along with the conformance scaffold (`spec/v2.0/conformance/`) and the `.github/workflows/conformance.yml` CI gate.
