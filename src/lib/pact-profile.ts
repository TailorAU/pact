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
 *  - `retentionPolicy` is DERIVED from `retention.ts` (#5598) — the pure
 *    module the purge statement itself is built from. Switch the purge off,
 *    change its bound, or convert it to a tombstone, and the advertisement
 *    moves without anyone editing this file. Before #5598 it was three
 *    typed literals that had been false on the live wire for as long as the
 *    daily 30-day `DELETE FROM events` had existed.
 *  - The positive §6.4 claims in {@link provenanceAdvertisement} come from
 *    `provenance-chain.ts` — the module that writes the chain — so the hash
 *    algorithm and genesis vocabulary a third-party verifier needs cannot be
 *    advertised as something the writer does not stamp.
 *
 * ## What this profile does NOT claim
 *
 * {@link DECLARED_GAPS} is not decoration. The KG has no §17.4 principal
 * registry and no §13 mediation surface, and the honest thing is to name
 * those on the same wire that carries the claim rather than to pick a
 * conformance word that quietly implies them. See {@link CONFORMANCE_LEVEL}
 * for the reasoning behind `core`.
 *
 * A gap entry is RETIRED AND REPLACED, never deleted, when the thing it
 * described changes. The §6.4 entry used to deny that a provenance chain
 * existed; #5566/#5587 shipped one, so #5598 rewrote that entry to say what
 * the chain still does NOT cover rather than dropping it and letting the
 * silence read as full coverage. Deleting a gap is the one edit that makes
 * this document quietly more generous than the code.
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
import {
  epistemicsEventMappingAdvertisement,
  epistemicsFieldMappingAdvertisement,
} from "./epistemics-mapping";
import { publicIndependenceProfile } from "./independence";
import { CHAIN_HASH_ALG, FIRST_SEQUENCE_NUMBER, GENESIS_SENTINELS } from "./provenance-chain";
import {
  PURGE_IS_TOMBSTONE,
  UNCHAINED_EVENTS_PURGED,
  UNCHAINED_EVENT_RETENTION_DAYS,
} from "./retention";

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
 * The absence of a §6.4 provenance chain USED to be given here as a third,
 * independent reason. It is not one any more: #5566/#5587 shipped gapless
 * `sequence_number`, `prev_hash`, `event_hash` and a verifier over them, so
 * #5598 removed the claim rather than leaving it standing. A stale reason
 * for an honest verdict is still a false statement on the wire, and it is
 * the kind that survives longest precisely because the verdict it supports
 * is right.
 *
 * The level does not move. Each of the two §15.2 shortfalls above is
 * independently sufficient to hold it at `core`, and what §6.4 still does
 * not cover is stated in {@link DECLARED_GAPS} instead of being smuggled in
 * as a level argument.
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
    // RETIRED AND REPLACED, not deleted (#5598). This entry used to say the
    // event log "assigns no gapless sequence number and no prev_hash".
    // #5566/#5587 shipped both, so the sentence became false on the wire.
    // Dropping the entry would have been worse than leaving it stale: an
    // absent gap reads as full coverage, and §6.4 coverage is exactly what
    // is still partial. What follows is what the chain does NOT reach.
    //
    // #5539 repointed `tracking` from #5598 — which CLOSED with the
    // genesis-evidence and retention repairs — to the OPEN trackers (a
    // `tracking` field naming a closed issue is a dangling pointer a reader
    // follows to a dead end). Shortfall (vi) — #5599's separate-transaction
    // finding — was RESOLVED 2026-09-01 by the PR-A/B/C series (#5692,
    // #5697, #5704): routes wrapped, sweep per-decision, and the emitEvent
    // interlock refusing an untransacted production client. `tracking` now
    // carries only #5650.
    area: "§6.4 event-log provenance",
    statement:
      "A §6.4 provenance chain EXISTS: every event written since #5566/#5587 " +
      "carries a gapless sequence_number, a prev_hash and an event_hash " +
      `under ${CHAIN_HASH_ALG}, ` +
      "and a consumer can re-derive the LINK structure of that chain from the " +
      "public events feed. Five shortfalls remain ((vi) resolved by #5599). (i) Rows written before " +
      "that change carry none of " +
      "those columns and sit outside the chain by construction; they are " +
      "declared by a genesis sentinel, never backfilled, because hashing " +
      "history nobody recorded would manufacture a chain that never existed. " +
      "(ii) No daily signed pact.log.root event, no pact-log-anchor/1 " +
      "transparency anchor and no cross-implementation root comparison are " +
      "published, so the chain can be re-derived but not pinned to any " +
      "external witness — a reader who does not trust this server has nothing " +
      "independent to check it against. (iii) The verifier has no production " +
      "caller: it is a module function with no route and no scheduled job, so " +
      "the server never checks its own chain, and a break would be observable " +
      "only to a third party re-deriving it. (iv) A resource whose unchained " +
      "history was destroyed by retention BEFORE the durable evidence marker " +
      "existed can carry a plain GENESIS that overstates what its chain " +
      "covers, and that CANNOT be corrected: prev_hash is bound into " +
      "event_hash, so rewriting the sentinel would change the hash — " +
      "fabrication, not repair. Item (iv) is permanent for any resource " +
      "already in that state. (v) Judging a GENESIS sentinel is NOT fully " +
      "re-derivable from the feed. Since #5598 a plain GENESIS is refuted by " +
      "a surviving unchained row OR by a durable server-side latch recording " +
      "that a resource's unchained history was destroyed, and that latch is " +
      "not published on any endpoint. A third party therefore evaluates the " +
      "weaker of the two tests: it can confirm every hash link, and it can " +
      "refute a GENESIS that live rows contradict, but where the rows are " +
      "already gone it cannot distinguish a resource that truly had no " +
      "pre-history from one whose pre-history was purged. The divergence is " +
      "one-directional — an external verifier can MISS a break the server " +
      "would report, never invent one — so a third-party 'intact' is a weaker " +
      "claim than this server's, not a contradicting one. GENESIS-UNCHAINED " +
      "is unaffected: it is a weak claim that no absence can refute, so the " +
      "latch never changes its verdict. Former shortfall (vi) — the chain " +
      "link committing in a transaction of its own — is RESOLVED (#5599, " +
      "2026-09-01): every production write path now assigns the link in the " +
      "same transaction as the state change it records (routes wrapped, the " +
      "consensus sweep per-decision, and emitEvent itself now REFUSES a " +
      "production client outside a transaction rather than opening one), " +
      "with a static walker over every emit site guarding regressions. " +
      "Open tracker: TailorAU/tailor-app#5650 for the signed root, " +
      "transparency anchor and cross-implementation root comparison in (ii).",
    tracking: "TailorAU/tailor-app#5650",
  },
  {
    // Rewritten in #5598. The previous text asserted "the implementation
    // holds no purge, expiry or tombstone path for the event log" while a
    // daily hard DELETE ran against that log. What follows is the real
    // split, and the day-count is interpolated from the enforcing constant
    // so the prose cannot drift from the statement the purge is built with.
    area: "§6.3 retention policy",
    statement:
      "No WRITTEN retention policy exists; the advertised retentionPolicy " +
      "records observed behaviour, and that behaviour is split. Event rows " +
      "the §6.4 chain does not cover (sequence_number IS NULL — written " +
      "before #5566) are HARD-DELETED " +
      `${UNCHAINED_EVENT_RETENTION_DAYS} days after creation by the daily ` +
      "cleanup job: deleted outright, not tombstoned in place, so the " +
      "row and its payload are gone rather than marked. CHAINED rows are " +
      "retained indefinitely — §6.4 forbids deleting one, because a missing " +
      "sequence number punches a permanent gap every verifier correctly " +
      "reads as tampering. minimumDays therefore advertises the " +
      `${UNCHAINED_EVENT_RETENTION_DAYS}-day bound the purge actually ` +
      "enforces rather than the 0 it advertised " +
      "before #5598, and indefinite is false. Scope: this describes the " +
      "events log only. The same cleanup route also deletes resolved " +
      "proposals and departed registrations on their own 90-day schedules, " +
      "and exhausted invite tokens with no time bound; none of that is " +
      "described by this retentionPolicy.",
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
    // RETIRED AND REPLACED, not deleted (#5564/#5565). The previous entry
    // ended "the mapping is not published yet" — the mapping IS published
    // now, as data: extensions["au.tailor.pact/epistemics"].eventMapping is
    // derived from PACT_EVENT_MAP (epistemics-mapping.ts), the same table
    // emitEvent's type parameter is narrowed against, so an op the map does
    // not classify cannot be emitted at all. Dropping this entry outright
    // would let its absence read as full §10 coverage, and coverage is
    // exactly what is still partial. What follows is what the mapping does
    // NOT close.
    area: "au.tailor.pact/epistemics §10 events",
    statement:
      "Transitions stay recorded under the KG's product event names, and the " +
      "declared mapping the extension requires for that IS now published — " +
      'extensions["au.tailor.pact/epistemics"].eventMapping in this document ' +
      "declares every emitted op against its pact.epistemics.* counterpart " +
      "or as out of the extension's scope with a stated reason. Two " +
      "shortfalls remain. (i) pact.epistemics.challenge-reopened has NO " +
      "emitter: when a challenge meets its §7.2 reopen quorum the KG emits " +
      "the SAME product op (pact.consensus.challenged) it emits when a " +
      "challenge is filed, so reopen and filing are not distinguishable by " +
      "event type, and the mapping declares the reopen unimplemented rather " +
      "than aliasing an ambiguous op to it. (ii) The §10 SHOULD on payload " +
      "contents (ratio, aligned/dissenting counts, required quorum, " +
      "unmet-dependency count, defeater type, reopen votes " +
      "required/gathered, in every payload) has not been audited against " +
      "the emitters — each payload carries what its emitter recorded, which " +
      "may be less than that list.",
    tracking: "TailorAU/tailor-app#5565",
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
    // §10 (#5565) — the declared event mapping: product op names stay on the
    // wire (grandfathering), and this block is what makes the event stream
    // readable to a conformant consumer. Derived by inverting
    // PACT_EVENT_MAP — the table emitEvent's own type parameter is narrowed
    // against — so the advertisement cannot disagree with the emitters.
    eventMapping: epistemicsEventMappingAdvertisement(),
    // #5564 — extension term → wire field → route, with the lossy 8→4
    // tier→warrantKind collapse declared rather than left to inference.
    fieldMapping: epistemicsFieldMappingAdvertisement(),
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
 * Observed retention, DERIVED from the module that enforces it (#5598).
 *
 * Until #5598 this was three typed literals — `{ minimumDays: 0, indefinite:
 * true, tombstoneAfter: null }` — served over a cleanup job that had been
 * running `DELETE FROM events … INTERVAL '30 days'` nightly. The doc comment
 * here said "the implementation holds no purge, expiry or tombstone path for
 * the event log" and the declared gap repeated it. Both were false, and the
 * guard meant to catch it grepped `db.ts`, which has never held the DELETE.
 *
 * So no field below is typed. Each reads the constant `retention.ts` builds
 * the purge statement from: switch the purge off and `indefinite` goes true
 * by itself, convert it to a tombstone and `tombstoneAfter` fills in, change
 * the bound and `minimumDays` follows. Drifting the advertisement now
 * requires editing the enforcement, which is the whole discipline of this
 * module applied to the one value that had escaped it.
 *
 * `minimumDays` is a true floor for the WHOLE log, not just the purged part:
 * unchained rows live at least {@link UNCHAINED_EVENT_RETENTION_DAYS} days,
 * and chained rows are never deleted at all
 * (`CHAINED_EVENTS_RETAINED_INDEFINITELY`). `indefinite` is false because it
 * asks whether the log as a whole is kept forever, and one half of it is not.
 *
 * `retention.ts` is deliberately the seam. It is pure and imports nothing, so
 * deriving from it costs this module none of its no-database property;
 * importing `cron/cleanup/route.ts` instead would drag in
 * `export const dynamic` and `getDb()` and destroy exactly that.
 */
export const RETENTION_POLICY: RetentionPolicy = {
  minimumDays: UNCHAINED_EVENT_RETENTION_DAYS,
  indefinite: !UNCHAINED_EVENTS_PURGED,
  tombstoneAfter: PURGE_IS_TOMBSTONE ? UNCHAINED_EVENT_RETENTION_DAYS : null,
};

/**
 * The §6.4 parameters a third party needs in order to re-derive this store's
 * chain — every one of them imported from `provenance-chain.ts`, the module
 * that writes it.
 *
 * This block exists so the profile's POSITIVE §6.4 claims are derivable from
 * the writer rather than asserted in prose. §6.4 requires a consumer to be
 * able to REJECT a row whose hash algorithm it does not recognise instead of
 * skipping verification, which it can only do if the algorithm identifier is
 * on the wire; and the genesis vocabulary has to be published or a verifier
 * cannot tell a declared start from a missing link.
 *
 * `signedRoot` and `transparencyAnchor` are declared `false` rather than
 * omitted, for the same reason {@link advertisedCapabilities} declares every
 * `false`: silence on a well-known §6.4 mechanism reads as "unknown", and
 * unknown is where a generous inference goes. Together they are item (ii) of
 * the §6.4 declared gap, stated twice on purpose — once as a
 * machine-readable flag, once in prose.
 */
export interface ProvenanceAdvertisement {
  /** Hash-algorithm identifier stamped on every chained row. */
  readonly hashAlg: string;
  /** §6.4 lets a store start at 0 or 1; this is the one it applies uniformly. */
  readonly firstSequenceNumber: number;
  /** Every `prev_hash` literal a first chained event may legitimately carry. */
  readonly genesisSentinels: string[];
  /** No daily signed `pact.log.root` is published. */
  readonly signedRoot: boolean;
  /** No `pact-log-anchor/1` external anchor is published. */
  readonly transparencyAnchor: boolean;
}

/**
 * Build the §6.4 block. `genesisSentinels` is spread, never referenced, so a
 * served document can never alias the live array — the same rule the
 * epistemics `tiers` block follows.
 */
export function provenanceAdvertisement(): ProvenanceAdvertisement {
  return {
    hashAlg: CHAIN_HASH_ALG,
    firstSequenceNumber: FIRST_SEQUENCE_NUMBER,
    genesisSentinels: [...GENESIS_SENTINELS],
    signedRoot: false,
    transparencyAnchor: false,
  };
}

/** The served §15.1 document. */
export interface PactImplementationProfile {
  readonly name: string;
  readonly version: string;
  readonly specVersion: string;
  readonly conformanceLevel: string;
  readonly resourceTypes: AdvertisedResourceType[];
  readonly retentionPolicy: RetentionPolicy;
  readonly provenance: ProvenanceAdvertisement;
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
    provenance: provenanceAdvertisement(),
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
