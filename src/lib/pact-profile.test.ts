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
import {
  EPISTEMICS_EVENTS,
  PACT_EVENT_MAP,
  epistemicsEventMappingAdvertisement,
  epistemicsFieldMappingAdvertisement,
} from "./epistemics-mapping";
import { INDEPENDENCE_CONFIG } from "./independence";
import { VERIFIED_TOPIC_STATUSES, dependencyGateOk } from "./consensus-gate";
import { CHAIN_HASH_ALG, FIRST_SEQUENCE_NUMBER, GENESIS_SENTINELS } from "./provenance-chain";
import {
  CHAINED_EVENTS_RETAINED_INDEFINITELY,
  PURGE_IS_TOMBSTONE,
  UNCHAINED_EVENTS_PURGED,
  UNCHAINED_EVENT_RETENTION_DAYS,
  buildUnchainedEventPurge,
} from "./retention";

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
const SRC_DIR = path.join(SOURCE_ROOT, "src");

/**
 * Every non-test `.ts`/`.tsx` under `src/` — the production surface, so a
 * question like "is the purge actually wired up?" can be answered from the
 * repo rather than from a constant that claims it is.
 *
 * Deliberately a second, local copy of the walker in `provenance-chain.test.ts`
 * rather than a shared export: a helper that both suites import would itself be
 * production source and would then have to be walked by its own guards.
 */
function productionSourceFiles(dir: string = SRC_DIR): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Production modules OTHER than `retention.ts` that CALL `name(`.
 *
 * `retention.ts` is excluded because it declares the builders — its own
 * `export function buildUnchainedEventPurge(` would otherwise read as a call
 * and the answer would be "wired" even with the cron gutted. Comments are
 * dropped for the same reason: `route.ts` names the builder in prose as well as
 * calling it, and prose is not a delete path.
 *
 * This uses the cheap two-regex strip rather than the character scanner in
 * `provenance-chain.test.ts`, and that is safe HERE and only here because of
 * the direction it fails in. The known defect of the naive form is that a `/*`
 * inside a `//` comment opens a phantom block comment and swallows real code —
 * i.e. it strips too MUCH. Stripping too much can only lose a caller, which
 * turns the assertion below red and names the contradiction. It cannot invent
 * one. G1/G4 in `provenance-chain.test.ts` need the full scanner because there
 * the same over-strip would hide a violation silently.
 */
function productionCallersOf(name: string): string[] {
  const call = new RegExp(String.raw`\b${name}\s*\(`);
  return productionSourceFiles()
    .filter((file) => !file.endsWith(`${path.sep}retention.ts`))
    .filter((file) =>
      call.test(
        fs
          .readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/\/\/[^\n]*/g, " ")
      )
    )
    .map((file) => path.relative(SRC_DIR, file).replace(/\\/g, "/"))
    .sort();
}

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
    // The KG has no §13 mediation and no §17.4 clearance surface; Extended
    // would be a claim it cannot support. (#5566/#5587 shipped the §6.4
    // chain, so the absence of one is no longer a third reason — see the
    // §6.4 gap assertions below for what the chain still does not cover.)
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

  /**
   * REPLACES the pre-#5598 assertion, which pinned the STALE §6.4 text.
   *
   * That test asserted the gap statement contained `prev_hash` and tracked
   * #5566 — both true of the sentence "the event log assigns no gapless
   * sequence number and no prev_hash". #5566/#5587 then SHIPPED the chain,
   * which made that sentence false on the live wire, and the test stayed
   * green because it pinned the wording rather than the claim.
   *
   * A gap is RETIRED AND REPLACED, never deleted: an absent §6.4 entry would
   * read as full §6.4 coverage, and coverage is exactly what is still
   * partial. So this asserts three separate things — the entry still exists,
   * it no longer denies the chain, and it names what the chain does not
   * reach.
   *
   * VIOLATING DIFF: restore the old statement in `pact-profile.ts` and the
   * `not.toMatch` fails; delete the §6.4 entry entirely and `toBeDefined`
   * fails. Neither edit can pass quietly.
   */
  it("still declares a §6.4 gap, and it no longer denies the chain exists", () => {
    const provenance = profile.declaredGaps.find((g) => g.area.includes("§6.4"));
    expect(provenance).toBeDefined();
    expect(provenance!.statement.length).toBeGreaterThan(0);
    // The exact denial that went stale the day #5587 merged. If this phrasing
    // ever comes back, it is false the moment it lands.
    expect(provenance!.statement).not.toMatch(/no gapless sequence number|assigns no .*prev_hash/i);
    // What the chain still does NOT reach is on the wire, not left to
    // inference: no external witness (ii), no production verifier (iii), the
    // permanently uncorrectable pre-marker GENESIS case (iv), (v) that the
    // GENESIS verdict now turns on a server-side latch the feed does not
    // publish, so an external verifier evaluates a strictly weaker test, and
    // (vi) that the chain link commits in a transaction separate from the
    // state change it records on every production route — #5599's finding,
    // added by #5539.
    expect(provenance!.statement).toContain("pact.log.root");
    expect(provenance!.statement).toMatch(/GENESIS/);
    expect(provenance!.statement).toMatch(/same transaction/i);
    // #5539: `tracking` must point at OPEN work. #5598 closed with the
    // genesis-evidence and retention repairs, which made it a dangling
    // pointer; what remains open is #5599 (the separate-transaction chain
    // link) and #5650 (signed root + transparency anchor + cross-impl
    // comparison). The statement may still cite #5598 as history — the
    // tracking field may not.
    expect(provenance!.tracking).toContain("5599");
    expect(provenance!.tracking).toContain("5650");
    expect(provenance!.tracking).not.toContain("5598");
    // (v) specifically. `genesisSentinelIsFalsified` reads
    // `hadUnchainedHistory` out of `resource_chain_meta`, and no route serves
    // that table — GET /api/pact/{topicId}/events is `SELECT e.*` over `events`
    // alone. The unqualified claim "a consumer can re-derive it from the public
    // events feed" was therefore false for exactly one clause, which is the
    // clause a tamperer would attack. Naming the divergence AND its direction
    // is the disclosure; deleting the re-derivation claim would have been the
    // generous inference this list exists to prevent.
    expect(provenance!.statement).not.toMatch(
      /a consumer can re-derive it from the public events feed/i
    );
    expect(provenance!.statement).toMatch(/latch/i);
    expect(provenance!.statement).toMatch(/not published on any endpoint/i);
  });

  /**
   * The §6.4 block A4 added to the served document is DERIVED from
   * `provenance-chain.ts` — the module that actually stamps the chain — for
   * the same reason every other block here is derived from its enforcing
   * module. A hand-typed `hashAlg` would let the profile advertise an
   * algorithm the writer does not produce, and §6.4 requires a consumer to
   * REJECT an unrecognised algorithm rather than skip verification, so the
   * identifier on the wire is load-bearing for a third party.
   *
   * VIOLATING DIFF: type `hashAlg: "sha256-jcs@1"` as a literal in
   * `pact-profile.ts` and this stays green until `CHAIN_HASH_ALG` moves — at
   * which point it goes red, which is the whole point. Return
   * `GENESIS_SENTINELS` itself instead of a spread and the aliasing check
   * fails immediately.
   */
  it("the §6.4 provenance block is the writing module's own constants", () => {
    expect(profile.provenance).toEqual({
      hashAlg: CHAIN_HASH_ALG,
      firstSequenceNumber: FIRST_SEQUENCE_NUMBER,
      genesisSentinels: [...GENESIS_SENTINELS],
      signedRoot: false,
      transparencyAnchor: false,
    });
    // A copy, not the live array — a served document must never alias module
    // state a later caller could mutate.
    expect(Object.is(profile.provenance.genesisSentinels, GENESIS_SENTINELS)).toBe(false);
    // Both sentinels a first chained event may legitimately carry are
    // published. A verifier that only knows `GENESIS` would read every
    // honestly-declared `GENESIS-UNCHAINED` start as a missing genesis.
    expect(profile.provenance.genesisSentinels).toContain("GENESIS");
    expect(profile.provenance.genesisSentinels).toContain("GENESIS-UNCHAINED");
    // Declared false, never omitted: silence on a well-known §6.4 mechanism
    // reads as "unknown", and unknown is where a generous inference goes.
    expect(profile.provenance.signedRoot).toBe(false);
    expect(profile.provenance.transparencyAnchor).toBe(false);
  });

  it("names the Extended-level, principal-registry, endpoint and retention gaps", () => {
    const areas = profile.declaredGaps.map((g) => g.area).join(" | ");
    expect(areas).toContain("§15.2 Extended level");
    expect(areas).toContain("§17.4");
    expect(areas).toContain("§15.1 endpoints");
    expect(areas).toContain("§6.3 retention policy");
  });

  /**
   * REWRITTEN, not deleted, when the §10 gap was retired-and-replaced
   * (#5564/#5565). The old assertion pinned the gap's PRESENCE ("the mapping
   * is not published yet"); the mapping is published now, so this pins the
   * REPLACEMENT: the served eventMapping is complete over the extension's
   * seven §10 events — every one either maps to at least one product op or
   * is declared unimplemented with a reason — and the replaced gap entry
   * names precisely what remains rather than reverting to the retired
   * phrasing.
   */
  it("publishes a complete §10 event mapping; the retired gap names only what remains", () => {
    const advertised = profile.extensions[EPISTEMICS_EXTENSION] as {
      eventMapping: Record<string, { productOps?: string[]; unimplemented?: string }>;
    };
    // Served, and derived from the classification table the emitters are
    // typed against — not a parallel hand-written copy.
    expect(advertised.eventMapping).toEqual(epistemicsEventMappingAdvertisement());

    // Completeness over the seven §10 events: mapped XOR declared-with-reason.
    for (const eventName of EPISTEMICS_EVENTS) {
      const entry = advertised.eventMapping[eventName];
      expect(entry, `eventMapping is missing ${eventName}`).toBeDefined();
      if ("unimplemented" in entry && entry.unimplemented !== undefined) {
        expect(entry.unimplemented.length).toBeGreaterThan(0);
        expect(entry.productOps).toBeUndefined();
      } else {
        expect(entry.productOps, `${eventName} maps to no product op and declares no reason`).toBeDefined();
        expect(entry.productOps!.length).toBeGreaterThan(0);
        // Every advertised product op is a declared emitter op, classified
        // to exactly this extension event.
        for (const op of entry.productOps!) {
          const classification = PACT_EVENT_MAP[op as keyof typeof PACT_EVENT_MAP];
          expect(classification, `${op} is advertised but not in PACT_EVENT_MAP`).toBeDefined();
          expect(classification.scope).toBe("epistemics");
          expect((classification as { event: string }).event).toBe(eventName);
        }
      }
    }

    // The known shortfall stays declared: challenge-reopened has no emitter.
    expect(advertised.eventMapping["pact.epistemics.challenge-reopened"]).toHaveProperty(
      "unimplemented"
    );

    // The replaced gap entry: names the two remaining shortfalls, and the
    // retired "not published yet" phrasing must never come back — it would
    // be false the moment it landed.
    const events = profile.declaredGaps.find((g) => g.area.includes("§10 events"));
    expect(events).toBeDefined();
    expect(events!.statement).toContain("challenge-reopened");
    expect(events!.statement).toMatch(/payload/i);
    expect(events!.statement).not.toMatch(/not published yet/i);
    expect(events!.tracking).toContain("5565");
  });

  /**
   * #5564 — the field-name mapping: extension term → wire field → route,
   * served in the same extension block, with the lossy 8→4 tier→warrantKind
   * collapse declared in words a consumer can act on.
   */
  it("publishes the §3/§5/§7 field mapping with the tier→warrantKind collapse declared", () => {
    const advertised = profile.extensions[EPISTEMICS_EXTENSION] as {
      fieldMapping: Array<{ extensionTerm: string; wireField: string; routes: string[]; note?: string }>;
    };
    expect(advertised.fieldMapping).toEqual(epistemicsFieldMappingAdvertisement());

    const byTerm = new Map(advertised.fieldMapping.map((f) => [f.extensionTerm, f]));
    // The terms #5564 requires covered, each naming a wire field and at
    // least one route.
    for (const term of ["tier", "consensusState", "credence", "defeaterType", "convention_stop", "conventionStopQuorum"]) {
      const entry = byTerm.get(term);
      expect(entry, `fieldMapping is missing ${term}`).toBeDefined();
      expect(entry!.wireField.length).toBeGreaterThan(0);
      expect(entry!.routes.length).toBeGreaterThan(0);
    }
    // The collapse is declared on the tier entry, not left to inference.
    expect(byTerm.get("tier")!.note).toMatch(/warrantKind/);
    expect(byTerm.get("tier")!.note).toMatch(/loss/i);
    // consensusState is served as the product field `state` — mapped, not
    // renamed (grandfathering).
    expect(byTerm.get("consensusState")!.wireField).toBe("state");
    // A served document never aliases module state.
    expect(Object.is(advertised.fieldMapping, epistemicsFieldMappingAdvertisement())).toBe(false);
  });

  /**
   * REPLACES the guard that could not fail (#5598).
   *
   * The old version pinned `{ minimumDays: 0, indefinite: true }` as three
   * literals and then read `src/lib/db.ts` asserting it held no
   * `DELETE FROM events`. That string has never been in `db.ts` — the daily
   * purge lives in `src/app/api/cron/cleanup/route.ts` — so the guard was
   * green over a live hard delete for as long as both existed. Its own
   * comment stated the invariant correctly ("a delete path added later must
   * move the advertisement, not survive it") and then looked in a file that
   * could not contain the thing it was looking for. A grep pointed at the
   * wrong file is worse than no guard at all: it reads as coverage.
   *
   * The replacement does not grep. `retention.ts` owns the bound AND builds
   * the statement that enforces it; `pact-profile.ts` derives the
   * advertisement from those same constants. "Does the wire match reality?"
   * is therefore an equality between two live values, and the only way to
   * move the advertisement is to move the enforcement.
   *
   * VIOLATING DIFF — every one of these turns this red:
   *  - `pact-profile.ts`: `minimumDays: 30` typed beside the constant instead
   *    of imported from it — red the moment `UNCHAINED_EVENT_RETENTION_DAYS`
   *    moves, because the builder's bound moves and the advertisement does
   *    not.
   *  - `retention.ts`: bump `UNCHAINED_EVENT_RETENTION_DAYS` to 45 but leave
   *    the CTE on a hardcoded interval — red on the `args[0]` comparison.
   *  - `retention.ts`: `make_interval(days => ?)` replaced by
   *    `INTERVAL '30 days'` — red on the interpolation check, because an
   *    un-parameterised bound is one nothing can derive from.
   *  - `retention.ts`: `UNCHAINED_EVENTS_PURGED = false` while the cron still
   *    calls `buildUnchainedEventPurge()` — red on the wiring check, which is
   *    the failure the old guard was aimed at and missed.
   *  - `cleanup/route.ts`: remove the purge call but leave
   *    `UNCHAINED_EVENTS_PURGED = true` — also red on the wiring check, from
   *    the other side. Advertising a 30-day bound over a log that is in fact
   *    kept forever is the same lie sign-flipped.
   *  - `retention.ts`: `PURGE_IS_TOMBSTONE = true` while the statement still
   *    hard-deletes — red on the mechanism check.
   *
   * NOTE ON THE VERSION THIS REPLACES. #5598 first shipped the wiring check as
   * `expect(UNCHAINED_EVENTS_PURGED && profile.retentionPolicy.indefinite)
   * .toBe(false)`. Because `pact-profile.ts` defines `indefinite` as
   * `!UNCHAINED_EVENTS_PURGED`, that expression is `P && !P` — false for every
   * value of P, so it could not fail, and the violating diff its own docblock
   * named left the suite green while the served document flipped to
   * `indefinite: true` over a live daily hard delete. `PURGE_IS_TOMBSTONE` had
   * the same shape. A tautology dressed as an invariant is the exact defect
   * this issue exists to remove, so both are now derived from the repo.
   */
  it("retentionPolicy is DERIVED from the constants the purge is built with", () => {
    // Each advertised field is the enforcing constant, not a literal beside
    // it. Move the constant and the wire moves with it.
    expect(profile.retentionPolicy.minimumDays).toBe(UNCHAINED_EVENT_RETENTION_DAYS);
    expect(profile.retentionPolicy.indefinite).toBe(!UNCHAINED_EVENTS_PURGED);
    expect(profile.retentionPolicy.tombstoneAfter).toBe(
      PURGE_IS_TOMBSTONE ? UNCHAINED_EVENT_RETENTION_DAYS : null
    );

    // ...and the statement that does the deleting BINDS that same constant as
    // a parameter rather than carrying its own interval. This is the half the
    // old guard reached for with a grep and never touched.
    const purge = buildUnchainedEventPurge();
    expect(purge.args[0]).toBe(UNCHAINED_EVENT_RETENTION_DAYS);
    expect(purge.args[0]).toBe(profile.retentionPolicy.minimumDays);
    // The bound really is the parameter: a builder that ignored its argument
    // and interpolated a literal would satisfy both lines above.
    expect(buildUnchainedEventPurge(7).args[0]).toBe(7);
    expect(purge.sql).not.toMatch(/INTERVAL\s+'/i);
    expect(purge.sql).toContain("make_interval(days => ?)");

    // WIRING. `UNCHAINED_EVENTS_PURGED` is the one input to `indefinite` that
    // nothing else can check, because it claims something no built string can
    // show: that the delete is actually INVOKED. So it is answered from the
    // repo. A builder nobody calls deletes nothing, and a purge nobody
    // advertises is undisclosed deletion — the constant must track the wiring
    // in both directions, which is why this is an equality and not an
    // implication.
    const purgeCallers = productionCallersOf("buildUnchainedEventPurge");
    expect(UNCHAINED_EVENTS_PURGED).toBe(purgeCallers.length > 0);
    // Named, so a diff that moves the purge to a new caller has to say so here
    // rather than passing on a count.
    expect(purgeCallers).toEqual(["app/api/cron/cleanup/route.ts"]);

    // MECHANISM. `tombstoneAfter` is null because the statement hard-deletes.
    // Derived from the statement, not asserted beside it: flipping
    // `PURGE_IS_TOMBSTONE` to true while the CTE still says `DELETE FROM
    // events` would advertise a tombstone that does not exist, and a consumer
    // reading `tombstoneAfter: 30` would expect the row to still be there.
    expect(PURGE_IS_TOMBSTONE).toBe(!/DELETE\s+FROM\s+events\b/i.test(purge.sql));

    // `indefinite` describes the log AS A WHOLE. It is false because one half
    // of the log is purged, not because the other half is — §6.4 forbids
    // deleting a chained row, so that half genuinely is kept forever. Derived
    // from the predicate that stops the purge at the chain: drop
    // `sequence_number IS NULL` and chained rows start being deleted too, at
    // which point this constant is false and the claim has to move with it.
    expect(CHAINED_EVENTS_RETAINED_INDEFINITELY).toBe(
      purge.sql.includes("sequence_number IS NULL")
    );
  });

  /**
   * The §6.3 gap's PROSE is derived too — the day count is interpolated from
   * the enforcing constant, so the sentence a human reads cannot drift from
   * the number the purge is built with.
   *
   * VIOLATING DIFF: restore "the implementation holds no purge, expiry or
   * tombstone path for the event log" and the `not.toMatch` fails; hardcode
   * "30 days" in the prose and bump the constant, and the `toContain` fails.
   */
  it("the §6.3 gap states the real split, in the enforcing module's number", () => {
    const retention = profile.declaredGaps.find((g) => g.area.includes("§6.3"));
    expect(retention).toBeDefined();
    // The day count is the constant, not a number typed next to it.
    expect(retention!.statement).toContain(`${UNCHAINED_EVENT_RETENTION_DAYS} days`);
    // The claim that was false on the live wire for as long as it was served.
    expect(retention!.statement).not.toMatch(/holds no purge|no purge, expiry or tombstone/i);
    // Both halves of the split are named, and the mechanism is stated as the
    // hard delete it is rather than the tombstone it is not.
    expect(retention!.statement).toMatch(/hard-deleted/i);
    expect(retention!.statement).toMatch(/indefinitely/i);
  });
});
