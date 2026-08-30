/**
 * The KG's §15.1 Implementation Profile — GENERATED, not written (#5563).
 *
 * ## Why this is code and not a file in `public/`
 *
 * Before #5563 the KG published its conformance claim as prose: a Markdown
 * document with an embedded JSON block, dated April 2026, that had drifted
 * five months from the implementation (#5541) and that no peer could fetch
 * from the wire at all. A static `public/.well-known/pact.json` would have
 * fixed the second problem and kept the first: a hand-maintained JSON file
 * drifts exactly the way a hand-maintained Markdown file drifts.
 *
 * So every advertised value here is READ FROM THE MODULE THAT ENFORCES IT.
 * The conceptual precedent is Tailor's `PactTierProbeService`, which resolves
 * the served `effectClass` / `humanAttestation` from the live resource-type
 * registry the §25.6 guard itself consults, so the profile structurally
 * cannot advertise a classification the engine does not enforce. The same
 * discipline applies here, and it is the whole point of the child:
 *
 *  - `resourceTypes[]` classifications come back through
 *    {@link resolveResourceType} — the resolver the apply guard calls — and a
 *    type the resolver reports as guarded is DROPPED from the advertisement
 *    and named in {@link DeclaredGap}, because §25.6 forbids advertising a
 *    type whose guard the server cannot enforce.
 *  - The §25 capability flags come from `effect-class.ts`.
 *  - Every `au.tailor.pact/epistemics` parameter is imported from `db.ts`,
 *    `epistemic.ts`, `consensus-gate.ts` or `independence.ts`. Not one of
 *    them is retyped here. Move a constant and the served document moves
 *    with it — that is the extension's §9 binding rule ("advertised values
 *    MUST be the values actually enforced") made structural rather than
 *    aspirational.
 *
 * ## What this profile does NOT claim
 *
 * {@link DECLARED_GAPS} is not decoration. The KG has no §6.4 provenance
 * chain, no §17.4 principal registry and no §13 mediation surface, and the
 * honest thing is to name those on the same wire that carries the claim
 * rather than to pick a conformance word that quietly implies them. See
 * {@link CONFORMANCE_LEVEL} for the reasoning behind `core`.
 *
 * The document is anonymous and cacheable: it names no tenant, no agent and
 * no topic, and it reads nothing from the request.
 */

import {
  CHALLENGE_LAPSE_SECONDS,
  CHALLENGE_REOPEN_VOTES,
  CONSENSUS_RATIO,
  CONVENTION_STOP_BASE_AGENTS,
  STABLE_BREAK_RATIO,
  STABLE_DAYS,
  TIER_BASE_AGENTS,
} from "./db";
import { VERIFIED_TOPIC_STATUSES, dependencyGateOk } from "./consensus-gate";
import {
  APPLY_GUARD_ENFORCED,
  AUTHORIZATION_PROOF_SUPPORTED,
  EXECUTION_CAPABILITY,
  KG_CLASSIFIED_RESOURCE_TYPES,
  isGuarded,
  resolveResourceType,
  type ResourceTypeProfile,
} from "./effect-class";
import {
  ASSUMES_COLLAPSE_FACTOR,
  BUILDS_ON_ATTENUATION_FACTOR,
  CREDENCE_ASYMPTOTE,
  CREDENCE_FLOOR,
  consensusStateFor,
} from "./epistemic";
import { publicIndependenceProfile } from "./independence";

/** The KG's canonical public origin. */
export const PUBLIC_BASE_URL = "https://pact.tailor.au";

/** §15.1 `name`. */
export const PROFILE_NAME = "Source";

/**
 * §15.1 `version` — the IMPLEMENTATION version, independent of
 * `specVersion`. Pinned to the version the KG already publishes in its A2A
 * agent card so the two public advertisements cannot say different things;
 * `pact-profile.test.ts` fails if they diverge.
 */
export const IMPLEMENTATION_VERSION = "0.4.0";

/**
 * §15.1 `specVersion` — the version of the spec this profile is written
 * against, which is the version carrying the §25 execution boundary the KG
 * now enforces (`effect-class.ts`, #5535) and the §15.1 mandate that every
 * advertised resource type carry `effectClass` / `humanAttestation`.
 *
 * Stating `2.3` is a claim about the TEXT this profile answers to, not a
 * claim to satisfy all of it — {@link CONFORMANCE_LEVEL} and
 * {@link DECLARED_GAPS} carry that. The alternative, naming an older version
 * the KG happens to clear, is the defect #5539 filed: a reader cannot tell
 * which vector set applies, and the profile stays silent about the gap
 * instead of stating it.
 */
export const SPEC_VERSION = "2.3";

/**
 * §15.1 `conformanceLevel`. `core`, and deliberately not `extended`.
 *
 * §15.2 sets Extended at Core PLUS information barriers (classification,
 * clearance, graduated disclosure), mediated communication, structured
 * negotiation, invite tokens, and published `effectClass` /
 * `humanAttestation` per advertised type. The KG has the last three: the
 * negotiation primitives, the invite-token mint/redeem path, and — since
 * #5535 — the published classifications. It has NEITHER of the first two: no
 * §13 mediator and no clearance surface exists anywhere in the tree.
 *
 * Independently, the KG has no §6.4 provenance chain — its event log carries
 * no gapless `sequenceNumber` and no `prev_hash`, so it is not third-party
 * verifiable (#5566, in flight). Claiming Extended over that would be exactly
 * the conformance laundering the W6 audit was opened to find.
 *
 * `core` is therefore the honest word, and the gaps that keep it there are
 * enumerated rather than left to inference.
 */
export const CONFORMANCE_LEVEL = "core";

/** The `au.tailor.pact/epistemics` extension key and version (#60 §9). */
export const EPISTEMICS_EXTENSION = "au.tailor.pact/epistemics";
export const EPISTEMICS_EXTENSION_VERSION = "1";

/** Upper bound on the unmet-dependency probe below. */
const DEPENDENCY_PROBE_CEILING = 8;

/**
 * The §6.2 promotion gate, read from `consensus-gate.ts` by PROBING it
 * rather than by restating "zero".
 *
 * `dependencyGateOk` is the predicate the sweep calls; the largest unmet
 * count it still accepts IS the advertised bound. Loosen the gate and this
 * number rises on the wire by itself — which is what makes the
 * advertisement load-bearing instead of a comment.
 */
export function maxUnmetDependenciesForPromotion(): number {
  let n = 0;
  while (n <= DEPENDENCY_PROBE_CEILING && dependencyGateOk(null, n)) n++;
  return n - 1;
}

/**
 * The extension's §2 "verified set", in PROTOCOL vocabulary. The KG's
 * internal statuses are mapped through `consensusStateFor` — the same
 * function every other protocol surface maps them with — so the profile
 * cannot advertise a verified set that differs from the one the dependency
 * gate resolves against.
 */
export function advertisedVerifiedSet(): string[] {
  return [...new Set(VERIFIED_TOPIC_STATUSES.map((s) => consensusStateFor(s)))];
}

/** One honestly-stated shortfall in the served document. */
export interface DeclaredGap {
  /** Spec area the shortfall sits in. */
  readonly area: string;
  /** What is absent, in plain terms. */
  readonly statement: string;
  /** Where the work is tracked, when it is tracked. */
  readonly tracking?: string;
}

/**
 * What this implementation does NOT have, published on the same wire as
 * what it does.
 *
 * A profile that lists only capabilities lets a reader infer the rest, and
 * the inference is always generous. Every entry here is a shortfall a peer
 * would otherwise have to discover by probing.
 */
export const DECLARED_GAPS: readonly DeclaredGap[] = [
  {
    area: "§6.4 event-log provenance",
    statement:
      "The event log assigns no gapless sequence number and no prev_hash, " +
      "so it is not third-party verifiable. Events are append-only in " +
      "practice, but a consumer cannot prove no entry was removed.",
    tracking: "TailorAU/tailor-app#5566",
  },
  {
    area: "§6.3 retention policy",
    statement:
      "No written retention policy exists. The advertised retentionPolicy " +
      "records OBSERVED behaviour — the implementation holds no purge, " +
      "expiry or tombstone path for the event log — and guarantees no " +
      "minimum, which is why minimumDays is 0 rather than a number nothing " +
      "enforces.",
  },
  {
    area: "§15.2 Extended level",
    statement:
      "No §13 mediated-communication surface and no information-barrier / " +
      "clearance model exist. Structured negotiation, invite tokens and " +
      "published effect classifications do exist, but Extended requires all " +
      "of them, so the declared level stays core.",
  },
  {
    area: "§17.4 / §17.6 principals and proofs",
    statement:
      "No HumanPrincipal registry, no authorization_proof verification and " +
      "no §6.5 pending-obligation surface. The §25.6 guard can therefore " +
      "only refuse a guarded apply, never release one, and no guarded " +
      "resource type is advertised.",
  },
  {
    area: "§15.1 endpoints",
    statement:
      "No realtime endpoint and no credentials registry are advertised, " +
      "because neither exists. Polling is served by " +
      "GET /api/pact/{topicId}/events?after={eventId}.",
  },
  {
    area: "§15.2 Core primitives",
    statement:
      "The Core primitive `leave` has no route: an agent that joined a " +
      "topic cannot withdraw from it. Every other Core primitive is served.",
  },
  {
    area: "au.tailor.pact/epistemics §10 events",
    statement:
      "Transitions are recorded under the KG's own product event names " +
      "(pact.topic.consensus-reached, pact.topic.stable, " +
      "pact.stable.broken, pact.consensus.blocked-by-dependencies and " +
      "others), not under the extension's pact.epistemics.* vocabulary. " +
      "The extension permits that only with a declared mapping, and the " +
      "mapping is not published yet.",
  },
];

/**
 * A §15.1 `resourceTypes[]` entry as served. Structurally the registry's own
 * entry shape — the advertisement adds nothing the enforcing module does not
 * already carry, which is the point.
 */
export type AdvertisedResourceType = ResourceTypeProfile;

/**
 * The advertised resource types, with each entry's §25.5 classification
 * resolved through {@link resolveResourceType} — the function the apply
 * guard calls — rather than copied off the entry itself.
 *
 * A type the resolver reports as guarded is dropped: §25.6 says a server
 * that cannot enforce the guard MUST NOT advertise the affected type, and
 * the KG can enforce no guard at all (no principal registry, no proof
 * verification). Dropping fails SAFE, and the drop is not silent — the
 * dropped names come back from {@link unadvertisableResourceTypes} and land
 * in the served document's declared gaps.
 */
export function advertisedResourceTypes(): AdvertisedResourceType[] {
  return KG_CLASSIFIED_RESOURCE_TYPES.flatMap((entry) => {
    const enforced = resolveResourceType(entry.type);
    if (isGuarded(enforced)) return [];
    return [
      {
        ...entry,
        effectClass: enforced.effectClass,
        humanAttestation: enforced.humanAttestation,
      },
    ];
  });
}

/** Types the registry carries but the guard would not let the KG advertise. */
export function unadvertisableResourceTypes(): string[] {
  return KG_CLASSIFIED_RESOURCE_TYPES.filter((t) => isGuarded(resolveResourceType(t.type))).map(
    (t) => t.type
  );
}

/**
 * The `au.tailor.pact/epistemics` advertisement (#60 §9).
 *
 * Every parameter in the extension's table appears, each one imported. The
 * three keys beyond that table — `verifiedSet`,
 * `maxUnmetDependenciesForPromotion` and `independence` — carry §2, §6.2 and
 * §8 behaviour that the table has no slot for but that a peer needs in order
 * to reason about what a quorum here actually attests.
 *
 * On `stableBreakRatio`: the extension's default is 0.80 and it MUST NOT sit
 * above `consensusRatio`. The KG enforces exactly the default, so the two
 * ratios are advertised as the engine holds them, not as the widest values
 * the rule would permit.
 */
export function epistemicsAdvertisement() {
  return {
    version: EPISTEMICS_EXTENSION_VERSION,
    // §3 — per-tier base quorums, straight off the record getRequiredAgents
    // indexes. Spread, not referenced, so a served document can never alias
    // the live object.
    tiers: { ...TIER_BASE_AGENTS },
    conventionStopQuorum: CONVENTION_STOP_BASE_AGENTS,
    // §4.1 promotion / §4.2 demotion ratio.
    consensusRatio: CONSENSUS_RATIO,
    // §4.3 hardening window and stable-break ratio.
    stableAfterDays: STABLE_DAYS,
    stableBreakRatio: STABLE_BREAK_RATIO,
    // §5 — credence as a projection. None of these gate a transition.
    credenceAsymptote: CREDENCE_ASYMPTOTE,
    assumesCollapseFactor: ASSUMES_COLLAPSE_FACTOR,
    buildsOnAttenuationFactor: BUILDS_ON_ATTENUATION_FACTOR,
    credenceFloor: CREDENCE_FLOOR,
    // §7.2 blast-radius reopen bar: this is the BASE; the served value plus
    // floor(sqrt(dependents)) is what a challenge actually has to clear.
    reopenQuorumBase: CHALLENGE_REOPEN_VOTES,
    // §7.3 — enforced in seconds, advertised in days, converted rather than
    // retyped.
    challengeLapseDays: CHALLENGE_LAPSE_SECONDS / (24 * 60 * 60),
    // §2 / §6.2 — beyond the §9 table, both derived from consensus-gate.ts.
    verifiedSet: advertisedVerifiedSet(),
    maxUnmetDependenciesForPromotion: maxUnmetDependenciesForPromotion(),
    // §8 — what a quorum counts. The KG already publishes this block on its
    // stats surface; the profile serves the same function's output.
    independence: publicIndependenceProfile().independenceClasses,
  };
}

/**
 * §15.1 `capabilities`.
 *
 * The three §25 flags are imported from the module that enforces them. The
 * rest are declared explicitly — including every `false` — because silence
 * on a well-known flag reads as "unknown", and unknown is where a generous
 * inference goes. `structuredNegotiation` and `inviteTokens` are the two
 * `true`s the KG earns from served routes, and `pact-profile.test.ts` holds
 * them to those routes existing.
 */
export function advertisedCapabilities(): Record<string, boolean> {
  return {
    // §13 — no mediator surface exists.
    mediatedCommunication: false,
    // No classification / clearance / graduated-disclosure model exists.
    informationBarriers: false,
    // §10 primitives: intents, constraints, salience, dependencies,
    // assumptions are all served.
    structuredNegotiation: true,
    // Minted on topic creation, redeemed and exhausted at
    // POST /api/pact/{topicId}/join-token.
    inviteTokens: true,
    // §17.6 / §17.7 — the KG verifies no proof.
    authorizationProof: AUTHORIZATION_PROOF_SUPPORTED,
    // §25.6 — the fail-closed guard runs on every apply path in db.ts.
    applyGuard: APPLY_GUARD_ENFORCED,
    // §25.8 — false, and no executionSystem is advertised alongside it.
    executionCapability: EXECUTION_CAPABILITY,
    // §17.15 — no recovery or operator-transfer ceremony.
    agentIdentityTransfer: false,
    didDocumentPinning: false,
    atomicOnboard: false,
    manifest: false,
    sessionAwareness: false,
    matters: false,
    mandates: false,
    parleys: false,
    pushDelivery: false,
  };
}

/** §6.3 / §15.1 `retentionPolicy`. */
export interface RetentionPolicy {
  readonly minimumDays: number;
  readonly indefinite: boolean;
  readonly tombstoneAfter: number | null;
}

/**
 * Observed retention, not promised retention.
 *
 * `indefinite: true` records that the implementation holds no purge, expiry
 * or tombstone path for the event log — the honest reading of the code, and
 * the reason the matching declared gap says a policy does not exist.
 * `minimumDays: 0` refuses to invent a floor nothing enforces.
 */
export const RETENTION_POLICY: RetentionPolicy = {
  minimumDays: 0,
  indefinite: true,
  tombstoneAfter: null,
};

/** The served §15.1 document. */
export interface PactImplementationProfile {
  readonly name: string;
  readonly version: string;
  readonly specVersion: string;
  readonly conformanceLevel: string;
  readonly resourceTypes: AdvertisedResourceType[];
  readonly retentionPolicy: RetentionPolicy;
  readonly capabilities: Record<string, boolean>;
  readonly endpoints: Record<string, string>;
  readonly extensions: Record<string, unknown>;
  readonly declaredGaps: DeclaredGap[];
}

/**
 * Build the profile. Pure: no request, no clock, no database — so the
 * document is identical for every caller and safe to cache, and so this is
 * directly assertable from a test without a server.
 */
export function buildPactProfile(baseUrl: string = PUBLIC_BASE_URL): PactImplementationProfile {
  const origin = baseUrl.replace(/\/+$/, "");
  const unadvertisable = unadvertisableResourceTypes();

  return {
    name: PROFILE_NAME,
    version: IMPLEMENTATION_VERSION,
    specVersion: SPEC_VERSION,
    conformanceLevel: CONFORMANCE_LEVEL,
    resourceTypes: advertisedResourceTypes(),
    retentionPolicy: RETENTION_POLICY,
    capabilities: advertisedCapabilities(),
    endpoints: {
      rest: `${origin}/api/pact`,
      wellKnown: `${origin}/.well-known/pact.json`,
      // §15.1 asks for `realtime`; the KG has no hub, so it advertises the
      // poll surface it does serve instead of a socket it does not.
      poll: `${origin}/api/pact/{topicId}/events`,
    },
    extensions: {
      [EPISTEMICS_EXTENSION]: epistemicsAdvertisement(),
    },
    declaredGaps: [
      ...DECLARED_GAPS,
      // Present only if the §25.6 filter above actually dropped something —
      // the day a guarded type is registered, the profile says so rather
      // than quietly shrinking.
      ...(unadvertisable.length > 0
        ? [
            {
              area: "§25.6 unadvertisable resource types",
              statement:
                `The registry carries ${unadvertisable.join(", ")}, whose apply guard ` +
                "this implementation cannot enforce, so the type is withheld " +
                "from resourceTypes rather than advertised unenforced.",
            },
          ]
        : []),
    ],
  };
}
