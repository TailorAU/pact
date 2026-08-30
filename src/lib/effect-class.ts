/**
 * PACT v2.3 §25.5 effect classification + §25.6 fail-closed apply guard,
 * for the KG (Source) implementation (#5535, epic #5488 W6).
 *
 * ## What this module is
 *
 * §25 is a safety boundary: a protocol state (`consensus`, `stable`,
 * `locked`) is NEVER an electronic signature, legal assent, proof of a
 * person's authority, or authority to perform an external, irreversible
 * effect (§25.3). Silence, TTL expiry, absence of objection and agent votes
 * MUST NOT synthesise an `authorization_proof` (§25.4). Every resource type
 * MUST declare an effect class (§25.5), and an apply whose effect class is
 * `external-irreversible` — or whose type declares `human_attestation:
 * required` — MUST NOT proceed on the strength of any of those states
 * (§25.6).
 *
 * The KG had none of this before #5535: `consensus-gate.ts` promoted a topic
 * on quorum with no notion of what the apply does in the world.
 *
 * ## The ruling on the KG `fact` type (§25.5), and its evidence
 *
 * The audit (#5535) left the classification of KG fact promotion explicitly
 * open. It is ruled here as **`internal-reversible` / `not-required`** — the
 * same values the upstream registry records for the built-in `fact` type
 * (`TailorAU/pact` `spec/v2.3/resource-types.yaml`, whose `fact` entry names
 * Source as its reference implementation). The registry is a FLOOR, not a
 * ceiling: an implementation "that publishes verified facts to a third
 * party, a public register, or any surface it cannot retract MUST classify
 * that apply upward to `external-irreversible`". The KG does not, on two
 * pieces of evidence:
 *
 *  1. **The apply changes only state inside the implementation.** Promotion
 *     is `UPDATE topics SET status = 'consensus'` in the KG's own database
 *     (`db.ts` `updateConsensusStatuses` Phase 1). The Axiom API then serves
 *     that row to callers who **pull**; the KG pushes nothing to any surface
 *     it does not control, and holds no third-party or public-register
 *     write path.
 *  2. **The prior state is restorable by the implementation.** Phase 2 of
 *     the same sweep already demotes a promoted topic back to `open` when
 *     its alignment, quorum or dependency gate stops holding — the
 *     reversibility §25.5 asks for is not hypothetical here, it is the
 *     shipped behaviour of the engine.
 *
 * **Stated plainly, not papered over — two residual asymmetries.** Neither
 * changes the classification; both are real and are recorded rather than
 * hidden:
 *
 *  - A demotion restores the topic's status but does **not** claw back the
 *    internal credits `economy.ts` `distributeBounty` pays out of escrow on
 *    promotion. The credit ledger is internal to the KG (it buys Axiom API
 *    access; it is not money and does not leave the system), so the apply
 *    stays inside §25.5's `internal-reversible` definition — but the
 *    reversal is partial, and a compensating ledger entry does not exist.
 *  - A fact that was queryable while promoted may already have been read and
 *    acted on by a third party. That is true of every implementation with a
 *    public read API, and §25.5's test is whether the *implementation* can
 *    restore its own prior state — but a consumer's cache is not something
 *    the KG can retract.
 *
 * A separate, larger honesty gap sits next to this one and is filed as its
 * own requirement, **#5566**: the KG event store assigns no gapless
 * `sequenceNumber` and no `prev_hash`, so its event log is not third-party
 * verifiable under §6.4. This module does not close that and does not
 * pretend to; the KG's published conformance level must reflect it.
 *
 * ## Why the guard is a refusal here, not `AwaitingAttestation`
 *
 * §25.6 offers two routes for a guarded apply: (a) fail closed to
 * `AwaitingAttestation` and raise a §6.5 pending obligation of `kind: sign`
 * against each required principal, or (b) declare the effect out-of-band.
 * The KG can do **neither** for a guarded type: it has no §17.4
 * HumanPrincipal registry, no `authorization_proof` verification, and no
 * pending-obligation surface, so it cannot name a required principal or
 * accept a proof from one. §25.6 is explicit about what follows — *"A server
 * that cannot enforce the guard MUST NOT advertise the affected resource
 * type in its profile."*
 *
 * So the KG's posture is a **declaration, enforced**: it advertises only
 * `internal-reversible` / `not-required` types, and this module's guard is
 * the thing that makes the declaration load-bearing rather than a claim.
 * {@link resolveResourceType} is **fail-closed** (§25.5: *"If an
 * implementation cannot classify an effect, it MUST treat it as
 * `external-irreversible`. Unclassified is not internal."*), and every apply
 * path routes through {@link evaluateApplyGuard} before it promotes. Register
 * a guarded type, or drop `fact` from the registry, and promotion **stops**
 * — it does not silently continue.
 *
 * Everything here is pure (no DB, no clock, no I/O) so the boundary is
 * directly unit-testable; see `effect-class.test.ts`.
 */

/** §25.5 — what a resource type's apply semantics do in the world. */
export type EffectClass = "internal-reversible" | "external-irreversible";

/** §25.5 — whether the §25.6 guard applies to this type's apply. */
export type HumanAttestation = "required" | "not-required";

/** A §15.1 `resourceTypes[]` entry, carrying the two v2.3-mandatory fields. */
export interface ResourceTypeProfile {
  /** Registry type name (§14.3). */
  readonly type: string;
  /** §14.3 `field_schema`. */
  readonly fieldSchema: string;
  /** §15.1 `contentFormat`. */
  readonly contentFormat: string;
  /** §14.2 terminal states, in protocol vocabulary only (§25.3). */
  readonly terminalStates: readonly string[];
  /** §14.1 apply semantics, described as what happens in the world. */
  readonly applySemantics: string;
  /** §25.5 — MANDATORY from v2.3. */
  readonly effectClass: EffectClass;
  /** §25.5 — MANDATORY from v2.3. */
  readonly humanAttestation: HumanAttestation;
}

/**
 * Every resource type the KG advertises and can apply.
 *
 * One entry. The KG's consensus engine has exactly one apply — promoting a
 * topic (a knowledge claim) to a verified status — and that is the built-in
 * `fact` type. Adding an entry here is a conformance act: §25.6 forbids
 * advertising a type whose guard the server cannot enforce, and
 * {@link assertEveryAdvertisedTypeIsUnguarded} fails the build if a guarded
 * type is added while the KG still has no attestation pipeline.
 */
export const KG_RESOURCE_TYPES: readonly ResourceTypeProfile[] = [
  {
    type: "fact",
    fieldSchema: "claim:{id} — knowledge-claim identifier",
    contentFormat: "application/json",
    terminalStates: ["Verified", "Rejected"],
    applySemantics:
      "Knowledge claim promoted to a verified status in the KG's own graph, " +
      "served to callers who pull it from the Axiom API. Reversible from the " +
      "KG's own state: the consensus sweep demotes a promoted topic whose " +
      "alignment, quorum or dependency gate stops holding.",
    effectClass: "internal-reversible",
    humanAttestation: "not-required",
  },
];

/**
 * The resource type every KG apply path operates on. Named so the apply
 * sites in `db.ts` cannot drift onto a string literal the registry does not
 * know about — an unknown type resolves to the fail-closed default below and
 * stops the apply, which is the correct failure direction but a silent
 * behaviour change if it happens by typo.
 */
export const KG_APPLY_RESOURCE_TYPE = "fact";

/**
 * §25.5 fail-closed default. Returned for any type not in
 * {@link KG_RESOURCE_TYPES}. "Unclassified is not internal" — an
 * unrecognised type is treated as the most consequential thing it could be,
 * which means {@link evaluateApplyGuard} refuses its apply.
 */
export const UNCLASSIFIED_RESOURCE_TYPE: Omit<ResourceTypeProfile, "type"> = {
  fieldSchema: "unknown",
  contentFormat: "application/json",
  terminalStates: [],
  applySemantics:
    "Unclassified. §25.5 requires an implementation that cannot classify an " +
    "effect to treat it as external-irreversible.",
  effectClass: "external-irreversible",
  humanAttestation: "required",
};

/**
 * Resolve a type's §25.5 classification. Fail-closed for anything the
 * registry does not carry.
 */
export function resolveResourceType(type: string | null | undefined): ResourceTypeProfile {
  const key = typeof type === "string" ? type.trim() : "";
  const found = KG_RESOURCE_TYPES.find((t) => t.type === key);
  if (found) return found;
  return { type: key, ...UNCLASSIFIED_RESOURCE_TYPE };
}

/**
 * §25.6 — the guard is engaged when the effect class is
 * `external-irreversible` OR the type declares `human_attestation: required`.
 */
export function isGuarded(profile: Pick<ResourceTypeProfile, "effectClass" | "humanAttestation">): boolean {
  return profile.effectClass === "external-irreversible" || profile.humanAttestation === "required";
}

/** §25.9 — the registered `reason` values on `pact.apply.blocked`. */
export type ApplyBlockedReason =
  | "attestation_missing"
  | "attestation_invalid"
  | "scope_mismatch"
  | "payload_mismatch"
  | "principal_mismatch"
  | "authority_check_failed";

/** §25.9 — the event a refused guarded apply MUST emit. */
export const APPLY_BLOCKED_EVENT = "pact.apply.blocked";

/**
 * §25.9 — the event a RELEASED guarded apply emits. The KG never emits it:
 * it verifies no attestations, so it can never satisfy the six §25.7 checks.
 * Exported so the invariant "this string appears nowhere on an emit path"
 * is assertable rather than assumed.
 */
export const APPLY_ATTESTED_EVENT = "pact.apply.attested";

export interface ApplyGuardVerdict {
  /** True only when the apply may proceed. */
  readonly allowed: boolean;
  readonly effectClass: EffectClass;
  readonly humanAttestation: HumanAttestation;
  /** §25.9 reason code. Present iff `allowed` is false. */
  readonly reason?: ApplyBlockedReason;
  /**
   * §25.9 `required_principals[]`. Always empty for the KG: it has no §17.4
   * HumanPrincipal registry, so it cannot name a signer. Reported as empty
   * rather than omitted — the KG states the absence, it does not invent a
   * principal to fill the field (§25.4).
   */
  readonly requiredPrincipals: readonly string[];
  /** §25.9 `policy` — the §5 approval policy that would otherwise apply. */
  readonly policy: string;
}

/**
 * §25.6 — the fail-closed apply guard. Called immediately before every KG
 * apply (topic promotion), never after.
 *
 * The KG passes NO attestation, because it verifies none. A guarded type is
 * therefore always refused with `attestation_missing`: §25.7 check 1 says
 * absence is a refusal, not a warning, and §25.4 forbids substituting the
 * consensus state that made the apply eligible for the proof it lacks.
 *
 * Today `fact` is unguarded and this always allows. That is the point of a
 * declared posture being enforced rather than asserted — the day the
 * registry carries something else, the apply stops here.
 */
export function evaluateApplyGuard(input: {
  resourceType: string | null | undefined;
  /** The §5 approval policy the apply became eligible under. */
  policy: string;
}): ApplyGuardVerdict {
  const profile = resolveResourceType(input.resourceType);
  const base = {
    effectClass: profile.effectClass,
    humanAttestation: profile.humanAttestation,
    requiredPrincipals: [] as readonly string[],
    policy: input.policy,
  };
  if (!isGuarded(profile)) {
    return { allowed: true, ...base };
  }
  return { allowed: false, reason: "attestation_missing", ...base };
}

/**
 * §25.8 / §25.10 — vocabulary the KG MUST NOT use, in a positive sense, for
 * a state reached by consensus, silence, TTL expiry or an agent vote.
 *
 * The KG advertises no §25.8 execution capability (see
 * {@link EXECUTION_CAPABILITY}), so these labels are simply unavailable to
 * it: reaching consensus on a claim yields a verified claim, never a signed
 * or executed one.
 */
export const FORBIDDEN_EXECUTION_LABELS: readonly string[] = [
  "signed",
  "executed",
  "countersigned",
  "legally accepted",
];

/**
 * §15.1 / §25.8 `capabilities.executionCapability`. False, and it cannot
 * honestly be anything else: the KG captures no intentional act of execution
 * by any signer, separate from and additional to its protocol state, and
 * names no execution system. §25.8 requires all four of its conditions
 * before a surface may say `signed`.
 */
export const EXECUTION_CAPABILITY = false;

/**
 * §15.1 / §25.6 `capabilities.applyGuard`. True: {@link evaluateApplyGuard}
 * runs on every apply path in `db.ts`, is fail-closed for an unclassified
 * type, and cannot be bypassed by an approval policy.
 */
export const APPLY_GUARD_ENFORCED = true;

/**
 * §15.1 `capabilities.authorizationProof`. False: the KG verifies no §17.6
 * proof. Stated so the profile cannot advertise a capability the engine
 * does not have.
 */
export const AUTHORIZATION_PROOF_SUPPORTED = false;

/**
 * §25.6 invariant, callable from a test: the KG may advertise a resource
 * type ONLY while it can enforce that type's guard. It cannot enforce a
 * guarded type at all (no principal registry, no proof verification, no
 * pending-obligation surface), so every advertised type must be unguarded.
 *
 * Returns the offending types; empty means the invariant holds.
 */
export function guardedAdvertisedTypes(): readonly string[] {
  return KG_RESOURCE_TYPES.filter(isGuarded).map((t) => t.type);
}
