import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { GET } from "@/app/.well-known/pact.json/route";
import {
  CONFORMANCE_LEVEL,
  DECLARED_GAPS,
  EPISTEMICS_EXTENSION,
  EPISTEMICS_EXTENSION_VERSION,
  IMPLEMENTATION_VERSION,
  PUBLIC_BASE_URL,
  SPEC_VERSION,
  buildPactProfile,
} from "./pact-profile";
import {
  CHALLENGE_LAPSE_SECONDS,
  CHALLENGE_REOPEN_VOTES,
  CONSENSUS_RATIO,
  CONVENTION_STOP_BASE_AGENTS,
  STABLE_BREAK_RATIO,
  STABLE_DAYS,
  TIER_BASE_AGENTS,
} from "./db";
import {
  ASSUMES_COLLAPSE_FACTOR,
  BUILDS_ON_ATTENUATION_FACTOR,
  CREDENCE_ASYMPTOTE,
  CREDENCE_FLOOR,
} from "./epistemic";
import {
  APPLY_GUARD_ENFORCED,
  AUTHORIZATION_PROOF_SUPPORTED,
  EXECUTION_CAPABILITY,
  KG_CLASSIFIED_RESOURCE_TYPES,
  isGuarded,
  resolveResourceType,
} from "./effect-class";
import { INDEPENDENCE_CONFIG } from "./independence";
import { VERIFIED_TOPIC_STATUSES, dependencyGateOk } from "./consensus-gate";

/**
 * Wiring gate for the served `/.well-known/pact.json` (#5563).
 *
 * READ THIS BEFORE ADDING AN ASSERTION HERE. This suite is not trying to
 * pin numbers — a test that says `consensusRatio === 0.90` proves only that
 * two literals were typed identically, and it goes green on the day the
 * engine changes and the profile does not, which is precisely the failure
 * #5541 found in the Markdown profile.
 *
 * It imports the ENFORCING constant and the SERVED value and asserts they
 * are the same object's value. Move `CONSENSUS_RATIO` in `db.ts` and the
 * served document moves with it and this stays green; break the import and
 * hardcode a number in the profile and this fails immediately. The test
 * proves the wire, not the numbers.
 *
 * The one place literals are deliberate is the §9 parameter-name checklist:
 * the extension names its keys, and a renamed key is a real break.
 */

const SOURCE_ROOT = path.resolve(__dirname, "..", "..");
const PACT_ROUTES_DIR = path.join(SOURCE_ROOT, "src", "app", "api", "pact");

const profile = buildPactProfile();

describe("§15.1 — the discovery document is served, generated, and complete", () => {
  it("GET /.well-known/pact.json returns the profile as cacheable JSON", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).not.toContain("no-store");

    const body = await response.json();
    expect(body).toEqual(JSON.parse(JSON.stringify(profile)));
  });

  it("carries every §15.1 required field", () => {
    for (const field of [
      "name",
      "version",
      "specVersion",
      "conformanceLevel",
      "resourceTypes",
      "retentionPolicy",
      "capabilities",
      "endpoints",
    ]) {
      expect(profile).toHaveProperty(field);
    }
    expect(profile.resourceTypes.length).toBeGreaterThan(0);
    expect(Object.keys(profile.capabilities).length).toBeGreaterThan(0);
    expect(profile.endpoints.rest).toBe(`${PUBLIC_BASE_URL}/api/pact`);
  });

  it("is anonymous — it reads no request and names no tenant, agent or topic", () => {
    // GET takes no argument at all, which is the strongest available form of
    // "reads nothing from the request": there is no request to read.
    expect(GET.length).toBe(0);
    const wire = JSON.stringify(profile);
    // No instance identifier of any kind reaches the wire. Tenants, agents
    // and topics are all UUID-keyed in the KG, so a UUID anywhere in the
    // document is the tell.
    expect(wire).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // Nor any credential material.
    expect(wire).not.toMatch(/bearer|api[_-]?key|authorization:/i);
    // `{topicId}` in the poll endpoint is a path template, not a topic.
    expect(profile.endpoints.poll).toContain("{topicId}");
  });

  it("declares a spec version and level, and the level is not Extended", () => {
    expect(profile.specVersion).toBe(SPEC_VERSION);
    expect(profile.conformanceLevel).toBe(CONFORMANCE_LEVEL);
    // The KG has no §13 mediation and no §6.4 provenance chain (#5566);
    // Extended would be a claim it cannot support.
    expect(profile.conformanceLevel).not.toBe("extended");
    expect(profile.capabilities.mediatedCommunication).toBe(false);
    expect(profile.capabilities.informationBarriers).toBe(false);
  });

  it("does not drift from the KG's other published advertisement", () => {
    const agentCard = JSON.parse(
      fs.readFileSync(path.join(SOURCE_ROOT, "public", ".well-known", "agent-card.json"), "utf8")
    ) as { version: string };
    expect(profile.version).toBe(IMPLEMENTATION_VERSION);
    expect(profile.version).toBe(agentCard.version);
  });
});

describe("§25.5 / §25.6 — resource types are classified by the guard's own resolver", () => {
  it("advertises the built-in apply type and both registered au.tailor.* types", () => {
    expect(profile.resourceTypes.map((t) => t.type)).toEqual([
      "fact",
      "au.tailor.pact.topic",
      "au.tailor.pact.legislation-instrument",
    ]);
  });

  it("every entry's effectClass / humanAttestation comes back through resolveResourceType", () => {
    for (const declared of profile.resourceTypes) {
      const enforced = resolveResourceType(declared.type);
      expect(declared.effectClass).toBe(enforced.effectClass);
      expect(declared.humanAttestation).toBe(enforced.humanAttestation);
      // v2.3 makes both MANDATORY: an entry omitting them MUST be read as
      // external-irreversible / required, which would mis-declare the type.
      expect(["internal-reversible", "external-irreversible"]).toContain(declared.effectClass);
      expect(["required", "not-required"]).toContain(declared.humanAttestation);
    }
  });

  it("matches the upstream registry entries for both au.tailor.* types", () => {
    // spec/v2.3/resource-types.yaml records both as
    // internal-reversible / not-required. The registry is a FLOOR — this
    // implementation may classify up, never down.
    for (const type of ["au.tailor.pact.topic", "au.tailor.pact.legislation-instrument"]) {
      const declared = profile.resourceTypes.find((t) => t.type === type);
      expect(declared).toBeDefined();
      expect(declared!.effectClass).toBe("internal-reversible");
      expect(declared!.humanAttestation).toBe("not-required");
    }
  });

  it("carries the registry's boundary note on the legislation type", () => {
    // #60's entry is GRAPH INGEST ONLY: publication or a non-retractable
    // citation surface is a different, guarded effect. Dropping that note
    // would advertise a broader classification than the registry gives.
    const legislation = profile.resourceTypes.find(
      (t) => t.type === "au.tailor.pact.legislation-instrument"
    );
    expect(legislation!.applySemantics).toContain("GRAPH INGEST ONLY");
    expect(legislation!.applySemantics).toContain("external-irreversible");
  });

  it("advertises no type whose guard the KG cannot enforce (§25.6)", () => {
    for (const declared of profile.resourceTypes) {
      expect(isGuarded(resolveResourceType(declared.type))).toBe(false);
    }
    // And nothing the registry carries was silently withheld today.
    expect(profile.resourceTypes.map((t) => t.type)).toEqual(
      KG_CLASSIFIED_RESOURCE_TYPES.map((t) => t.type)
    );
  });

  it("the §25 capability flags are the enforcing module's, not restatements", () => {
    expect(profile.capabilities.applyGuard).toBe(APPLY_GUARD_ENFORCED);
    expect(profile.capabilities.authorizationProof).toBe(AUTHORIZATION_PROOF_SUPPORTED);
    expect(profile.capabilities.executionCapability).toBe(EXECUTION_CAPABILITY);
  });

  it("every true capability is earned by a served route", () => {
    const routeExists = (...segments: string[]) =>
      fs.existsSync(path.join(PACT_ROUTES_DIR, ...segments, "route.ts"));

    expect(profile.capabilities.inviteTokens).toBe(true);
    expect(routeExists("[topicId]", "join-token")).toBe(true);

    expect(profile.capabilities.structuredNegotiation).toBe(true);
    for (const primitive of ["intents", "constraints", "salience", "dependencies", "assumptions"]) {
      expect(routeExists("[topicId]", primitive)).toBe(true);
    }
  });
});

describe("au.tailor.pact/epistemics §9 — advertised values ARE the enforced values", () => {
  const advertised = profile.extensions[EPISTEMICS_EXTENSION] as Record<string, unknown>;

  it("is advertised under the extension key, with its version", () => {
    expect(advertised).toBeDefined();
    expect(advertised.version).toBe(EPISTEMICS_EXTENSION_VERSION);
  });

  it("carries every parameter the extension's §9 table defines", () => {
    // Key NAMES are literals on purpose: a renamed key breaks negotiation.
    for (const key of [
      "version",
      "tiers",
      "conventionStopQuorum",
      "consensusRatio",
      "stableBreakRatio",
      "stableAfterDays",
      "credenceAsymptote",
      "assumesCollapseFactor",
      "buildsOnAttenuationFactor",
      "credenceFloor",
      "reopenQuorumBase",
      "challengeLapseDays",
    ]) {
      expect(advertised).toHaveProperty(key);
      expect(advertised[key]).not.toBeUndefined();
    }
  });

  it("per-tier quorums are db.ts's TIER_BASE_AGENTS", () => {
    expect(advertised.tiers).toEqual(TIER_BASE_AGENTS);
    // A copy, not the live object — a served document must not alias engine
    // state that a later caller could mutate.
    expect(advertised.tiers).not.toBe(TIER_BASE_AGENTS);
  });

  it("the consensus and stable-break ratios are the sweep's own bindings", () => {
    expect(advertised.consensusRatio).toBe(CONSENSUS_RATIO);
    expect(advertised.stableBreakRatio).toBe(STABLE_BREAK_RATIO);
    // §9 rule 2 — stableBreakRatio MUST NOT sit above consensusRatio.
    expect(STABLE_BREAK_RATIO).toBeLessThanOrEqual(CONSENSUS_RATIO);
  });

  it("the quorum, window and challenge parameters are the enforced constants", () => {
    expect(advertised.conventionStopQuorum).toBe(CONVENTION_STOP_BASE_AGENTS);
    expect(advertised.stableAfterDays).toBe(STABLE_DAYS);
    expect(advertised.reopenQuorumBase).toBe(CHALLENGE_REOPEN_VOTES);
    // Enforced in seconds, advertised in days — the conversion is the wire.
    expect(advertised.challengeLapseDays).toBe(CHALLENGE_LAPSE_SECONDS / 86400);
  });

  it("the credence parameters are epistemic.ts's", () => {
    expect(advertised.credenceAsymptote).toBe(CREDENCE_ASYMPTOTE);
    expect(advertised.assumesCollapseFactor).toBe(ASSUMES_COLLAPSE_FACTOR);
    expect(advertised.buildsOnAttenuationFactor).toBe(BUILDS_ON_ATTENUATION_FACTOR);
    expect(advertised.credenceFloor).toBe(CREDENCE_FLOOR);
  });

  it("the dependency gate is probed from consensus-gate.ts, not asserted", () => {
    const bound = advertised.maxUnmetDependenciesForPromotion as number;
    // Whatever the advertised bound is, the gate must accept it and refuse
    // one more. That holds for any value the gate could take.
    expect(dependencyGateOk(null, bound)).toBe(true);
    expect(dependencyGateOk(null, bound + 1)).toBe(false);
  });

  it("the verified set is the gate's own status list, in protocol vocabulary", () => {
    const set = advertised.verifiedSet as string[];
    expect(set).toEqual(["aligned", "verified"]);
    expect(VERIFIED_TOPIC_STATUSES.length).toBeGreaterThanOrEqual(set.length);
  });

  it("the §8 independence block is the one the stats surface already publishes", () => {
    expect(advertised.independence).toMatchObject({
      version: INDEPENDENCE_CONFIG.version,
      minAccountAgeDays: INDEPENDENCE_CONFIG.minAccountAgeDays,
      minAcceptedContributions: INDEPENDENCE_CONFIG.minAcceptedContributions,
      allowSelfApproval: INDEPENDENCE_CONFIG.allowSelfApproval,
    });
  });

  it("quorums and ratios sit at or above the extension's published defaults", () => {
    // §9 rule 2 — an implementation may raise a quorum or ratio, never lower
    // it. These four literals are the DEFAULTS FROM THE EXTENSION DOCUMENT,
    // not restatements of the KG's values; the comparison is the point.
    expect(CONSENSUS_RATIO).toBeGreaterThanOrEqual(0.9);
    expect(STABLE_BREAK_RATIO).toBeGreaterThanOrEqual(0.8);
    expect(CONVENTION_STOP_BASE_AGENTS).toBeGreaterThanOrEqual(2);
    expect(CHALLENGE_REOPEN_VOTES).toBeGreaterThanOrEqual(3);
    for (const [tier, floor] of Object.entries({
      empirical: 3,
      institutional: 3,
      interpretive: 4,
      conjecture: 5,
      convention: 3,
      practice: 3,
      policy: 3,
      frontier: 5,
    })) {
      expect(TIER_BASE_AGENTS[tier]).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe("declared gaps — what the KG does NOT have, on the same wire", () => {
  it("the served document carries them", () => {
    expect(profile.declaredGaps.length).toBe(DECLARED_GAPS.length);
    for (const gap of profile.declaredGaps) {
      expect(gap.area.length).toBeGreaterThan(0);
      expect(gap.statement.length).toBeGreaterThan(0);
    }
  });

  it("names the §6.4 provenance gap and points at the issue tracking it", () => {
    const provenance = profile.declaredGaps.find((g) => g.area.includes("§6.4"));
    expect(provenance).toBeDefined();
    expect(provenance!.statement).toContain("prev_hash");
    expect(provenance!.tracking).toContain("5566");
  });

  it("names the Extended-level, principal-registry, endpoint and retention gaps", () => {
    const areas = profile.declaredGaps.map((g) => g.area).join(" | ");
    expect(areas).toContain("§15.2 Extended level");
    expect(areas).toContain("§17.4");
    expect(areas).toContain("§15.1 endpoints");
    expect(areas).toContain("§6.3 retention policy");
  });

  it("names the epistemics §10 event-vocabulary gap rather than implying the mapping", () => {
    const events = profile.declaredGaps.find((g) => g.area.includes("§10 events"));
    expect(events).toBeDefined();
    expect(events!.statement).toContain("pact.epistemics.");
  });

  it("retention advertises observed behaviour — and fails if a purge path appears", () => {
    expect(profile.retentionPolicy).toEqual({
      minimumDays: 0,
      indefinite: true,
      tombstoneAfter: null,
    });
    // `indefinite: true` is only honest while nothing deletes events. A
    // delete path added later must move the advertisement, not survive it.
    const dbSource = fs.readFileSync(path.join(SOURCE_ROOT, "src", "lib", "db.ts"), "utf8");
    expect(dbSource).not.toMatch(/DELETE\s+FROM\s+events/i);
  });
});
