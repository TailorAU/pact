# Changelog

## v2.0.3 — 2026-05-15

Third patch on v2.0. Introduces **Fabric Onboarding & Session Awareness** — five additive operations and six new events that close the "cognitive layer" gap between *being registered in a fabric* and an agent *knowing it is in a fabric, with these obligations, with these counterparties*. **Additive — no breaking changes to v2.0 / v2.0.1 / v2.0.2 clients.**

### Why this patch

The user framing: PACT v2.0.2 had the network and registration layers right (TLS join/leave, registry membership) but agents were still being told "you are in fabric X" by callers — there was no canonical way for an agent to ask the server *what fabrics am I currently in, what's the phase of each, what do I owe, what have I missed?* This release fills that gap with manifest, status, transcript, mark-read, heartbeat, and an atomic onboard operation that bundles join+constrain so there is never a half-joined window.

### Spec text changes

`spec/v2.0/SPECIFICATION.md`:

- §4.1 (expanded) — heartbeat is now bidirectional and feeds the manifest's per-member `last_seen`; back-compat note for v2.0.2 clients
- §4.4 (NEW) — **Active Session Manifest Operations** — five subsections covering `_status`, `manifest`, `_heartbeat`, `mark-read`, `_onboard`; each specifies method/path, request schema, response schema, errors, idempotency, emitted events, verifier_id binding, and §15.5 tier
- §4.5 (renumbered) — existing Merge Operations moved from §4.4 → §4.5
- §6.2 — events catalog adds `pact.fabric.onboarded`, `pact.agent.heartbeat-received`, `pact.agent.attention-required`, `pact.agent.mark-read`, `pact.obligation.created`, `pact.obligation.discharged`
- §6.5 (NEW) — **Pending Obligations** — first-class definition: shape, four `kind`s (vote / respond / sign / ack), creation/discharge semantics, surfacing rules
- §7.1 — REST endpoints listing extended with all five new paths
- §7.2 — Real-time event channel extended with six new `On*` events (mirrors §6.2 additions)
- §7.3 — MCP tools list extended with seven new tools (mirrors `mcp/` v2.0.3)
- §15.1 — capability flags list extended: `atomicOnboard`, `manifest`, `sessionAwareness` (all v2.0.3)
- §15.6 (NEW) — **Fabric Onboarding Pattern** — sequence diagram, half-joined-window analysis, cross-org guidance
- §17.13 — added "Manifest visibility" subsection: cross-org / clearance disclosure rules enforced on manifest endpoints; coarse-grained timestamps to avoid timing side channels; non-member 403/404 behaviour
- Appendix A.2 — schema table extended with nine new schemas

### Schemas

Nine new files under `spec/v2.0/schemas/`, all JSON Schema 2020-12, all with `examples`:

- `fabric-status.json`, `fabric-manifest.json`
- `heartbeat-request.json`, `heartbeat-response.json`
- `mark-read-request.json`, `mark-read-response.json`
- `onboard-request.json`, `onboard-response.json`
- `pending-obligation.json` (shared shape used by both status and manifest)

### Conformance suite

Five new test vectors under `spec/v2.0/conformance/extended/sessions/`:

- `onboard-success.yaml` — atomic happy path; asserts `pact.fabric.onboarded` and `pact.agent.joined`
- `onboard-partial-failure.yaml` — constraint rejected; follow-up status assertion proves non-membership (atomicity)
- `manifest-cross-org-disclosure.yaml` — §17.13 reduction pinned; caller sees own record fully, cross-org peer reduced to `display_name` + summary counts
- `heartbeat-timeout.yaml` — stale member flagged (`liveness: stale`), not auto-evicted
- `obligation-surfacing.yaml` — pre-vote manifest shows pending obligation; post-vote shows it discharged

Runner extensions (`@pact-protocol/conformance-runner@0.3.0-dev`):

- New `kind: session` for multi-step vectors with `cross_call_assertions` (e.g. "after rejected onboard, status MUST show non-membership")
- New assertion kinds: `negative_membership`, `negative_obligation`
- `resolveBodyPath` dot-path body accessor
- Existing v2.0.2 baseline (7 pass · 0 fail · 1 skip) preserved; new total: 7 pass · 0 fail · 6 skip (5 new server-bound vectors require `--server`)

### CLI changes (`@pact-protocol/cli@2.0.3`)

- New `pact onboard <fabricId> [--constraints <file>] [--verifier <did>]` — atomic onboard via `_onboard`
- New `pact status [<fabricId>] [--all]` — remote `_status` snapshot or local-state cross-fabric summary
- New `pact where` — offline cross-fabric "what am I in" view with 60s cache freshness, `--refresh` for live data
- New `pact manifest <fabricId>` — caller-scoped manifest fetch + local cache
- New `pact transcript <fabricId> [--since <id>] [--mark-read]` — event log + optional ack
- `pact join` and `pact negotiate position` gain `--heartbeat` (one-shot, best-effort)
- New `cli/src/sessions.ts` — local state under `~/.pact/` with atomic O_EXCL lockfile (5s timeout)

### MCP changes (`@pact-protocol/mcp@2.0.3`)

Seven new tools added:

- `pact_onboard`, `pact_status`, `pact_manifest`, `pact_transcript`, `pact_heartbeat`, `pact_mark_read`
- `pact_session_announce` — **cognitive-layer hook**: returns a structured "you are in N fabrics with M obligations" payload for the calling LLM to prepend to its working context. Offline by default; `refresh_manifests: true` for live data.

### Capability flags (advertised in `/.well-known/pact.json` `capabilities`)

Servers SHOULD set:

- `capabilities.atomicOnboard: true` when `_onboard` is implemented
- `capabilities.manifest: true` when `GET /manifest` is implemented
- `capabilities.sessionAwareness: true` when the full §4.4 operation set is implemented

Clients SHOULD prefer `_onboard` over `join` + N `POST /constraints` when the server advertises support.

### Path conventions

All v2.0.3 operations live under `/api/pact/{fabricId}/...` (consistent with v2.0.2 routes). `{fabricId}` and `{documentId}` are synonyms — servers MUST accept both forms in the URL.

### Files touched

- 1 spec file (`spec/v2.0/SPECIFICATION.md`)
- 9 new schemas
- 5 new test vectors + runner extensions
- 5 new CLI commands + 1 new local-state module
- 7 new MCP tools + 1 mirrored local-state module
- `cli/package.json` and `mcp/package.json` → `2.0.3`
- `spec/v2.0/conformance/runner/package.json` → `0.3.0-dev`

### Mirror

This release mirrors to `tailor-app` via PR [#1701](https://github.com/TailorAU/tailor-app/pull/1701) (squash-merged 2026-05-15) following the v2.0.x coordinated-PR pattern (see [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616), [#1673](https://github.com/TailorAU/tailor-app/pull/1673), [#1679](https://github.com/TailorAU/tailor-app/pull/1679)).

---

## v2.0.2 — 2026-05-15

Second patch on v2.0. Response to the **adversarial / red-team cold-eye review**. Closes 10 named attacks (A1–A10) and three structural concerns (S1–S3) from that review. **Additive — no breaking changes to v2.0 / v2.0.1 clients.**

### What the audit named, and how v2.0.2 addresses each

| # | Attack | How v2.0.2 closes it |
|---|---|---|
| **A1** | Forged-signature pass via the reference runner | The conformance runner now performs **real cryptographic signature verification** for `fido2-assertion` proofs (`signature_check: real`; uses `@simplewebauthn/server`). PASS verdict now distinguishes `verified-cryptographic` from `verified-structural`. Mutation-tested: a flipped signature byte produces `rejected (failing_step=3)`. |
| **A2** | Self-asserted conformance laundering | New §15.5 **`pact_introspect_tier`** behavioural probe: `POST /api/pact/_probe/tier` with a known set of checks; server returns a signed `tier_probe_report` describing which checks it actually enforces. New `pact tier-introspect` CLI + `pact_tier_introspect` MCP tool. MUST at `Authorization-Required` conformance. |
| **A3** | `verifier_id` presence-vs-equality | §17.6 + §17.7 step 5 now require *equality*, not just presence. New `verifier_signed_nonce: boolean` annotation lets producers assert the (b) branch of the rule. New `--verifier <did>` enforcement in `pact verify-proof`. New runner field `verification.receiving_verifier_id` + new test vector `verify-cross-verifier-replay.yaml`. |
| **A4** | Tombstone-then-resurrect (registry mutable) | §17.8 introduces an **append-only mutation log** at `log_uri`, hash-chained from a GENESIS entry. Snapshot at `/.well-known/pact-credentials.json` carries `snapshot_root` + `snapshot_signature` committing the server to the current state. Resurrection is itself a logged event, visible to every cache-respecting verifier. |
| **A5** | Event-log tampering (no tamper-evidence) | New **§6.4 Event-log integrity**: every event MUST carry `prev_hash` (SHA-256 of RFC 8785 canonical encoding of prior event). Daily `pact.log.root` event commits the chain via signature. REQUIRED at Extended and Authorization-Required. Schema: `event.json` adds `prev_hash`. |
| **A6** | `did:web` historical-authority rewrite via domain takeover | **§17.4 DID Document pinning** (REQUIRED at v2.0.2): verifiers MUST snapshot the resolved DID Document on first observation of a `principal_id` and reject any subsequent resolution that doesn't either match the pinned state or chain to it via a signed rotation event in the registry mutation log. Capability flag: `capabilities.didDocumentPinning`. |
| **A7** | Multi-hop trust decay (delegation deferral) | Unchanged — delegation is correctly deferred to v2.1 per §17.11. The audit confirmed deferral is the right call; v2.0 verifiers MUST reject non-empty `attestation_chain` they cannot verify. |
| **A8** | M-of-N dispute-window starvation | New **§23.5b**: implementations supporting recovery MUST emit `pact.agent.recovery-initiated` to ≥2 notification channels (heterogeneous transports). New `pact.agent.recovery-disputed` event lets the operator-of-record or non-co-signing quorum members suspend an in-flight recovery. External anchor URI for cross-checking. New `recoveryDispute` shape in `agent-identity.json`. |
| **A9** | Unconstrained `alg` accepting HMAC | §17.6 introduces a normative **alg whitelist**: `webauthn-es256` / `webauthn-es384` / `webauthn-eddsa` for `fido2-assertion`; `resemblyzer-v1` for `voice-biometric`; reverse-domain for custom. Anything else (notably HMAC algs) MUST be rejected at §17.7 step 3. Schema enforces via `anyOf`. New test vector `verify-alg-disallowed.yaml` exercises HS256 rejection. |
| **A10** | "Cryptographic erasure" that isn't | §17.10 rewritten to acknowledge cryptographic erasure is an **operational claim, not a cryptographic guarantee**. Implementations claiming `Authorization-Required` SHOULD document hardware-bound storage, backup policy, and the legal regime under which keys could be compelled. |

| # | Structural concern | Resolution |
|---|---|---|
| **S1** | Cross-organisation boundary undefined | New §15.4 defines cross-org deterministically: different DID methods, or `did:web` differing at eTLD+1 (Public Suffix List), or unresolvable from the receiver's federated registry, or explicit `cross_org_assertion`. Determinations SHOULD be logged. |
| **S2** | Salience as authority signal vs constraint | New §10.7: agents declaring salience ≥ 7 MUST respond within `abstention_ttl` (default 4× proposal TTL) or are auto-demoted to salience=5 for that proposal. Closes the "set salience=10 and abstain to block forever" abuse. New event: `pact.salience.auto-demoted`. |
| **S3** | Trust model implicit | New §17.13 explicit non-normative trust-model section: what the protocol guarantees, what only the implementer can guarantee, and what a verifier should therefore assume. Trust floor = weakest implementation in the graph. |

### Spec text changes

`spec/v2.0/SPECIFICATION.md`:
- §6.4 (NEW) — Event-log integrity (hash-chained + signed root)
- §10.7 (NEW) — Salience abstention timeout
- §15.1 — expanded `capabilities` set; added `endpoints.credentialsRegistry` + `registrySigningKey` + `logSigningKey` mentions
- §15.4 (NEW) — Cross-organisation boundary definition
- §15.5 (NEW) — `pact_introspect_tier` behavioural probe
- §17.4 — DID Document pinning rule added
- §17.6 — `alg` whitelist (normative), `verifier_signed_nonce` annotation, `verifier_id` equality wording
- §17.7 — step 5 wording sharpened (equality, not presence)
- §17.8 — append-only mutation log + snapshot_root + snapshot_signature + log_uri
- §17.9 — Authorization-Required tier inherits the four-check rule from v2.0.1; clarified `pact_introspect_tier` is REQUIRED at this tier
- §17.10 — cryptographic erasure honestly reframed as operational
- §17.13 (NEW) — Trust model (non-normative framing)
- §23.5b (NEW) — Multi-channel notification + `pact.agent.recovery-disputed` event

### Schemas

- `authorization-proof.json`: `alg` is now an `anyOf` whitelist; description tightened.
- `event.json`: adds `prev_hash` for the §6.4 chain.
- `principal-registry.json`: `version` accepts `"2.0"`; adds `snapshot_root` / `snapshot_signature` / `log_uri` (REQUIRED when `version == 2.0`).
- `agent-identity.json`: adds `recoveryDispute` shape to the `oneOf`.

### Runner

- `@simplewebauthn/server@^13.3.0` added as a dependency.
- `src/webauthn.ts` (NEW) — real signature verifier (ES256/ES384/Ed25519 via Node `crypto.verify` + SPKI-DER); alg whitelist enforced.
- `src/index.ts` — wires the verifier in; `kind: verification` PASS now reports `verified-cryptographic` vs `verified-structural`; new `receiving_verifier_id` field for cross-verifier equality testing.
- `package-lock.json` regenerated.
- README "Honesty disclosure" expanded.

### CLI / MCP

- `pact verify-proof` — when `--verifier <did>` is supplied, EQUALITY against the proof's `verifier_id` is enforced (was: presence-only).
- `pact tier-introspect <server-url>` (NEW) — behavioural probe of the server's advertised tier; outputs the signed report; `--require-pass` exits non-zero on any non-pass check.
- `pact_tier_introspect` (NEW MCP tool) — same surface.

### Test vectors

- `extended/attestation/verify-fido2-real-signature.yaml` (NEW, from agent) — real Ed25519 signature, `signature_check: real`, expected `verified`.
- `extended/attestation/verify-fido2-forged-signature.yaml` (NEW, from agent) — flipped-byte signature, expected `rejected (failing_step=3)`.
- `extended/attestation/verify-cross-verifier-replay.yaml` (NEW) — `verifier_id: did:web:a.example` arriving at `did:web:b.example` → `rejected (failing_step=5)`.
- `extended/attestation/verify-alg-disallowed.yaml` (NEW) — `alg: HS256` → `rejected (failing_step=3)`.
- The three v2.0/v2.0.1 vectors are now flagged `signature_check: structural` to preserve their original intent.

Final suite: **7 verification vectors pass · 0 fail · 1 HTTP skip** (no `--server`).

### Migration from v2.0.1

Fully additive. v2.0.1 clients work against v2.0.2 servers unchanged. New normative requirements (§6.4 hash chain, §17.8 append-only log, §17.4 pinning, alg whitelist) all gate at Extended or higher; Core impls continue with the v2.0.1 surface they already had. Implementations claiming `Authorization-Required` SHOULD audit their compliance against the new §17.9 checks + §15.5 probe.

---

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
