# PACT v2 Conformance — scaffold

This directory is the pre-staged scaffold for the PACT v2 conformance test suite (T10 in [v2-plan.yaml](../../v2-plan.yaml)). Once D1 resolves and `spec/v2/` is created, this scaffold moves to `spec/v2/conformance/`.

## Why a scaffold

The cold-eye review on the v2 plan (2026-05-12) flagged that tests should ship with normative text, not be retrofitted at the end. T10 lands the scaffold in phase 0; T9 in phase 3 expands to full coverage.

The scaffold must exist before T1 normative text merges so every v2 PR can be gated on conformance smoke tests from day one.

## Directory layout (target under `spec/v2/conformance/`)

```
spec/v2/conformance/
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
│       ├── fido2.yaml
│       ├── vc-jwt.yaml
│       ├── biometric-hash.yaml
│       ├── passphrase-signed.yaml
│       └── voice-biometric.yaml
├── authorization-required/      — Authorization-Required tier tests
│   ├── cross-org-rejection.yaml
│   ├── revocation-propagation.yaml
│   └── principal-1n.yaml
├── sessions/                    — T3 Sessions tests
│   ├── open.yaml
│   ├── mandate-enforcement.yaml
│   ├── outcome-routing.yaml
│   └── revocation.yaml
├── push-delivery/               — T4 push tests
│   ├── subscription-crud.yaml
│   ├── at-least-once.yaml
│   └── signed-envelope.yaml
├── service-account/             — T5 service-account tests
│   └── lifecycle.yaml
├── identity/                    — T7 identity tests
│   ├── persistence.yaml
│   ├── cooperative-transfer.yaml
│   └── hostile-recovery.yaml
└── backward-compat/             — v1.1-client-against-v2-server tests
    └── v1.1-core.yaml
```

## How tests run

Each test is a single YAML file conforming to [`test-vector-format.yaml`](test-vector-format.yaml). A test is an HTTP request/response recording plus an expected event sequence.

An implementation **passes** a test if, given the recorded request:
1. It returns the recorded response (modulo `body_ignore_fields` — UUIDs, timestamps, etc.)
2. It emits the expected events in the recorded order (or any order if `ordered: false`)
3. Server state matches `postconditions` after the test runs

Reference runner: TBD. Likely Node.js + `ts-node`, callable from GitHub Actions, with a HTTP-record-and-replay harness.

## Self-certification

Implementations claiming a conformance level run the suite locally and submit results to `docs/IMPLEMENTERS.md` via PR. The PR includes:

- Implementation name and version
- Claimed conformance level (Core / Extended / Authorization-Required)
- Test result manifest (which tests passed, which failed with reason)
- Contact for the maintainer

The maintainer reviews the result manifest and adds the implementation to the registry. No external arbiter required — open self-certification with public record.

## Phase 0 minimum

Before T1 normative text merges, the scaffold must include:

- [x] This README
- [x] `test-vector-format.yaml` defining the test vector schema
- [ ] At least one smoke test per phase-0 track (T1, T2, T7)
- [ ] A CI hook (GitHub Actions) that runs the smoke tests on every `spec/` PR

Phase-0 smoke tests are intentionally minimal — they prove the scaffold works, not that every behaviour is covered. T9 in phase 3 expands to full coverage.

## Why this lives under `docs/v2-prep/` for now

The plan's D1 decision determines whether `spec/v2/` exists yet. If D1 resolves to "skip v1.2-stable; collapse to v2," this scaffold moves to `spec/v2/conformance/` and the `v1.2` branch is renamed. If D1 resolves the other way, the scaffold sits in `docs/v2-prep/` longer.

Either way, the test-vector format and directory shape are stable — they're agnostic to where the spec text lives.
