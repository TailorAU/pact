# Changelog

## v2.0.1 — 2026-05-15

Patch release in response to the cold-eye audit (no breaking changes; additive clarifications, schema tightening, runner-honesty disclosures).

### Spec

- **§17.4** — added a security note on `did:web`: DNS hijack / cert compromise / domain takeover compromises every authorization signed under the domain. Implementations SHOULD treat `did:key` as the default for high-stakes principals; `Authorization-Required`-tier deployments accepting `did:web` SHOULD also require Certificate Transparency monitoring.
- **§17.9 Authorization-Required tier** — replaced the unenforceable "principal spans more than one human" rule with four concrete, deterministic registry checks: tombstoned principals, revoked credentials, revoked credentials anywhere in `attestation_chain`, and CT-visible certificates for `did:web` principals. The 1:1 invariant from §17.4 already does the prior rule's work.
- **§17.10 GDPR / right-to-be-forgotten** — softened to make explicit that PACT cannot answer per-jurisdiction legal questions. Implementations MUST evaluate compatibility with applicable law and document any exemption claimed; EU-jurisdiction `Authorization-Required` deployments SHOULD obtain external legal review of event-log retention.
- **§17.11 Delegation** — explicitly DEFERRED TO v2.1: the canonical `attestation_chain` item shape, the chained-verification algorithm, and trust-decay rules. v2.0 verifiers that cannot verify a non-empty chain MUST reject the proof as `unverifiable`; implementations that don't support delegation MUST reject any non-empty chain.
- **§23.4 Hostile recovery** — added quorum-enrollment-is-implementation-defined note (v2.1 will normalize an `agent.enroll-quorum` operation) and clarified the abandoned-agent-reset administrator must itself carry a valid `authorization_proof`.
- **§15.1 Implementation Profile** — example bumped to specVersion 2.0; added `retentionPolicy` (now Required at v2.0+), `authorizationProof` and `agentIdentityTransfer` capability flags, the `credentialsRegistry` endpoint, and a Required/SHOULD field table.
- **§6.3 Event-log retention** — softened the "not erased" wording to defer to §17.10's legal-evaluation requirement.
- **Footer** — replaced "auto-synced from this file" (which was never automated) with the actual mechanism: synced manually via coordinated PRs.

### Schemas

- **`authorization-proof.json`** — added `verifier_signed_nonce: boolean` annotation; `verifier_id` now REQUIRED via an `allOf` `if/then` block whenever `verifier_signed_nonce` is not `true`. The §17.6 verifier-binding rule is now machine-checkable. `attestation_chain` description updated to reflect the §17.11 deferral.

### Runner

- **Verdict honesty (cold-eye #1)** — `kind: verification` PASS results now print as `✓ verified-structural` (not `✓ verified`) plus a one-line footer reminder. JSON output adds a `runner_disclaimer` field. Makes it impossible to mistake a structural PASS for a real cryptographic check.
- **HTTP coverage warning (cold-eye #10)** — when every `kind: http` vector is skipped (typically because no `--server`), the runner prints a stderr WARNING. Run still exits 0 but the gap is visible.
- **README honesty disclosure** — runner README now prominently flags the structural-only scope and documents the external-implementer access pattern (source checkout while npm publish is gated on #5).

### Tooling / hygiene

- `package-lock.json` now committed for the conformance runner — CI reproducibility.
- `test-vector-format.yaml` — `failing_step` corrected from `1..6` to `1..5` (step 6 is the outcome step, not a failure mode).
- `AGENTS.md` rules 3, 4, 5 refreshed: rule 3 documents v2.0 as already promoted; rule 4 adds v2.0 to the frozen list; rule 5's "stub" wording dropped (sections are full now); coordinated-PR pattern made the explicit norm.
- `README.md` — implementations table now distinguishes "spec version served" (Tailor + Source serve v1.1; v2.0 server-side rollout in progress); v1.0 row re-tiered Legacy → Previous.

### Migration

Fully additive at every conformance level. v2.0 clients work against v2.0.1 servers unchanged. The new `verifier_signed_nonce` annotation is OPTIONAL; existing proofs with `verifier_id` set continue to validate. The new `Authorization-Required` checks are stricter on what counts as `verified`; implementations claiming that tier may need to add the four concrete checks (which they should already be doing under the prior rule's spirit).

---

## v2.0 — 2026-05-14

**Stable.** Supersedes v1.1. All v1.1 behavior is preserved; v2.0 is additive at Core conformance.

### New: Human Authorization Layer (§17)

- **`HumanPrincipal`** abstraction — strictly **1:1** with a single human (issue [#4](https://github.com/TailorAU/pact/issues/4)). Multi-persona / multi-entity handling sits **above** the PACT layer as an advisory `persona` claim. PACT verifiers see exactly one principal per human.
- **W3C DID identity** for principals (decision D6). Implementations MUST support `did:web` and `did:key`; MAY support additional methods.
- **`authorization_proof` envelope** — proof-of-human-intent that MAY accompany any PACT message: `type` / `principal_id` / `credential_id` / `challenge_nonce` (with verifier-binding) / `asserted_at` / `signature` / `alg` / `alg_version` / `attestation_chain`.
- **Verification flow** (six steps) and a **credential registry** at `/.well-known/pact-credentials.json` (or DID-document resolution).
- **GDPR / right-to-be-forgotten** position (§17.10): event-log entries are protocol-integrity records (not erased); credential-registry entries support cryptographic erasure + tombstone.
- **Delegation** with a 3-hop cap (§17.11).

### New: Attestation Format Reference (§18)

Two first-class types:
- **`fido2-assertion`** — WebAuthn / FIDO2 (issue [#3](https://github.com/TailorAU/pact/issues/3) accepted alongside `voice-biometric`).
- **`voice-biometric`** — structural contract: speaker-verification embedding + utterance-hash binding; audio never leaves the device; full crypto detail + test vectors land via HMAN's [#3](https://github.com/TailorAU/pact/issues/3) PR.

`vc-jwt`, `biometric-hash`, `passphrase-signed` (from the v1.2-draft list) are NOT v2.0 first-class — they may be implemented as custom types under §18.5.

### New: `Authorization-Required` conformance tier (§17.9)

Defined per decision D4. Implementations claiming this tier MUST require a valid `authorization_proof` on every cross-organisation message and MUST reject proofs whose `principal_id` resolution implies the principal spans more than one human. No implementation is required to claim this tier at launch.

### New: Agent Identity Lifecycle (§23)

Resolves issue [#13](https://github.com/TailorAU/pact/issues/13) Q7. Server-side persistent `agentId` (URN form, federation-portable), distinct from the HumanPrincipal that operates the agent. Cooperative operator transfer (outgoing signs → incoming countersigns → binding rotates, `agentId` unchanged). Non-cooperative recovery via **M-of-N quorum** or **abandoned-agent reset**, both gated by a configurable time-locked dispute window (default 72h).

### New: Event-log retention policy (§6.3)

Implementations MUST declare a `retentionPolicy` in their `/.well-known/pact.json` profile. Spec RECOMMENDS ≥ 365 days for resources that carry authorization proofs; regulated domains honour the longer of the spec recommendation and applicable regulation.

### New: Resource-type registry (§14.3)

Machine-readable registry at [`spec/v2.0/resource-types.yaml`](spec/v2.0/resource-types.yaml). Built-in types (`document`, `transaction`, `fact`, `record`) inventoried; custom types register via PR using reverse-domain notation.

### New: §5 self-approval rule

By default an agent's approval of its own proposal does NOT count toward `single` / `majority` / `unanimous`. Per-resource `allowSelfApproval` flag (default `false`). For the multi-agent-under-one-operator case (issue [#13](https://github.com/TailorAU/pact/issues/13) Q1), recommended pattern: `objection-based` policy.

### New: Conformance suite & runner

- [`spec/v2.0/conformance/`](spec/v2.0/conformance/) — directory, test-vector format (two kinds: `http`, `verification`), four initial vectors (one Core join, three §17.7 attestation-verification cases).
- [`spec/v2.0/conformance/runner/`](spec/v2.0/conformance/runner/) — `@pact-protocol/conformance-runner` v0.1.0-dev. Runs verification vectors locally and (with `--server`) HTTP vectors against a target server.
- `.github/workflows/conformance.yml` — gates every `spec/**` PR on the runner.

### New: Schemas

- `spec/v2.0/schemas/authorization-proof.json` (§17.6 envelope + §18.1 common fields + voice-biometric additions).
- `spec/v2.0/schemas/principal-registry.json` (§17.8 registry, with tombstone).
- `spec/v2.0/schemas/agent-identity.json` (§23 transfer / recovery attestations + quorum / abandonment).
- All 29 v2.0 schemas bumped to **JSON Schema 2020-12** (older spec versions stay on draft-07 for citation stability).

### New: Reference CLI / MCP capabilities

- `@pact-protocol/cli` — `--authorization-proof <file>` flag on every write command (`intent` / `constrain` / `salience` / `object` / `done` / `escalate` / `ask`); new `pact verify-proof` (local §17.7 verification) and `pact profile` (read `/.well-known/pact.json`, optionally assert minimum conformance level).
- `@pact-protocol/mcp` — parity with the CLI: `pact_ask`, `pact_negotiate_list` / `_position` / `_synthesis`, `pact_profile`. Optional `authorizationProof` arg on every write tool.

### Reserved for v2.1

§19–20 (Sessions + Mandate), §21 (push delivery / webhooks), §22 (service-account auth). v2.0 ships without these; they will land in `spec/v2.1/` once RFC [#14](https://github.com/TailorAU/pact/issues/14) converges and T4 / T5 are designed.

### Migration from v1.1

Fully additive at Core conformance. A v1.1 client works against a v2.0 server unchanged. The `authorization_proof` envelope is OPTIONAL at Core; verifiers MAY ignore it.

### Coordination notes

- v1.2-draft was collapsed into v2.0 (decision D1; commit `d129cae` in pact-repo).
- The `tailor-app` mirror (`docs/architecture/PACT_SPECIFICATION.md` + companions) was synced via [`TailorAU/tailor-app#1616`](https://github.com/TailorAU/tailor-app/pull/1616), merged 2026-05-14.
- v1.1 carries an [errata note](spec/v1.1/ERRATA.md) for two known issues (phantom §15/§16 preamble refs, stale schema `$id` paths).

---

## v1.1 — 2026-04

Resource-agnostic protocol — generalised v1.0 from document-only to **any resource type** (documents, transactions, knowledge claims, clinical records). Documents remain the default resource type and v1.0 endpoints continue to work.

Key additions:

- **Resource Types** (§14) — implementations declare what kind of resource agents negotiate over (`document` / `transaction` / `fact` / `record`).
- **Implementation Profiles** (§15.1) — each PACT server publishes `/.well-known/pact.json` advertising its supported resource types and capabilities.
- **Conformance Levels** (§15.2) — Core vs Extended compliance tiers.
- **Backward compatibility** — proposals without an explicit `type` default to `document`; all v1.0 endpoints continue to work.

[`spec/v1.1/SPECIFICATION.md`](spec/v1.1/SPECIFICATION.md). Errata: [`spec/v1.1/ERRATA.md`](spec/v1.1/ERRATA.md) — phantom §15/§16 preamble references and stale schema `$id` paths (corrected forward in v2.0; v1.1 itself stays frozen for citation stability).

## v1.0 — March 2026

Promotion of v0.4 to a stable v1.0. The protocol surface stabilised at this point:

- Core primitives (`join`, `leave`, `intent`, `constrain`, `propose`, `object`, `escalate`, `done`, `poll`).
- Event-sourced operation log; objection-based merge (silence = consent).
- Information barriers, classification, graduated disclosure, mediated communication, structured negotiation.
- BYOK invite-token flow for cross-organisation joins (no shared account required).

[`spec/v1.0/SPECIFICATION.md`](spec/v1.0/SPECIFICATION.md).

## v0.x — early 2026

Initial protocol drafts (`v0.3`, `v0.4`). Documents-only consensus, the original `propose → vote → merge` flow, the first cuts of intent / constraint / salience. Retained for citation stability; not for production use.
