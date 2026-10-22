/**
 * §25.3 / §25.4 / §25.8 protocol vocabulary for the KG's wire surfaces
 * (#5535, epic #5488 W6).
 *
 * ## Why this module exists
 *
 * `effect-class.ts` rules the KG's effect classification and enforces the
 * §25.6 apply guard, but until #5535's surface pass none of that reached the
 * wire: `grep effect_class|attested|execution_state` over `src/app` returned
 * nothing, and the two internal-reversible execution-boundary vectors were
 * unsatisfiable — the fields they match on did not exist on any response.
 *
 * This module is the single place the wire vocabulary is DERIVED. Every
 * value is computed from the module that enforces it — the §25 flags from
 * `effect-class.ts`, the verified set from `consensus-gate.ts` — never
 * retyped, the same discipline `pact-profile.ts` follows for the discovery
 * document. Routes spread these blocks additively (#5564 grandfathering:
 * nothing pre-existing is renamed, removed or re-typed, and every field here
 * is derivable for every pre-existing row — no backfill, no null-500s).
 *
 * ## The §25 invariants this vocabulary states
 *
 *  - **§25.4** — silence, TTL expiry and votes create no attestation. The KG
 *    verifies no §17.6 proof at all (`AUTHORIZATION_PROOF_SUPPORTED` is
 *    `false`), so every surface reports `attested: false`,
 *    `authorization_proof: null` and empty attestation collections. Stated,
 *    not elided: an absent field reads as "unknown", and unknown is where a
 *    generous inference goes.
 *  - **§25.3** — `merged_by` is never a principal for a merge nobody signed.
 *    A TTL auto-merge is attributed to `protocol-timeout` (a timeout is not
 *    a person); a vote-quorum merge to `approval-quorum` (a quorum is not a
 *    person either — the individual votes are already on the event log).
 *  - **§25.8** — the KG advertises no execution capability
 *    (`EXECUTION_CAPABILITY` is `false`), so the execution labels the spec
 *    forbids (FORBIDDEN_EXECUTION_LABELS in effect-class.ts) are
 *    unavailable to it on every surface: the strongest execution state a
 *    converged topic can carry is `unexecuted`, a merely-merged one `none`,
 *    and `document_state` speaks protocol vocabulary (`draft` / `merged`).
 *  - **§25.11** — `legal_status` is `null`, always: whether anyone is BOUND
 *    by a converged claim is a question about signatures, capacity and law
 *    that PACT does not answer and must not appear to answer.
 *
 * Everything here is pure (no DB, no clock, no I/O) — see
 * `protocol-surface.test.ts`, and `execution-boundary-vectors.itest.ts` for
 * the two vectors driven through the real routes that serve these blocks.
 */

import {
  AUTHORIZATION_PROOF_SUPPORTED,
  EXECUTION_CAPABILITY,
  KG_TOPIC_RESOURCE_TYPE,
  resolveResourceType,
} from "./effect-class";
import { VERIFIED_TOPIC_STATUSES } from "./consensus-gate";

/** §5 proposal lifecycle states, in protocol vocabulary. */
export type ProposalProtocolStatus =
  | "open"
  | "merged"
  | "auto-merged"
  | "rejected"
  | "challenge";

/** §25.8 — the only execution states an EXECUTION_CAPABILITY: false server may report. */
export type ExecutionState = "none" | "unexecuted";

/** §25.3 — merge attribution that never names a person for an unsigned merge. */
export type MergedBy = "protocol-timeout" | "approval-quorum" | null;

/**
 * How a merged proposal got merged, read from the event log. `null` when the
 * events are gone (pre-#5566 rows purged by retention) — the absence is
 * served as absence, never reconstructed.
 */
export type MergeProvenance = "auto" | "votes" | null;

/**
 * Map a KG proposal row status (+ its merge provenance) to the §5 protocol
 * state the wire serves. The internal `status` column is untouched (#5564);
 * this is the protocol rendering of it.
 *
 * An unrecognised internal status is served AS-IS rather than guessed at —
 * grandfathered rows keep whatever they carry.
 */
export function proposalProtocolStatus(
  kgStatus: string,
  provenance: MergeProvenance
): ProposalProtocolStatus | string {
  switch (kgStatus) {
    case "pending":
      return "open";
    case "merged":
      return provenance === "auto" ? "auto-merged" : "merged";
    case "rejected":
      return "rejected";
    case "challenge":
      return "challenge";
    default:
      return kgStatus;
  }
}

/**
 * §25.3 merge attribution. Only a merged proposal carries one; the value is
 * never a principal id. A merged row whose merge events were purged serves
 * `null` — the KG states what it no longer knows rather than inventing an
 * attribution (§25.4).
 */
export function mergedByFor(kgStatus: string, provenance: MergeProvenance): MergedBy {
  if (kgStatus !== "merged") return null;
  if (provenance === "auto") return "protocol-timeout";
  if (provenance === "votes") return "approval-quorum";
  return null;
}

/**
 * §25.8 execution state. `EXECUTION_CAPABILITY` is `false` and cannot
 * honestly be otherwise (see effect-class.ts): the KG captures no
 * intentional act of execution by any signer, so no state past `unexecuted`
 * is reachable. A converged (consensus-reached) resource is explicitly
 * `unexecuted` — consumers must not default-assume execution — and a
 * resource that has not converged has no execution question at all: `none`.
 */
export function executionStateFor(consensusReached: boolean): ExecutionState {
  // The day EXECUTION_CAPABILITY flips true, this derivation is the seam a
  // real execution state machine replaces; until then the constant keeps the
  // two values below the only reachable ones.
  if (EXECUTION_CAPABILITY) {
    throw new Error(
      "§25.8: executionStateFor predates any execution capability — teach it the real states before advertising one"
    );
  }
  return consensusReached ? "unexecuted" : "none";
}

/** §25.3 / §25.8 — protocol document state: a merged draft is `merged`, never more. */
export function documentStateFor(mergedProposalCount: number): "draft" | "merged" {
  return mergedProposalCount > 0 ? "merged" : "draft";
}

/** Whether a KG topic status is in the verified (consensus-reached) set. */
export function consensusReachedFor(topicStatus: string | null | undefined): boolean {
  return (VERIFIED_TOPIC_STATUSES as readonly string[]).includes(String(topicStatus ?? ""));
}

/**
 * §5 lifecycle phase, in protocol vocabulary. Only `converged` is
 * load-bearing (the consensus-contract vector pins it); the rest are honest
 * renderings of the KG's pre-convergence statuses.
 */
export function topicPhaseFor(topicStatus: string | null | undefined): string {
  if (consensusReachedFor(topicStatus)) return "converged";
  if (topicStatus === "proposed") return "proposed";
  if (topicStatus === "rejected") return "rejected";
  if (topicStatus === "challenged") return "contested";
  return "negotiating";
}

/**
 * §25.4 attestation-absence block for a proposal surface. `attested` is the
 * live `AUTHORIZATION_PROOF_SUPPORTED` constant, not a literal `false` — the
 * KG verifies no proof, so no response may claim otherwise, and flipping the
 * capability moves this wire field with it.
 */
export function attestationAbsence(): {
  attested: boolean;
  authorization_proof: null;
  attestations: readonly never[];
  signature_records: readonly never[];
} {
  return {
    attested: AUTHORIZATION_PROOF_SUPPORTED,
    authorization_proof: null,
    attestations: [],
    signature_records: [],
  };
}

/**
 * §25.8 signature-absence block for a status/export surface. Empty by
 * construction — `EXECUTION_CAPABILITY` is `false`, so no signature record
 * or signer evidence can exist — and served rather than omitted, because the
 * vectors' negative obligations require the absence to be REPORTED.
 */
export function executionAbsence(): {
  signature_records: readonly never[];
  signers: readonly never[];
} {
  return { signature_records: [], signers: [] };
}

/**
 * The §25.5 classification of the KG's wire resource (the topic document the
 * proposal path merges into), resolved through the SAME resolver the §25.6
 * apply guard calls — never copied off a registry entry.
 */
export function topicEffectClassification(): {
  effect_class: string;
  human_attestation: string;
} {
  const resolved = resolveResourceType(KG_TOPIC_RESOURCE_TYPE);
  return {
    effect_class: resolved.effectClass,
    human_attestation: resolved.humanAttestation,
  };
}
