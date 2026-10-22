/**
 * #5535 — unit pins for the §25 wire vocabulary module. The derivations are
 * pure; the two internal-reversible execution-boundary vectors exercise them
 * through the real routes in execution-boundary-vectors.itest.ts.
 */
import { describe, it, expect } from "vitest";
import {
  attestationAbsence,
  consensusReachedFor,
  documentStateFor,
  executionAbsence,
  executionStateFor,
  mergedByFor,
  proposalProtocolStatus,
  topicEffectClassification,
  topicPhaseFor,
} from "./protocol-surface";
import {
  AUTHORIZATION_PROOF_SUPPORTED,
  EXECUTION_CAPABILITY,
  KG_TOPIC_RESOURCE_TYPE,
  resolveResourceType,
} from "./effect-class";
import { VERIFIED_TOPIC_STATUSES } from "./consensus-gate";

describe("proposalProtocolStatus — §5 rendering over the untouched internal column", () => {
  it("maps the KG lifecycle into protocol vocabulary", () => {
    expect(proposalProtocolStatus("pending", null)).toBe("open");
    expect(proposalProtocolStatus("merged", "auto")).toBe("auto-merged");
    expect(proposalProtocolStatus("merged", "votes")).toBe("merged");
    expect(proposalProtocolStatus("rejected", null)).toBe("rejected");
    expect(proposalProtocolStatus("challenge", null)).toBe("challenge");
  });

  it("a merged row with purged merge events stays 'merged' — absence is not reconstructed", () => {
    expect(proposalProtocolStatus("merged", null)).toBe("merged");
  });

  it("an unrecognised internal status is served as-is, never guessed at", () => {
    expect(proposalProtocolStatus("grandfathered-status", null)).toBe("grandfathered-status");
  });
});

describe("mergedByFor — §25.3: never a principal for an unsigned merge", () => {
  it("a TTL auto-merge is attributed to protocol-timeout — a timeout is not a person", () => {
    expect(mergedByFor("merged", "auto")).toBe("protocol-timeout");
  });

  it("a vote-quorum merge is attributed to approval-quorum — a quorum is not a person either", () => {
    expect(mergedByFor("merged", "votes")).toBe("approval-quorum");
  });

  it("states null where the provenance is gone or the merge has not happened", () => {
    expect(mergedByFor("merged", null)).toBeNull();
    expect(mergedByFor("pending", null)).toBeNull();
    expect(mergedByFor("rejected", "auto")).toBeNull();
  });
});

describe("executionStateFor — §25.8 under EXECUTION_CAPABILITY: false", () => {
  it("is derived under the live constant, which is false", () => {
    expect(EXECUTION_CAPABILITY).toBe(false);
  });

  it("a converged resource is explicitly unexecuted — consumers must not default-assume execution", () => {
    expect(executionStateFor(true)).toBe("unexecuted");
  });

  it("a resource that has not converged has no execution question: none", () => {
    expect(executionStateFor(false)).toBe("none");
  });
});

describe("document + phase + consensus vocabulary", () => {
  it("documentStateFor: a merged draft is 'merged', never more; nothing merged is 'draft'", () => {
    expect(documentStateFor(0)).toBe("draft");
    expect(documentStateFor(1)).toBe("merged");
    expect(documentStateFor(7)).toBe("merged");
  });

  it("consensusReachedFor tracks VERIFIED_TOPIC_STATUSES exactly", () => {
    for (const status of VERIFIED_TOPIC_STATUSES) {
      expect(consensusReachedFor(status), status).toBe(true);
    }
    for (const status of ["open", "proposed", "challenged", "rejected", null, undefined, ""]) {
      expect(consensusReachedFor(status), String(status)).toBe(false);
    }
  });

  it("topicPhaseFor: every verified status is 'converged'; pre-convergence statuses are honest", () => {
    for (const status of VERIFIED_TOPIC_STATUSES) {
      expect(topicPhaseFor(status), status).toBe("converged");
    }
    expect(topicPhaseFor("proposed")).toBe("proposed");
    expect(topicPhaseFor("rejected")).toBe("rejected");
    expect(topicPhaseFor("challenged")).toBe("contested");
    expect(topicPhaseFor("open")).toBe("negotiating");
  });
});

describe("absence blocks — §25.4 stated, not elided", () => {
  it("attestationAbsence serves attested from the live capability constant", () => {
    const absence = attestationAbsence();
    expect(AUTHORIZATION_PROOF_SUPPORTED).toBe(false);
    expect(absence.attested).toBe(AUTHORIZATION_PROOF_SUPPORTED);
    expect(absence.authorization_proof).toBeNull();
    expect(absence.attestations).toEqual([]);
    expect(absence.signature_records).toEqual([]);
  });

  it("executionAbsence reports the empty collections the vectors' negative obligations probe", () => {
    expect(executionAbsence()).toEqual({ signature_records: [], signers: [] });
  });

  it("returns fresh objects — a served response can never alias module state", () => {
    expect(attestationAbsence()).not.toBe(attestationAbsence());
    const one = executionAbsence();
    expect(one.signature_records).not.toBe(executionAbsence().signature_records);
  });
});

describe("topicEffectClassification — resolved through the §25.6 guard's own resolver", () => {
  it("matches resolveResourceType for the topic wire type, value for value", () => {
    const resolved = resolveResourceType(KG_TOPIC_RESOURCE_TYPE);
    expect(topicEffectClassification()).toEqual({
      effect_class: resolved.effectClass,
      human_attestation: resolved.humanAttestation,
    });
  });

  it("which today is internal-reversible / not-required — the #5535 ruling", () => {
    expect(topicEffectClassification()).toEqual({
      effect_class: "internal-reversible",
      human_attestation: "not-required",
    });
  });
});
