/**
 * The KG's response envelope.
 *
 * ## `attestation_ref` is a real field, not a placeholder (#5535)
 *
 * This module shipped in #1314 with `attestation_ref` typed as the literal
 * `null` and a comment promising a later phase would "populate them as part
 * of the cross-Fabric attestation work". A field whose *type* is `null`
 * cannot ever carry a value, so it was a stand-in for a real field rather
 * than a real one — the #5535 audit named it as such.
 *
 * It is now typed for the value it can carry, and its `null` means one
 * specific, normative thing under PACT v2.3 §25.4:
 *
 * > A message that carries no `authorization_proof` is a message with no
 * > human attestation. Implementations MUST record the absence as absence.
 *
 * The KG verifies no §17.6 `authorization_proof` today, so every response it
 * serves genuinely has no attestation and `attestation_ref` is genuinely
 * `null`. That is the honest report, not a default awaiting a later phase:
 * §25.4 forbids synthesising a proof out of a consensus state, a vote, a TTL
 * expiry or an absence of objection, so the KG's consensus engine can never
 * fill this field from anything it currently knows. It becomes non-null only
 * if the KG grows real proof verification — and until then, saying `null`
 * IS the correct answer.
 *
 * `actor_kind` and `actor_org_context` remain unpopulated substrate and are
 * typed as such.
 */

/**
 * A reference to a VERIFIED §17.6 `authorization_proof`. Never synthesised:
 * a value here asserts that a HumanPrincipal deliberately authorized this
 * exact message and that the implementation checked the signature (§25.7).
 */
export interface AttestationRef {
  /** Identifier of the stored, verified proof. */
  readonly proofId: string;
  /** The §17.4 HumanPrincipal that signed. */
  readonly principalId: string;
  /** When verification succeeded (ISO 8601, UTC). */
  readonly verifiedAt: string;
}

export interface SourceResponseEnvelope<T> {
  data: T;
  /**
   * §25.4 — the verified attestation covering this response, or `null` when
   * there is none. `null` is a statement of absence, never a placeholder.
   */
  attestation_ref: AttestationRef | null;
  actor_kind: null;
  actor_org_context: null;
}

/**
 * Wrap a payload in the KG response envelope.
 *
 * `attestation` is omitted by every current caller because the KG verifies
 * no proofs; the parameter exists so a caller that one day HAS a verified
 * proof passes it, rather than the envelope inventing one. There is
 * deliberately no code path that derives an attestation from protocol state
 * (§25.4).
 */
export function wrap<T>(data: T, attestation: AttestationRef | null = null): SourceResponseEnvelope<T> {
    return {
        data,
        attestation_ref: attestation,
        actor_kind: null,
        actor_org_context: null,
    };
}
