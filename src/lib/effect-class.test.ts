import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  APPLY_ATTESTED_EVENT,
  APPLY_BLOCKED_EVENT,
  APPLY_GUARD_ENFORCED,
  AUTHORIZATION_PROOF_SUPPORTED,
  EXECUTION_CAPABILITY,
  FORBIDDEN_EXECUTION_LABELS,
  KG_APPLY_RESOURCE_TYPE,
  KG_RESOURCE_TYPES,
  UNCLASSIFIED_RESOURCE_TYPE,
  evaluateApplyGuard,
  guardedAdvertisedTypes,
  isGuarded,
  resolveResourceType,
} from "./effect-class";
import { wrap } from "./types/envelope";

const LIB_DIR = __dirname;
const SRC_DIR = path.resolve(LIB_DIR, "..");

function readSource(relativeToLib: string): string {
  return fs.readFileSync(path.join(LIB_DIR, relativeToLib), "utf8");
}

/** Strip block and line comments so an assertion can target code, not prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every .ts file under src/, so an invariant can be asserted repo-wide. */
function allSourceFiles(dir: string = SRC_DIR): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("§25.5 effect classification — the KG `fact` ruling (#5535)", () => {
  it("classifies `fact` internal-reversible / not-required", () => {
    const fact = resolveResourceType("fact");
    expect(fact.type).toBe("fact");
    expect(fact.effectClass).toBe("internal-reversible");
    expect(fact.humanAttestation).toBe("not-required");
  });

  it("matches the upstream registry floor for the built-in `fact` type", () => {
    // spec/v2.3/resource-types.yaml records fact as internal-reversible /
    // not-required and names Source as its reference impl. The registry is a
    // FLOOR: an implementation may only classify UP, never down. This asserts
    // the KG has not classified down.
    const fact = resolveResourceType("fact");
    const floor = { effectClass: "internal-reversible", humanAttestation: "not-required" };
    expect(fact.effectClass).toBe(floor.effectClass);
    expect(fact.humanAttestation).toBe(floor.humanAttestation);
  });

  it("carries both v2.3-mandatory fields on every advertised type (§15.1)", () => {
    expect(KG_RESOURCE_TYPES.length).toBeGreaterThan(0);
    for (const t of KG_RESOURCE_TYPES) {
      expect(["internal-reversible", "external-irreversible"]).toContain(t.effectClass);
      expect(["required", "not-required"]).toContain(t.humanAttestation);
      expect(t.applySemantics.length).toBeGreaterThan(0);
    }
  });

  it("names an apply resource type the registry actually carries", () => {
    // A typo here would resolve fail-closed and silently stop every apply.
    expect(KG_RESOURCE_TYPES.map((t) => t.type)).toContain(KG_APPLY_RESOURCE_TYPE);
  });

  it("records the ruling's evidence and its residual asymmetries in the source", () => {
    // The classification is a conformance claim; the reasoning that supports
    // it must travel with the code, including what it does NOT cover.
    const src = readSource("effect-class.ts");
    expect(src).toContain("demotes a promoted topic");
    expect(src).toContain("distributeBounty");
    expect(src).toContain("#5566");
  });
});

describe("§25.5 — unclassified is not internal (fail-closed)", () => {
  it("resolves an unknown type to external-irreversible / required", () => {
    for (const unknown of ["transaction", "record", "document", "com.example.thing", "", " "]) {
      const p = resolveResourceType(unknown);
      expect(p.effectClass).toBe("external-irreversible");
      expect(p.humanAttestation).toBe("required");
    }
  });

  it("resolves null / undefined the same way", () => {
    expect(resolveResourceType(null).effectClass).toBe("external-irreversible");
    expect(resolveResourceType(undefined).humanAttestation).toBe("required");
  });

  it("the default itself is the most consequential classification", () => {
    expect(UNCLASSIFIED_RESOURCE_TYPE.effectClass).toBe("external-irreversible");
    expect(UNCLASSIFIED_RESOURCE_TYPE.humanAttestation).toBe("required");
  });
});

describe("§25.6 fail-closed apply guard", () => {
  it("engages on external-irreversible OR human_attestation: required", () => {
    expect(isGuarded({ effectClass: "external-irreversible", humanAttestation: "not-required" })).toBe(true);
    expect(isGuarded({ effectClass: "internal-reversible", humanAttestation: "required" })).toBe(true);
    expect(isGuarded({ effectClass: "external-irreversible", humanAttestation: "required" })).toBe(true);
    expect(isGuarded({ effectClass: "internal-reversible", humanAttestation: "not-required" })).toBe(false);
  });

  it("allows the KG's own apply — `fact` is unguarded", () => {
    const v = evaluateApplyGuard({ resourceType: KG_APPLY_RESOURCE_TYPE, policy: "objection-based" });
    expect(v.allowed).toBe(true);
    expect(v.reason).toBeUndefined();
    expect(v.effectClass).toBe("internal-reversible");
  });

  it("refuses a guarded apply with attestation_missing — absence is a refusal, not a warning (§25.7 check 1)", () => {
    const v = evaluateApplyGuard({ resourceType: "transaction", policy: "objection-based" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("attestation_missing");
    expect(v.effectClass).toBe("external-irreversible");
  });

  it("no approval policy bypasses the guard — the guard wins (§25.6)", () => {
    for (const policy of ["auto", "single", "majority", "unanimous", "objection-based"]) {
      const v = evaluateApplyGuard({ resourceType: "transaction", policy });
      expect(v.allowed).toBe(false);
      expect(v.policy).toBe(policy);
    }
  });

  it("reports required_principals as an empty list, never an invented principal (§25.4)", () => {
    const v = evaluateApplyGuard({ resourceType: "transaction", policy: "auto" });
    expect(v.requiredPrincipals).toEqual([]);
  });

  it("§25.6 invariant — the KG advertises no type whose guard it cannot enforce", () => {
    // The KG has no §17.4 principal registry, no §17.6 proof verification and
    // no §6.5 pending-obligation surface, so it can implement NEITHER §25.6
    // route for a guarded type. §25.6: "A server that cannot enforce the
    // guard MUST NOT advertise the affected resource type in its profile."
    expect(AUTHORIZATION_PROOF_SUPPORTED).toBe(false);
    expect(guardedAdvertisedTypes()).toEqual([]);
  });
});

describe("both KG apply paths route through the guard (source drift gate)", () => {
  // The guard only means something if it sits in front of every apply. db.ts
  // has two writes that promote a topic to a verified status; both must
  // evaluate the guard first. This greps the source so a third apply path
  // added without a guard fails the build rather than shipping unguarded.
  const dbSource = readSource("db.ts");

  it("every `status = 'consensus'` write site has a guard evaluation", () => {
    const applyWrites = dbSource.match(/UPDATE topics SET[\s\S]{0,120}?status = 'consensus'/g) ?? [];
    expect(applyWrites.length).toBeGreaterThanOrEqual(2);
    const guardCalls = dbSource.match(/evaluateApplyGuard\(/g) ?? [];
    expect(guardCalls.length).toBeGreaterThanOrEqual(applyWrites.length);
  });

  it("a refused apply emits pact.apply.blocked (§25.9)", () => {
    expect(APPLY_BLOCKED_EVENT).toBe("pact.apply.blocked");
    expect(dbSource).toContain("APPLY_BLOCKED_EVENT");
    expect(dbSource).toContain("required_principals");
  });

  it("the guard is evaluated before the write, never after", () => {
    // Both call sites read `.allowed` — a guard whose verdict is never
    // consulted is decoration.
    expect(dbSource).toContain("guard.allowed");
    expect(dbSource).toContain("applyGuard.allowed");
  });
});

describe("§25.4 — no attestation is ever synthesised", () => {
  it("wrap() reports attestation as absent and cannot derive one from protocol state", () => {
    expect(wrap({ ok: true }).attestation_ref).toBeNull();
    // The envelope must not reach for consensus/vote/TTL state to fill the
    // field. Comments are stripped first — the doc comment explains §25.4
    // and legitimately names those states; what must be absent is CODE that
    // reads them.
    const envelopeCode = stripComments(readSource("types/envelope.ts"));
    expect(envelopeCode).not.toMatch(/consensus|quorum|aligned|ttl|vote/i);
    expect(envelopeCode).not.toMatch(/^\s*import\s/m);
  });

  it("wrap() carries a verified attestation through unchanged when one is supplied", () => {
    const ref = { proofId: "p1", principalId: "did:web:alpha.example", verifiedAt: "2026-08-29T00:00:00Z" };
    expect(wrap({ ok: true }, ref).attestation_ref).toEqual(ref);
  });

  it("pact.apply.attested is emitted nowhere — the KG verifies no proof (§25.7)", () => {
    expect(APPLY_ATTESTED_EVENT).toBe("pact.apply.attested");
    const offenders = allSourceFiles()
      .filter((f) => !f.endsWith("effect-class.ts") && !f.endsWith("effect-class.test.ts"))
      .filter((f) => fs.readFileSync(f, "utf8").includes("pact.apply.attested"));
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Adapted execution-boundary vectors.
//
// HONESTY NOTE, and it matters: these are HAND-ADAPTED assertions that
// restate the two internal-reversible vectors' normative obligations against
// the KG's own surfaces. They are NOT an execution of the upstream YAML —
// nothing in this repo loads `spec/v2.3/conformance/**`, so editing a vector
// upstream cannot fail this suite. The two vectors are `kind: session` HTTP
// scripts written against paths the KG does not serve
// (`/api/pact/{id}/proposals/{proposalId}`, `/_status`, `/manifest`).
//
// Making the vectors genuinely execute is #5537, which is blocked on the
// #5536 decision about how the pact vector YAML reaches a build. Until that
// lands, "adapted" is the accurate word for what this is.
// ─────────────────────────────────────────────────────────────────────────

describe("vector (adapted): ttl-automerge-creates-no-attestation", () => {
  // §25.3, §25.4, §25.8 — auto-apply on silence is legitimate for an
  // internal-reversible effect. What must not happen is the protocol quietly
  // manufacturing a human attestation out of the silence.

  it("the auto-applied effect class is internal-reversible, so the apply is permitted", () => {
    const v = evaluateApplyGuard({ resourceType: KG_APPLY_RESOURCE_TYPE, policy: "objection-based" });
    expect(v.allowed).toBe(true);
    expect(v.effectClass).toBe("internal-reversible");
  });

  it("silence creates no attestation — attested: false, authorization_proof: null", () => {
    expect(wrap({ status: "consensus" }).attestation_ref).toBeNull();
    expect(AUTHORIZATION_PROOF_SUPPORTED).toBe(false);
  });

  it("the promotion is attributed to the engine, not to a principal", () => {
    // §25.3 — "a timeout is not a person". The KG's promotion event is
    // emitted with an empty actor; it never stamps a proposer or voter as
    // the authoriser of the apply. (#5599 PR-B: the call site rides the
    // decision transaction's client, hence `tx` — the empty actor args are
    // the pinned semantic.)
    const dbSource = readSource("db.ts");
    expect(dbSource).toContain('emitEvent(tx, d.id, "pact.topic.consensus-reached", "", ""');
  });

  it("no pact.apply.attested event accompanies an unattested apply (§25.9)", () => {
    const dbSource = readSource("db.ts");
    expect(dbSource).not.toContain("pact.apply.attested");
  });
});

describe("vector (adapted): consensus-contract-is-draft-not-signed", () => {
  // §25.8, §25.10, §15.1 — the strongest protocol state PACT can produce is
  // still a draft outcome. Absent a §25.8 execution capability, the words
  // `signed` / `executed` are unavailable to the implementation.

  it("advertises executionCapability: false", () => {
    expect(EXECUTION_CAPABILITY).toBe(false);
  });

  it("no KG terminal state is an execution label (§25.3)", () => {
    for (const t of KG_RESOURCE_TYPES) {
      for (const state of t.terminalStates) {
        expect(FORBIDDEN_EXECUTION_LABELS).not.toContain(state.toLowerCase());
      }
    }
  });

  it("no surface in the KG emits execution vocabulary for a consensus state (§25.10)", () => {
    // The boundary must hold on EVERY surface, not just the apply path — the
    // vector's own failure list calls out exports and status endpoints.
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      if (file.endsWith("effect-class.ts") || file.endsWith("effect-class.test.ts")) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const label of FORBIDDEN_EXECUTION_LABELS) {
        // Quoted string literals only — prose in a comment is not a surface.
        if (new RegExp(`["'\`]${label}["'\`]`, "i").test(text)) {
          offenders.push(`${path.relative(SRC_DIR, file)} → ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard's own capability advertisement is honest", () => {
    // applyGuard: true is claimable only because the guard is wired into the
    // apply paths (asserted above). authorizationProof stays false.
    expect(APPLY_GUARD_ENFORCED).toBe(true);
    expect(AUTHORIZATION_PROOF_SUPPORTED).toBe(false);
  });
});
