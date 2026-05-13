# PACT v2.0 §17–§18 — normative draft (proposal)

> **Status:** Proposal, not yet landed. This is the PACT-lead draft of the normative
> text for §17 (HumanPrincipal) and §18 (Attestation Format Reference). Per
> [AGENTS.md](../../AGENTS.md) rule 5, it does **not** go into `spec/v2.0/SPECIFICATION.md`
> until a coordinated PR with HMAN / tailor-app reconciles it against the upstream
> `tailor-app/docs/architecture/PACT_SPECIFICATION.md`. When that happens, this file
> is the source — review, reconcile, land, delete this file.
>
> **Decisions baked in:** #4 → strictly 1:1; #3 → `voice-biometric` is a v2.0 first-class
> type alongside `fido2-assertion`; D4 → `Authorization-Required` is a normative tier;
> D6 → principal identity uses W3C DIDs, with `did:web` and `did:key` REQUIRED.
>
> **Explicitly deferred to the coordinated PR (do not freelance):** exact signature
> suites and parameters for each attestation type; the full `voice-biometric` mechanics
> and test vectors (HMAN's #3 PR is authoritative there); the HMAN reference-stack
> citation; trust-decay rules for delegation chains.

---

## 17. HumanPrincipal

> **Status:** v2.0 normative.

### 17.1 Concept

A **HumanPrincipal** is the protocol-level abstraction for actions a human has authorized. A HumanPrincipal is **strictly 1:1 with a single human**: each human maps to exactly one `principal_id` at the PACT layer. There is no protocol mechanism for one principal to represent multiple humans, nor for a verifier to be asked to treat two principals as "the same human."

The `principal_id` is a [W3C Decentralized Identifier](https://www.w3.org/TR/did-core/). Implementations MUST support the `did:web` and `did:key` methods. Implementations MAY support additional DID methods (e.g. `did:ion`, `did:ethr`); a verifier that does not recognise a presented method MUST treat the proof as unverifiable (reject; see §17.4).

### 17.2 The `persona` claim (above the PACT layer)

Some deployments give one human several operating "personas" (e.g. `Personal`, `Trade`, `Household`). PACT does not model these. An implementation MAY attach an advisory `persona` claim to a signed message; it is **purely informational metadata** for the receiving agent. A verifier:

- MUST roll every persona up to the single `principal_id` it accompanies — distinct personas are NOT distinct principals;
- MUST NOT use the `persona` value in any access-control, trust, or identity decision;
- MAY surface it to a human operator for context.

Entity/role disambiguation is the implementation's responsibility, not the protocol's. (Reference downstream: HMAN's multi-entity model sits above PACT in exactly this way.)

### 17.3 `authorization_proof` envelope

Any PACT message (proposal, intent, constraint, completion, mediated message, session mandate) MAY carry an `authorization_proof`:

```json
{
  "authorization_proof": {
    "type": "fido2-assertion",
    "principal_id": "did:web:knox.example",
    "credential_id": "cred_abc123",
    "challenge_nonce": "base64url-...",
    "asserted_at": "2026-05-13T10:30:00Z",
    "signature": "base64url-...",
    "attestation_chain": []
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | Attestation type — `fido2-assertion`, `voice-biometric`, or a custom type in reverse-domain notation (§18.5). |
| `principal_id` | string (DID) | Yes | The HumanPrincipal that authorized this action. |
| `credential_id` | string | Yes | Identifier of the enrolled credential that produced the signature. |
| `challenge_nonce` | string | Yes | Verifier-issued challenge. MUST be either signed by the verifier's key OR carry a `verifier_id` claim — otherwise a proof captured for verifier A can be replayed at verifier B. |
| `asserted_at` | string (ISO 8601) | Yes | When the human authorization was captured. |
| `signature` | string | Yes | Signature over the message payload + `challenge_nonce` + `asserted_at`, per the `type`'s suite. |
| `attestation_chain` | array | No | Ordered intermediate attestations for delegated authorization (§17.8). Empty or absent = direct. |

### 17.4 Verification flow

On receiving a message bearing `authorization_proof`, a verifying party MUST:

1. **Type dispatch** — select the verification procedure for `type` (§18). Unrecognised `type` → unverifiable.
2. **Principal resolution** — resolve `principal_id` (DID resolution, or `/.well-known/pact-credentials.json`; §17.5). Resolution failure → unverifiable.
3. **Signature verification** — verify `signature` against the public key enrolled for `credential_id` under `principal_id`, per the `type`'s suite.
4. **Freshness** — `asserted_at` MUST be within the implementation's allowed clock skew (default ±5 minutes; configurable).
5. **Replay** — `challenge_nonce` MUST match a challenge the verifier (or its server) issued and not yet retired, OR be a verifier-signed nonce / carry a matching `verifier_id`.
6. **Result** — any failure → the verifier SHOULD reject the message and MAY emit `pact.trust.violation` with `payloadJson.kind = "authorization_failed"` and the failing step. Success → the message is treated as human-authorized by `principal_id`.

Verifiers MAY cache a successful resolution for the life of a session to avoid repeated registry/DID lookups; they MUST honour revocation (§17.5) within the cache's max-age hint.

### 17.5 Credential registry

A PACT server MAY publish `/.well-known/pact-credentials.json`:

```json
{
  "version": "1.0",
  "principals": [
    {
      "id": "did:web:knox.example",
      "display_name": "Knox Hart",
      "credentials": [
        { "id": "cred_abc123", "type": "fido2-assertion", "public_key": "base64url-...", "enrolled_at": "2026-01-01T00:00:00Z", "revoked": false }
      ]
    }
  ]
}
```

- A server MAY instead (or also) support DID-document resolution for the public keys.
- `"revoked": true` MUST cause verification to fail.
- Implementations SHOULD support rotation — multiple active credentials per principal.
- The registry MUST be served over HTTPS in production; the server MAY require mTLS or a bearer token to read it.
- A `Cache-Control: max-age` (or equivalent) hint bounds how stale a cached resolution may be; absent a hint, implementations SHOULD re-check at least every 5 minutes.

### 17.6 Conformance

| Level | Requirement |
|---|---|
| **Core** | `authorization_proof` is OPTIONAL — an implementation MAY ignore the field entirely. |
| **Extended** | SHOULD support at least one attestation type from §18 and SHOULD run the §17.4 verification when a proof is present. |
| **Authorization-Required** | MUST require a valid `authorization_proof` on every cross-organisation message; MUST reject any proof whose `principal_id` resolution implies the principal spans more than one human; MUST support the credential registry (or DID resolution) and revocation propagation. No implementation is required to claim this tier at v2.0 launch — it is defined so the protocol's trajectory is clear and so cross-org / regulated deployments have a target. |

An implementation MAY require `authorization_proof` for specific operations regardless of its declared tier (e.g. financial transactions, high-trust-level actions).

### 17.7 Personal data (GDPR / right-to-be-forgotten)

PACT's position:

- **Event-log entries are protocol-integrity records** — they are retained for as long as the resource's audit trail is retained, and are not subject to erasure-on-request, because removing them breaks the event-sourced consistency guarantee. To keep them from becoming surveillance artifacts, an `authorization_proof` recorded in the event log SHOULD carry only the `principal_id` (a DID — itself rotatable/revocable) and a salted hash of the proof payload, NOT raw biometric data or other PII. Raw biometric material MUST NOT appear in the event log under any circumstance (see §18.3).
- **Credential-registry entries** are personal data and support erasure: a human's withdrawal is effected by **cryptographic erasure** — destroying/revoking the credential keys — leaving a tombstone (`{"id": "...", "tombstoned_at": "...", "credentials": []}`) so prior proofs remain *checkable as having-been-valid-then-revoked* without the key material persisting.

(This is the v2.0 stance; if a downstream legal review requires stricter handling, raise it before v2.0 freeze.)

### 17.8 Delegation

`attestation_chain` carries an ordered list of intermediate attestations: a chain `[A0, A1, ...]` means principal at `A0` authorized the next, and so on, to the message signer. Maximum chain length is **3 hops** (direct + 2 sub-delegations) at v2.0 — a starting point pending implementation feedback; longer chains amplify revocation lag and reduce auditability. Trust-decay rules along the chain (does a revoked `A0` invalidate `A1..n` immediately, or do they stand until their own expiry?) are **deferred to the coordinated PR** — candidate model: mirror X.509 OCSP/CRL.

### 17.9 Deferred to the coordinated HMAN / tailor-app PR

- Exact signature suites and parameters per attestation type (§18 stubs them).
- The full `voice-biometric` mechanics, embedding-algorithm pinning, and test vectors — HMAN's #3 PR is authoritative.
- Trust-decay rules for delegation chains (§17.8).
- Whether custom attestation types require pre-registration vs. naming-convention only.

---

## 18. Attestation Format Reference

> **Status:** v2.0 normative. Defines the credential types a PACT verifier MAY accept as proof of a HumanPrincipal's authorization. v2.0 defines **two** first-class types; implementations MAY support additional custom types.

### 18.1 Common envelope

Every attestation, whatever its `type`, uses the `authorization_proof` envelope of §17.3 and additionally carries:

| Field | Required | Description |
|---|---|---|
| `alg` | Yes | Algorithm identifier for this attestation's signature/match (e.g. `"webauthn-es256"`, `"resemblyzer-v1"`). |
| `alg_version` | Yes | Version of `alg` — model swaps / retrains MUST NOT silently invalidate enrolled references. |

`challenge_nonce` replay protection (§17.3) is mandatory for all types.

### 18.2 `fido2-assertion`

**Based on:** [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/) / FIDO2.

The human activates a FIDO2 authenticator (security key, platform authenticator, phone). The authenticator signs over the PACT message hash + `challenge_nonce`. The proof carries the WebAuthn `authenticatorData`, `clientDataJSON`, and `signature`.

**Verification:** standard WebAuthn assertion verification — verify the signature against the enrolled public key for `credential_id`; verify the relying-party ID; confirm the User Presence (UP) flag, and the User Verification (UV) flag if the operation requires it.

**Use when:** high-security and cross-organisation actions; financial transactions. Preferred when both parties have hardware-authenticator infrastructure.

### 18.3 `voice-biometric`

> **Authoritative spec:** HMAN's [#3](https://github.com/TailorAU/pact/issues/3) PR. The text below is the structural contract v2.0 commits to; the cryptographic detail and test vectors land via that PR.

**Based on:** speaker-verification embedding similarity + utterance-hash binding.

**Distinguishing property:** captures *intent* (the human spoke a specific challenge utterance), not just *presence* (a passkey tap).

**Envelope additions:**

```json
"match": { "alg": "resemblyzer-v1", "alg_version": "1.0", "score": 0.91, "threshold": 0.75 },
"utterance_hash": "base64url-...",
"verifier_id": "did:web:bridget.example"
```

- `match` — the speaker-verification result. The `match` sub-object shape is reused by any future biometric modality (face, gait, keystroke dynamics).
- `utterance_hash` — **normative**. A hash of the spoken utterance, binding the assertion to *what was said*. Non-normative note: the *content* matters at the application layer — a verifier requiring "approve transfer of $5000 to Bridget" MUST reject a valid voice match against the wrong `utterance_hash`.
- `challenge_nonce` MUST be verifier-signed OR `verifier_id` MUST be present (replay protection across verifiers).

**Hard constraint:** raw audio MUST NOT leave the verifying device. Only the embedding score (inside `match`), the `utterance_hash`, and the signed assertion cross the wire. No raw biometric data enters the event log (see §17.7).

**Reference embedding algorithm:** `resemblyzer-v1` (non-normative; the #3 PR pins the normative set and versioning policy).

**Use when:** real-time intent-bearing authorization on voice channels (calls, dictation, multi-party negotiation) where presence-only credentials are insufficient.

### 18.4 Combining types

A high-stakes operation MAY require two attestation types presented together (e.g. `fido2-assertion` for possession + `voice-biometric` for intent). When required, both proofs MUST verify independently and MUST carry the same `principal_id`.

### 18.5 Custom attestation types

Implementations MAY define custom types using reverse-domain notation (e.g. `com.example.voice-print`, `au.gov.mygovid`). A custom type MUST:

- use the `authorization_proof` envelope of §17.3 plus the common fields of §18.1;
- document its signing and verification mechanics;
- be declared in the implementation's `/.well-known/pact-credentials.json` under a `supported_types` array.

Whether custom types additionally require pre-registration in a central registry is **deferred to the coordinated PR** (current lean: naming-convention only, no pre-registration).

### 18.6 Deferred to HMAN's #3 PR

- `voice-biometric` normative crypto: signature suite, key wrapping, the normative set of embedding algorithms + versioning policy, threshold-selection guidance, full replay-protection requirements.
- Test vectors for `voice-biometric` (and `fido2-assertion`) — go in `spec/v2.0/conformance/extended/attestation/`.
- The HMAN reference-stack citation (Resemblyzer + Fernet + PBKDF2 + per-session re-arm + hash-chained audit), conditional on the test vectors landing.

---

*Drafted 2026-05-13 by the PACT lead as a phase-0 (T1 + T2) deliverable. Lands in `spec/v2.0/SPECIFICATION.md` via a coordinated PR with HMAN / tailor-app per AGENTS.md rule 5 — at which point this file is deleted.*
