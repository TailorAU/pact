# Execution-boundary conformance vectors (§25, §17.14)

Vectors for the v2.3 safety boundary between a **PACT protocol state**, a
**human attestation**, and **legal execution** — spec §25, plus the
`authorization_proof` scope limit in §17.14.

Raised as [TailorAU/pact#41](https://github.com/TailorAU/pact/issues/41). The
additive disclosure for the stable v2.2 line is
[`../../../../v2.2/ERRATA.md`](../../../../v2.2/ERRATA.md).

## What these vectors pin

| Vector | Kind | Pins |
|---|---|---|
| `ttl-automerge-creates-no-attestation` | session | TTL / no objection MAY auto-merge an eligible **draft** edit, and creates **no** signature or attestation (§25.3, §25.4, §25.8) |
| `ttl-transaction-blocks-not-settles` | session | TTL / no objection on an external-irreversible resource does **not** settle or execute — it fails closed to `AwaitingAttestation`, and a second expiry does not release the guard (§25.6) |
| `consensus-contract-is-draft-not-signed` | session | Full consensus on an NDA yields an **aligned, merged draft** — never `signed` / `executed` absent a §25.8 execution capability |
| `attest-payload-bound-verified` | verification | **Positive control** — a correctly payload-bound attestation verifies with real Ed25519 crypto |
| `attest-wrong-payload-rejected` | verification | A rewritten `payload_hash` breaks the signature — real-crypto proof that the payload binding is enforced (§25.7 check 4) |
| `attest-expired-rejected` | verification | Stale attestation refused at §17.7 step 4, correct scope notwithstanding |
| `attest-replayed-rejected` | verification | Replayed attestation refused at §17.7 step 5, on the apply path |
| `attest-wrong-principal-rejected` | verification | Unresolvable principal refused at §17.7 step 2 |
| `guarded-apply-attestation-missing-refused` | http | **Absent** attestation is a `403 apply.attestation_required` refusal, not a warning (§25.7 check 1) |
| `guarded-apply-wrong-principal-refused` | http | A *verified* proof from a non-required signer is refused `apply.principal_mismatch` (§25.7 check 3) |
| `guarded-apply-wrong-scope-refused` | http | A proof scoped to another effect — or to a lower effect class — is refused `apply.attestation_scope_mismatch` (§25.7 check 5) |

The AC of issue #41 asks for negative coverage of **missing, expired, replayed,
wrong-principal, wrong-scope and wrong-payload** attestations, all rejected
*before* any guarded apply. Each has a vector above; "wrong-principal" needs two
because the unresolvable case is decidable by §17.7 alone while the
not-a-required-signer case is an application-layer binding (§25.7 check 3) that
only the apply path can express.

## Which of these actually execute

Be precise about this — a green run does not mean all eleven were checked.

- **`kind: verification` (5 vectors)** run unconditionally in the
  [conformance runner](../../runner). Four of the five are pure
  §17.7 flow checks; `attest-payload-bound-verified` and
  `attest-wrong-payload-rejected` declare `signature_check: real` and perform
  genuine Ed25519 verification, so they report `verified-cryptographic`.
- **`kind: session` / `kind: http` (6 vectors)** need `--server <url>`. Without
  one they SKIP.

**No PACT server implements §25 yet**, including this repo's
`reference-server/`. Run with `--server` today and the six server-bound vectors
FAIL — correctly. They encode required v2.3 behaviour that does not exist yet;
they are the acceptance criteria for implementing it, not a regression report.

The repository CI (`.github/workflows/conformance.yml`) runs the runner against
`spec/v2.0/conformance` only, so nothing here is executed in CI. Wiring a
v2.3 job is deliberately left to the maintainer alongside the reference-server
work — see the PR for #41.

## Running them locally

```bash
cd spec/v2.3/conformance/runner
npm ci && npm run build

# verification vectors only (server-bound ones SKIP)
node dist/index.js run --vectors .. --filter execution-boundary

# with a server that implements §25 (none does yet — expect failures)
node dist/index.js run --vectors .. --filter execution-boundary --server http://127.0.0.1:4100
```

## Reading the assertions

Two conventions used throughout, both leaning on existing runner features
rather than extending it:

- **Empty-`match` negative assertions.** `cross_call_assertions` of
  `kind: negative_obligation` with `match: {}` match *any* entry, so the
  assertion fails if the collection has any element. That is how
  "`attestations` MUST be empty" and "`signature_records` MUST be empty" are
  expressed without a new assertion kind.
- **`postconditions.apply_attested_events_added: 0`.** Documentation for a
  future event-aware runner (the current runner does not subscribe to the event
  stream). The `expected_events` blocks are recorded for the same reason.
