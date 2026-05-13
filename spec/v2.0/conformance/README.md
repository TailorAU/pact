# PACT v2.0 Conformance — scaffold

This directory is the conformance test scaffold for PACT v2.0 (track T10 in [`docs/v2-plan.yaml`](../../../docs/v2-plan.yaml)). It exists before the v2.0 normative tracks land so every spec PR can be gated on conformance smoke tests from day one.

## Why a scaffold

The cold-eye review on the v2 plan (2026-05-12) flagged that tests should ship with normative text, not be retrofitted at the end. T10 lands the scaffold up front; T9 expands it to full coverage before v2.0 freeze.

## Directory layout

```
spec/v2.0/conformance/
├── README.md                    — this file
├── test-vector-format.yaml      — schema for individual test vectors
├── core/                        — Core conformance tests
│   ├── join.yaml
│   ├── leave.yaml
│   ├── intent.yaml
│   ├── constraint.yaml
│   ├── proposal.yaml
│   ├── object.yaml
│   ├── escalate.yaml
│   ├── done.yaml
│   └── poll.yaml
├── extended/                    — Extended conformance tests
│   ├── mediated-message.yaml
│   ├── classification-frame.yaml
│   ├── clearance.yaml
│   ├── disclosure-graduated.yaml
│   ├── negotiation.yaml
│   └── attestation/
│       ├── verify-fido2-valid.yaml          — kind: verification (§17.7 happy path)
│       ├── verify-replayed-nonce.yaml       — kind: verification (§17.7 step 5)
│       ├── verify-revoked-credential.yaml   — kind: verification (§17.7 step 3 + §17.8)
│       └── voice-biometric.yaml             — TODO, comes with HMAN's #3 PR
├── authorization-required/      — Authorization-Required tier tests
│   ├── cross-org-rejection.yaml
│   ├── revocation-propagation.yaml
│   └── principal-1to1.yaml      — HumanPrincipal is strictly 1:1 (issue #4)
├── sessions/                    — T3 Sessions tests (§19–20)
│   ├── open.yaml
│   ├── mandate-enforcement.yaml
│   ├── outcome-routing.yaml
│   └── revocation.yaml
├── push-delivery/               — T4 push tests (§21)
│   ├── subscription-crud.yaml
│   ├── at-least-once.yaml
│   └── signed-envelope.yaml
├── service-account/             — T5 service-account tests (§22)
│   └── lifecycle.yaml
├── identity/                    — T7 identity tests (§23)
│   ├── persistence.yaml
│   ├── cooperative-transfer.yaml
│   └── hostile-recovery.yaml
└── backward-compat/             — v1.1-client-against-v2.0-server tests
    └── v1.1-core.yaml
```

## How tests run

Each test is a single YAML file conforming to [`test-vector-format.yaml`](test-vector-format.yaml). There are two vector **kinds**:

- **`kind: http`** (default) — an HTTP request/response recording plus an expected event sequence. An implementation **passes** if, given the recorded request: (1) it returns the recorded response (modulo `body_ignore_fields` — UUIDs, timestamps); (2) it emits the expected events in the recorded order (or any order if `ordered: false`); (3) server state matches `postconditions`.
- **`kind: verification`** — exercises the §17.7 `authorization_proof` verification flow (client-side logic, no HTTP). Given the `proof`, the `registry` / `did_documents` to resolve against, the `verifier_clock`, and the `issued_nonces`, an implementation **passes** if its verification outcome matches `expected.result` (`verified` / `rejected` / `unverifiable`) and, on rejection, the `expected.failing_step` (1–6 from §17.7).

Reference runner: TBD. Likely Node.js + `ts-node`, callable from GitHub Actions, with an HTTP-record-and-replay harness.

## Self-certification

Implementations claiming a conformance level run the suite locally and submit results to `docs/IMPLEMENTERS.md` via PR. The PR includes:

- Implementation name and version
- Claimed conformance level (Core / Extended / Authorization-Required)
- Test result manifest (which tests passed, which failed with reason)
- Contact for the maintainer

The maintainer reviews the result manifest and adds the implementation to the registry. No external arbiter required — open self-certification with public record.

## Phase 0 minimum

Before the v2.0 normative tracks (T1, T2, T7) merge, the scaffold must include:

- [x] This README
- [x] `test-vector-format.yaml` defining the test vector schema
- [x] A CI hook (`.github/workflows/conformance.yml`) that, on every `spec/` PR, checks the scaffold is present, parses `test-vector-format.yaml`, and parses any test vectors that exist
- [ ] At least one smoke test per phase-0 track (T1, T2, T7) under `core/` / `extended/`
- [ ] The real conformance runner (HTTP record/replay + event-sequence assertions) replacing the parse-only CI step

Phase-0 smoke tests are intentionally minimal — they prove the scaffold works, not that every behaviour is covered. T9 expands to full coverage before v2.0 freeze.

## Notes

- `vc-jwt`, `biometric-hash`, and `passphrase-signed` from the v1.2-branch RFC are **not** v2.0 first-class types — v2.0 §18 defines only `fido2-assertion` and `voice-biometric` per issue #3. (Implementations MAY support additional custom attestation types under reverse-domain notation.)
- The test-vector format and directory shape are stable; concrete test vectors land as each track's normative text settles.
