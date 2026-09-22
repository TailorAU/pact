/**
 * The declared `au.tailor.pact/epistemics` mappings (#5564 / #5565,
 * epic #5488) — events (§10) and field names, as DATA the emitters and the
 * served profile both index into.
 *
 * ## Why this module exists
 *
 * The extension (`TailorAU/pact` docs/extensions/epistemics.md) defines a
 * `pact.epistemics.*` event vocabulary (§10) and a field vocabulary (tier,
 * consensus state, credence, defeater types, convention_stop). The KG
 * implements the SEMANTICS but records transitions under its own product op
 * names (`pact.topic.consensus-reached`, `pact.stable.broken`, …) and serves
 * fields under its own product names (`warrantKind`, `state`). §10 permits
 * exactly that — "implementations MAY emit these semantics under existing
 * product event names, but MUST then declare the mapping". This module IS
 * that declaration, published as data rather than prose:
 *
 *  - {@link PACT_EVENT_MAP} classifies EVERY op `emitEvent` can emit —
 *    either against its `pact.epistemics.*` counterpart or explicitly
 *    out of the extension's scope with a stated reason. `emitEvent`'s
 *    `type` parameter is narrowed to {@link EmittedPactOp}, so an op with
 *    no declared classification is a COMPILE error, not a silent gap.
 *  - {@link EPISTEMICS_FIELD_MAP} declares extension term → wire field →
 *    route, including the lossy 8→4 tier→warrantKind collapse (#5564).
 *  - Both render into the served `/.well-known/pact.json` under
 *    `extensions["au.tailor.pact/epistemics"]` (`eventMapping` /
 *    `fieldMapping`) — additive; no existing event name or wire field
 *    changes. Renaming ops on the wire is precisely what the wave's
 *    grandfathering rule forbids; mapping is the escape hatch it permits.
 *
 * ## The hard constraint: ZERO database imports
 *
 * `db.ts` imports {@link EmittedPactOp} (type-only) and `pact-profile.ts`
 * imports the advertisement builders, so this module MUST NOT import from
 * `./db`, `pg`, `next/*` or anything under `src/app/` — the same one-way
 * discipline `retention.ts` documents. String literals only.
 */

/** The seven §10 event types the extension requires (epistemics.md §10). */
export const EPISTEMICS_EVENTS = [
  "pact.epistemics.promoted",
  "pact.epistemics.demoted",
  "pact.epistemics.verified",
  "pact.epistemics.blocked-by-dependencies",
  "pact.epistemics.challenge-filed",
  "pact.epistemics.challenge-reopened",
  "pact.epistemics.challenge-lapsed",
] as const;

export type EpistemicsEventName = (typeof EPISTEMICS_EVENTS)[number];

/** A product op that records a §10 transition, declared against it. */
export interface EpistemicsMappedOp {
  readonly scope: "epistemics";
  readonly event: EpistemicsEventName;
  /** Caveat a conformant consumer needs (e.g. an ambiguous shared op). */
  readonly note?: string;
}

/** A product op the extension's §10 vocabulary does not describe. */
export interface OutOfExtensionOp {
  readonly scope: "out-of-extension";
  readonly reason: string;
}

export type PactEventClassification = EpistemicsMappedOp | OutOfExtensionOp;

// Shared reasons, named once so the map below stays legible.
const PRE_OPEN_GOVERNANCE =
  "Pre-open topic-proposal governance (#5425 approval voting). The §10 vocabulary " +
  "starts at the §4 promotion machinery; a topic that has not opened has no " +
  "consensus state to transition.";
const CORE_PROPOSAL_FLOW =
  "Core proposal lifecycle (spec §10/§12), not an epistemics §4/§7 state transition.";
const CORE_COORDINATION =
  "Core coordination/negotiation primitive (join/intent/constraint/salience/" +
  "escalation/done), not an epistemics §4/§7 state transition.";
const DEPENDENT_FANOUT =
  "Dependent-notification fan-out: emitted on a DEPENDENT when one of its " +
  "dependencies is defeated or challenged. §10 defines no dependent-notification " +
  "event; the dependent's own transition, when the §6.2 gate forces one, is " +
  "recorded separately (pact.dependency.assumption-defeated / pact.consensus.broken).";
const ECONOMY_LAYER =
  "Incentive/economy layer (stakes, bounties), outside the extension's scope.";
const LEGISLATION_INGEST =
  "Legislation-instrument ingest workflow (au.tailor.pact.legislation-instrument " +
  "quorum path), not a topic consensus-state transition.";

/**
 * The single classification table: EVERY op name `emitEvent` can emit, keyed
 * verbatim. `emitEvent`'s `type` parameter is {@link EmittedPactOp} =
 * `keyof typeof PACT_EVENT_MAP`, so emitting an op absent from this table is
 * a compile error — the #5565 "adding an unmapped event breaks the build"
 * requirement, enforced by the typechecker rather than a runtime lookup.
 */
export const PACT_EVENT_MAP = {
  // ── §4.1 promotion ────────────────────────────────────────────────
  "pact.topic.consensus-reached": {
    scope: "epistemics",
    event: "pact.epistemics.promoted",
  },
  "pact.consensus.blocked-by-dependencies": {
    scope: "epistemics",
    event: "pact.epistemics.blocked-by-dependencies",
  },
  // ── §4.2 / §4.3 demotion — every product op that moves a topic OUT of
  //    `aligned`/`verified` maps to the one §10 demotion event. ─────────
  "pact.consensus.broken": {
    scope: "epistemics",
    event: "pact.epistemics.demoted",
  },
  "pact.stable.broken": {
    scope: "epistemics",
    event: "pact.epistemics.demoted",
  },
  "pact.dependency.assumption-defeated": {
    scope: "epistemics",
    event: "pact.epistemics.demoted",
    note:
      "The §6.2(2) consequence: a defeated `assumes` premise forces the " +
      "dependent out of the verified set to contested.",
  },
  "pact.topic.challenged": {
    scope: "epistemics",
    event: "pact.epistemics.demoted",
    note:
      "Maintenance re-verification (POST /api/pact/{topicId}/verify) found the " +
      "instrument amended/repealed and moved a verified topic to contested.",
  },
  // ── §4.3 hardening ────────────────────────────────────────────────
  "pact.topic.stable": {
    scope: "epistemics",
    event: "pact.epistemics.verified",
  },
  // ── §7 challenges ─────────────────────────────────────────────────
  "pact.consensus.challenged": {
    scope: "epistemics",
    event: "pact.epistemics.challenge-filed",
    note:
      "AMBIGUOUS SHARED OP: also emitted when a challenge meets its §7.2 reopen " +
      "quorum (evaluateChallenges), so a consumer cannot distinguish reopen from " +
      "filing by event type alone — which is why pact.epistemics.challenge-reopened " +
      "is declared unimplemented rather than mapped here.",
  },
  "pact.challenge.lapsed": {
    scope: "epistemics",
    event: "pact.epistemics.challenge-lapsed",
  },
  "pact.challenge.dismissed-vexatious": {
    scope: "epistemics",
    event: "pact.epistemics.challenge-lapsed",
    note: "The §7.3 vexatious branch: lapse plus stake forfeiture.",
  },
  // ── Pre-open topic-proposal governance (#5425) ────────────────────
  "pact.topic.proposed": { scope: "out-of-extension", reason: PRE_OPEN_GOVERNANCE },
  "pact.topic.approved": { scope: "out-of-extension", reason: PRE_OPEN_GOVERNANCE },
  "pact.topic.rejected": { scope: "out-of-extension", reason: PRE_OPEN_GOVERNANCE },
  "pact.topic.vote.approve": { scope: "out-of-extension", reason: PRE_OPEN_GOVERNANCE },
  "pact.topic.vote.reject": { scope: "out-of-extension", reason: PRE_OPEN_GOVERNANCE },
  "pact.topic.vote.need_info": { scope: "out-of-extension", reason: PRE_OPEN_GOVERNANCE },
  // ── Maintenance / freshness ───────────────────────────────────────
  "pact.topic.re-verified": {
    scope: "out-of-extension",
    reason:
      "Maintenance re-verification refreshed last_verified_at without any " +
      "consensus-state transition; §10 records transitions only.",
  },
  "pact.topic.stale": {
    scope: "out-of-extension",
    reason:
      "Product-level freshness marking (cron staleness sweep); no consensus-state " +
      "transition and no §10 counterpart.",
  },
  // ── Core proposal lifecycle ───────────────────────────────────────
  "pact.proposal.created": { scope: "out-of-extension", reason: CORE_PROPOSAL_FLOW },
  "pact.proposal.approved": { scope: "out-of-extension", reason: CORE_PROPOSAL_FLOW },
  "pact.proposal.rejected": { scope: "out-of-extension", reason: CORE_PROPOSAL_FLOW },
  "pact.proposal.objected": { scope: "out-of-extension", reason: CORE_PROPOSAL_FLOW },
  "pact.proposal.merged": { scope: "out-of-extension", reason: CORE_PROPOSAL_FLOW },
  "pact.proposal.auto-merged": { scope: "out-of-extension", reason: CORE_PROPOSAL_FLOW },
  // ── Core coordination / structured negotiation ────────────────────
  "pact.agent.joined": { scope: "out-of-extension", reason: CORE_COORDINATION },
  "pact.agent.done": { scope: "out-of-extension", reason: CORE_COORDINATION },
  "pact.agent.vote-changed": { scope: "out-of-extension", reason: CORE_COORDINATION },
  "pact.intent.declared": { scope: "out-of-extension", reason: CORE_COORDINATION },
  "pact.constraint.published": { scope: "out-of-extension", reason: CORE_COORDINATION },
  "pact.salience.updated": { scope: "out-of-extension", reason: CORE_COORDINATION },
  "pact.escalation.created": { scope: "out-of-extension", reason: CORE_COORDINATION },
  "pact.assumptions.declared": { scope: "out-of-extension", reason: CORE_COORDINATION },
  // ── §6 link lifecycle + dependent fan-out ─────────────────────────
  "pact.dependency.declared": {
    scope: "out-of-extension",
    reason:
      "§6 link-lifecycle bookkeeping. §10 defines no link-creation event; the " +
      "link's CONSEQUENCES (gate blockage, forced demotion) are the mapped " +
      "transitions.",
  },
  "pact.dependency.removed": {
    scope: "out-of-extension",
    reason: "§6 link-lifecycle bookkeeping; §10 defines no link-removal event.",
  },
  "pact.dependency.unstable": { scope: "out-of-extension", reason: DEPENDENT_FANOUT },
  "pact.dependency.challenged": { scope: "out-of-extension", reason: DEPENDENT_FANOUT },
  // ── §25.6 apply guard ─────────────────────────────────────────────
  "pact.apply.blocked": {
    scope: "out-of-extension",
    reason:
      "Core §25.6 apply-guard refusal (effect-class.ts): the promotion was " +
      "epistemically eligible but the apply guard held. Not a §10 transition — " +
      "no consensus state changed.",
  },
  // ── Legislation ingest ────────────────────────────────────────────
  "pact.legislation.proposed": { scope: "out-of-extension", reason: LEGISLATION_INGEST },
  "pact.legislation.ingested": { scope: "out-of-extension", reason: LEGISLATION_INGEST },
  // ── Economy ───────────────────────────────────────────────────────
  "pact.bounty.posted": { scope: "out-of-extension", reason: ECONOMY_LAYER },
  "pact.bounty.distributed": { scope: "out-of-extension", reason: ECONOMY_LAYER },
  "pact.bounty.legacy-split-seeded": { scope: "out-of-extension", reason: ECONOMY_LAYER },
} as const satisfies Record<string, PactEventClassification>;

/**
 * The op-name union `emitEvent` accepts. An op absent from
 * {@link PACT_EVENT_MAP} cannot be emitted — declaring the classification IS
 * the price of adding an event, by construction.
 */
export type EmittedPactOp = keyof typeof PACT_EVENT_MAP;

/**
 * §10 events the KG emits NO op for, each with the reason stated. Declared
 * here — and rendered into both the served eventMapping and the profile's
 * declared gaps — instead of being left to inference.
 */
export const UNIMPLEMENTED_EPISTEMICS_EVENTS: Partial<Record<EpistemicsEventName, string>> = {
  "pact.epistemics.challenge-reopened":
    "No distinct product op records the §7.2 reopen: when a challenge meets its " +
    "blast-radius quorum, evaluateChallenges emits the SAME op " +
    "(pact.consensus.challenged) the filing path emits, so reopen and filing are " +
    "not distinguishable by event type. Mapping that shared op to " +
    "challenge-reopened as well would declare an ambiguity as a mapping; the " +
    "honest declaration is unimplemented. A distinct reopen op is a wire " +
    "addition tracked with the extension's DRAFT status.",
};

/** One §10 event's entry in the served eventMapping. */
export type EpistemicsEventMappingEntry =
  | { readonly productOps: EmittedPactOp[]; readonly note?: string }
  | { readonly unimplemented: string };

/**
 * The served §10 `eventMapping` block — DERIVED by inverting
 * {@link PACT_EVENT_MAP} (plus {@link UNIMPLEMENTED_EPISTEMICS_EVENTS}), so
 * the advertisement structurally cannot disagree with the classification the
 * emitters are typed against. Fresh arrays per call; a served document never
 * aliases module state.
 */
export function epistemicsEventMappingAdvertisement(): Record<
  EpistemicsEventName,
  EpistemicsEventMappingEntry
> {
  const out = {} as Record<EpistemicsEventName, EpistemicsEventMappingEntry>;
  for (const eventName of EPISTEMICS_EVENTS) {
    const unimplemented = UNIMPLEMENTED_EPISTEMICS_EVENTS[eventName];
    if (unimplemented) {
      out[eventName] = { unimplemented };
      continue;
    }
    const productOps: EmittedPactOp[] = [];
    const notes: string[] = [];
    for (const op of Object.keys(PACT_EVENT_MAP) as EmittedPactOp[]) {
      const classification: PactEventClassification = PACT_EVENT_MAP[op];
      if (classification.scope !== "epistemics" || classification.event !== eventName) continue;
      productOps.push(op);
      if (classification.note) notes.push(`${op}: ${classification.note}`);
    }
    out[eventName] = {
      productOps,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  }
  return out;
}

// ── #5564 — field-name mapping ──────────────────────────────────────

/** One extension term's wire location. */
export interface EpistemicsFieldMapping {
  /** The extension document's term (or §9 parameter name). */
  readonly extensionTerm: string;
  /** The field the KG serves it under. */
  readonly wireField: string;
  /** Where on the wire it appears. */
  readonly routes: readonly string[];
  /** Collapses, legacy values, null semantics — anything lossy or partial. */
  readonly note?: string;
}

/**
 * Extension term → KG wire field → route (#5564). Product names stay on the
 * wire (grandfathering); this table is what makes them consumable against
 * the extension's vocabulary. Rendered into the served profile as
 * `fieldMapping`.
 */
export const EPISTEMICS_FIELD_MAP: readonly EpistemicsFieldMapping[] = [
  {
    extensionTerm: "tier",
    wireField: "tier",
    routes: [
      "GET /api/pact/topics",
      "GET /api/pact/topics/{topicId}",
      "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)",
    ],
    note:
      "The stored source column served verbatim — the extension's 8-value §3 " +
      "vocabulary. The adjacent wire field `warrantKind` is the product's LOSSY " +
      "4-value collapse of the same column (empirical/institutional/interpretive/" +
      "conjectural via TIER_TO_WARRANT in epistemic.ts) — 8 tiers to 4 kinds — so " +
      "`tier`, not `warrantKind`, is the extension-vocabulary field. Rows written " +
      "before tier canonicalization may carry legacy spellings (axiom, convention, " +
      "practice, policy, frontier); warrantKindFromTier reads all of them.",
  },
  {
    extensionTerm: "consensusState",
    wireField: "state",
    routes: [
      "GET /api/pact/topics",
      "GET /api/pact/topics/{topicId}",
      "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)",
    ],
    note:
      "consensusStateFor maps the internal status column (proposed/open/challenged/" +
      "consensus/stable/locked/rejected) onto the §2 vocabulary (proposed/open/" +
      "contested/aligned/verified/rejected) verbatim on every protocol surface.",
  },
  {
    extensionTerm: "credence",
    wireField: "credence",
    routes: [
      "GET /api/pact/topics",
      "GET /api/pact/topics/{topicId}",
      "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)",
    ],
    note:
      "The stored §5.2 effective credence once the sweep has written it, else the " +
      "§5.1 transform credenceFromRatio(consensus_ratio). NULL-safe for rows " +
      "written before the change: a null stored credence over a null ratio derives " +
      "0, never a 500. The raw ratio rides alongside as consensus_ratio, never " +
      "clamped. Credence gates nothing (§5.3).",
  },
  {
    extensionTerm: "defeaterType",
    wireField: "defeaterType",
    routes: [
      "GET /api/pact/{topicId}/proposals (challenge rows)",
      "GET /api/pact/topics/{topicId} (embedded proposals)",
      "GET /api/pact/{topicId}/dependencies (frontier.reopen.defeaterTypes — the six §7.1 values)",
    ],
    note:
      "One of the six §7.1 typed defeaters; null on proposals filed before typed " +
      "defeaters existed (#3691 W4) — grandfathered, never backfilled.",
  },
  {
    extensionTerm: "convention_stop",
    wireField: "conventionStop",
    routes: [
      "GET /api/pact/topics",
      "GET /api/pact/topics/{topicId}",
      "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)",
    ],
    note:
      "The §3.3 agreement-to-stop flag, served as a boolean over the stored " +
      "integer column.",
  },
  {
    extensionTerm: "conventionStopQuorum",
    wireField: 'extensions["au.tailor.pact/epistemics"].conventionStopQuorum',
    routes: ["GET /.well-known/pact.json"],
    note:
      "A §9 profile parameter, not a per-topic field — served from " +
      "CONVENTION_STOP_BASE_AGENTS, the constant the sweep enforces.",
  },
  {
    extensionTerm: "requiredReopenVotes (§7.2)",
    wireField: "reopen.requiredSupportVotes",
    routes: [
      "GET /api/pact/{topicId}/dependencies (frontier.reopen)",
      "GET /api/pact/{topicId}/proposals (challenge rows, reopen block)",
    ],
    note:
      "reopenQuorumBase + floor(sqrt(dependentCount)) — computed by the same " +
      "requiredReopenVotes binding evaluateChallenges enforces.",
  },
];

/** The served `fieldMapping` block — fresh copies, never module aliases. */
export function epistemicsFieldMappingAdvertisement(): EpistemicsFieldMapping[] {
  return EPISTEMICS_FIELD_MAP.map((entry) => ({ ...entry, routes: [...entry.routes] }));
}
