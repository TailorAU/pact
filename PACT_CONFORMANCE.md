# Source — PACT Conformance Profile

> **Implementation:** Source — the PACT knowledge graph (`pact.tailor.au`)
> **Resource Type:** `fact`
> **PACT Spec Version:** v2.3
> **Conformance Level:** Core
> **Date:** version and level re-derived from the served wire 2026-09-01
> (#5539); capability / endpoint / threshold content re-derived from the
> implementation 2026-08-29 (#5541).

> **What backs the version and level.** Wire-derived, not asserted: the live
> discovery document — `GET https://pact.tailor.au/.well-known/pact.json`,
> generated per request by `buildPactProfile()` in `src/lib/pact-profile.ts`
> from the constants the implementation enforces — served
> `"specVersion": "2.3"` and `"conformanceLevel": "core"` when probed on
> 2026-09-01 (HTTP 200, `Date: Tue, 01 Sep 2026 04:55:28 GMT`). Those values
> are `SPEC_VERSION` / `CONFORMANCE_LEVEL`, the constants
> [#5563](https://github.com/TailorAU/tailor-app/issues/5563) wired to the
> wire, and the claim is *executed* on every `npm test` rather than merely
> stated: `src/lib/pact-conformance-profile.test.ts` pins the two header
> lines above AND the JSON block below to the builder's served values, so
> the wire cannot move without this file moving, and this file cannot claim
> what the wire does not serve. Naming v2.3 says WHICH spec text this
> profile answers to — the version whose vector set is under audit
> (`TailorAU/pact` `spec/v2.3/conformance/`) — never that all of it is met:
> what is NOT met is declared explicitly, in the seven `declaredGaps` the
> served document carries in full (§15.2 Extended is not claimed, §17
> authorization is not claimed, and the §6.4 shortfalls are enumerated on
> the wire). The previous revision
> ([#5541](https://github.com/TailorAU/tailor-app/issues/5541)) deliberately
> left v1.1 / Core standing behind stale markers, because re-deriving them
> without this evidence would have been an unevidenced upgrade;
> [#5539](https://github.com/TailorAU/tailor-app/issues/5539) closes that.

> **This profile is drift-gated.** `src/lib/pact-conformance-profile.test.ts`
> parses the JSON block below and compares it key-for-key, at every depth,
> against `buildPactProfile()`; walks `src/app/api/pact/` for every route file
> **and the HTTP methods each module exports**; and reads the consensus
> constants out of `src/lib/db.ts`, `src/lib/consensus-gate.ts`,
> `src/lib/independence.ts` and `src/lib/effect-class.ts`. Adding a route,
> deleting one, changing a route's methods, flipping a capability, or moving a
> threshold without updating this file **fails `npm test`**.

---

## Implementation Profile

The block below **is the served `GET /.well-known/pact.json` document**, built
by `buildPactProfile()` in `src/lib/pact-profile.ts`, reproduced here with
one departure and no others. It is declared, and it is enforced by the drift
gate rather than promised:

1. **`declaredGaps[].statement` is abridged away.** The seven statements run
   to roughly 5 KB of prose and are served in full on the wire; duplicating
   them here would give one claim three renderings to drift between. Each
   gap's `area` — and its `tracking`, where the wire carries one — is
   reproduced exactly. The gate asserts that this block states every gap's
   `area` in the served order, states `tracking` exactly as served, and
   states **no** `statement` at all, so an abridged entry can never become a
   wrong one. The two gaps that carry this profile's load, §6.3 retention and
   §6.4 provenance, are set out in full under
   § *Live discovery and gaps* below.

Every other key, at every depth — `specVersion` and `conformanceLevel`
included, since [#5539](https://github.com/TailorAU/tailor-app/issues/5539)
retired the deliberate v1.1 divergence #5541 had declared as a second
departure — is compared value-for-value against `buildPactProfile()` by
`src/lib/pact-conformance-profile.test.ts`, and any top-level key the builder
gains that this block does not carry fails that suite. The block is **not**
hand-maintained truth: it is a copy whose divergence from the generator is a
test failure.

```json
{
  "name": "Source",
  "version": "0.4.0",
  "specVersion": "2.3",
  "conformanceLevel": "core",
  "resourceTypes": [
    {
      "type": "fact",
      "fieldSchema": "claim:{id} — knowledge-claim identifier",
      "contentFormat": "application/json",
      "terminalStates": [
        "Verified",
        "Rejected"
      ],
      "applySemantics": "Knowledge claim promoted to a verified status in the KG's own graph, served to callers who pull it from the Axiom API. Reversible from the KG's own state: the consensus sweep demotes a promoted topic whose alignment, quorum or dependency gate stops holding.",
      "effectClass": "internal-reversible",
      "humanAttestation": "not-required"
    },
    {
      "type": "au.tailor.pact.topic",
      "fieldSchema": "sec:{slug} — topic sections (Question / Answer / Evidence …); the Answer section carries the canonical claim",
      "contentFormat": "text/markdown (topic sections) + application/json (claim metadata: tier, credence, dependency links)",
      "terminalStates": [
        "Verified"
      ],
      "applySemantics": "Merge into the topic's draft sections. Promotion of the topic itself (open → consensus → stable/locked) is NOT the apply — it is a separate, recomputed consensus sweep governed by the au.tailor.pact/epistemics extension: the per-tier quorum, alignment ratio and zero-unmet-dependency gate this profile advertises under that extension key. Verified is a RESTING state, re-openable through the challenge machinery, and a protocol state under §25.3 — never an assertion of truth.",
      "effectClass": "internal-reversible",
      "humanAttestation": "not-required"
    },
    {
      "type": "au.tailor.pact.legislation-instrument",
      "fieldSchema": "sec:{sectionId} — statutory section addressing within the instrument (act / part / division / section)",
      "contentFormat": "application/json",
      "terminalStates": [
        "Ingested"
      ],
      "applySemantics": "GRAPH INGEST ONLY. A structured legislation instrument is ingested into the KG's own graph after quorum verification against the official source, and can be corrected or withdrawn from that graph. Serving the graph's own public read API, where the record is still correctable, stays within this classification. Any apply that PUBLISHES the instrument to a third party, feeds a citation surface the KG cannot retract, or asserts the ingested text is the authoritative law is a DIFFERENT effect: external-irreversible with human attestation required (§25.5). The KG holds no such path. Ingested is a protocol state (§25.3) — not an assertion that the text is current, authoritative or legally effective.",
      "effectClass": "internal-reversible",
      "humanAttestation": "not-required"
    }
  ],
  "retentionPolicy": {
    "minimumDays": 30,
    "indefinite": false,
    "tombstoneAfter": null
  },
  "provenance": {
    "hashAlg": "sha256-jcs@1",
    "firstSequenceNumber": 1,
    "genesisSentinels": [
      "GENESIS",
      "GENESIS-UNCHAINED"
    ],
    "signedRoot": false,
    "transparencyAnchor": false
  },
  "capabilities": {
    "mediatedCommunication": false,
    "informationBarriers": false,
    "structuredNegotiation": true,
    "inviteTokens": true,
    "authorizationProof": false,
    "applyGuard": true,
    "executionCapability": false,
    "agentIdentityTransfer": false,
    "didDocumentPinning": false,
    "atomicOnboard": false,
    "manifest": false,
    "sessionAwareness": false,
    "matters": false,
    "mandates": false,
    "parleys": false,
    "pushDelivery": false
  },
  "endpoints": {
    "rest": "https://pact.tailor.au/api/pact",
    "wellKnown": "https://pact.tailor.au/.well-known/pact.json",
    "poll": "https://pact.tailor.au/api/pact/{topicId}/events"
  },
  "extensions": {
    "au.tailor.pact/epistemics": {
      "version": "1",
      "tiers": {
        "empirical": 3,
        "institutional": 3,
        "interpretive": 4,
        "conjecture": 5,
        "convention": 3,
        "practice": 3,
        "policy": 3,
        "frontier": 5
      },
      "conventionStopQuorum": 2,
      "consensusRatio": 0.9,
      "stableAfterDays": 30,
      "stableBreakRatio": 0.8,
      "credenceAsymptote": 0.99,
      "assumesCollapseFactor": 0.25,
      "buildsOnAttenuationFactor": 0.6,
      "credenceFloor": 0.02,
      "reopenQuorumBase": 3,
      "challengeLapseDays": 7,
      "verifiedSet": [
        "aligned",
        "verified"
      ],
      "maxUnmetDependenciesForPromotion": 0,
      "independence": {
        "version": 1,
        "counting": "class-v1",
        "minAccountAgeDays": 7,
        "minAcceptedContributions": 2,
        "allowSelfApproval": false,
        "grandfatherCutoff": "2026-08-28T00:00:00Z"
      },
      "eventMapping": {
        "pact.epistemics.promoted": {
          "productOps": [
            "pact.topic.consensus-reached"
          ]
        },
        "pact.epistemics.demoted": {
          "productOps": [
            "pact.consensus.broken",
            "pact.stable.broken",
            "pact.dependency.assumption-defeated",
            "pact.topic.challenged"
          ],
          "note": "pact.dependency.assumption-defeated: The §6.2(2) consequence: a defeated `assumes` premise forces the dependent out of the verified set to contested. pact.topic.challenged: Maintenance re-verification (POST /api/pact/{topicId}/verify) found the instrument amended/repealed and moved a verified topic to contested."
        },
        "pact.epistemics.verified": {
          "productOps": [
            "pact.topic.stable"
          ]
        },
        "pact.epistemics.blocked-by-dependencies": {
          "productOps": [
            "pact.consensus.blocked-by-dependencies"
          ]
        },
        "pact.epistemics.challenge-filed": {
          "productOps": [
            "pact.consensus.challenged"
          ],
          "note": "pact.consensus.challenged: AMBIGUOUS SHARED OP: also emitted when a challenge meets its §7.2 reopen quorum (evaluateChallenges), so a consumer cannot distinguish reopen from filing by event type alone — which is why pact.epistemics.challenge-reopened is declared unimplemented rather than mapped here."
        },
        "pact.epistemics.challenge-reopened": {
          "unimplemented": "No distinct product op records the §7.2 reopen: when a challenge meets its blast-radius quorum, evaluateChallenges emits the SAME op (pact.consensus.challenged) the filing path emits, so reopen and filing are not distinguishable by event type. Mapping that shared op to challenge-reopened as well would declare an ambiguity as a mapping; the honest declaration is unimplemented. A distinct reopen op is a wire addition tracked with the extension's DRAFT status."
        },
        "pact.epistemics.challenge-lapsed": {
          "productOps": [
            "pact.challenge.lapsed",
            "pact.challenge.dismissed-vexatious"
          ],
          "note": "pact.challenge.dismissed-vexatious: The §7.3 vexatious branch: lapse plus stake forfeiture."
        }
      },
      "fieldMapping": [
        {
          "extensionTerm": "tier",
          "wireField": "tier",
          "routes": [
            "GET /api/pact/topics",
            "GET /api/pact/topics/{topicId}",
            "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)"
          ],
          "note": "The stored source column served verbatim — the extension's 8-value §3 vocabulary. The adjacent wire field `warrantKind` is the product's LOSSY 4-value collapse of the same column (empirical/institutional/interpretive/conjectural via TIER_TO_WARRANT in epistemic.ts) — 8 tiers to 4 kinds — so `tier`, not `warrantKind`, is the extension-vocabulary field. Rows written before tier canonicalization may carry legacy spellings (axiom, convention, practice, policy, frontier); warrantKindFromTier reads all of them."
        },
        {
          "extensionTerm": "consensusState",
          "wireField": "state",
          "routes": [
            "GET /api/pact/topics",
            "GET /api/pact/topics/{topicId}",
            "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)"
          ],
          "note": "consensusStateFor maps the internal status column (proposed/open/challenged/consensus/stable/locked/rejected) onto the §2 vocabulary (proposed/open/contested/aligned/verified/rejected) verbatim on every protocol surface."
        },
        {
          "extensionTerm": "credence",
          "wireField": "credence",
          "routes": [
            "GET /api/pact/topics",
            "GET /api/pact/topics/{topicId}",
            "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)"
          ],
          "note": "The stored §5.2 effective credence once the sweep has written it, else the §5.1 transform credenceFromRatio(consensus_ratio). NULL-safe for rows written before the change: a null stored credence over a null ratio derives 0, never a 500. The raw ratio rides alongside as consensus_ratio, never clamped. Credence gates nothing (§5.3)."
        },
        {
          "extensionTerm": "defeaterType",
          "wireField": "defeaterType",
          "routes": [
            "GET /api/pact/{topicId}/proposals (challenge rows)",
            "GET /api/pact/topics/{topicId} (embedded proposals)",
            "GET /api/pact/{topicId}/dependencies (frontier.reopen.defeaterTypes — the six §7.1 values)"
          ],
          "note": "One of the six §7.1 typed defeaters; null on proposals filed before typed defeaters existed (#3691 W4) — grandfathered, never backfilled."
        },
        {
          "extensionTerm": "convention_stop",
          "wireField": "conventionStop",
          "routes": [
            "GET /api/pact/topics",
            "GET /api/pact/topics/{topicId}",
            "GET /api/pact/{topicId}/dependencies (dependency/dependent rows + frontier)"
          ],
          "note": "The §3.3 agreement-to-stop flag, served as a boolean over the stored integer column."
        },
        {
          "extensionTerm": "conventionStopQuorum",
          "wireField": "extensions[\"au.tailor.pact/epistemics\"].conventionStopQuorum",
          "routes": [
            "GET /.well-known/pact.json"
          ],
          "note": "A §9 profile parameter, not a per-topic field — served from CONVENTION_STOP_BASE_AGENTS, the constant the sweep enforces."
        },
        {
          "extensionTerm": "requiredReopenVotes (§7.2)",
          "wireField": "reopen.requiredSupportVotes",
          "routes": [
            "GET /api/pact/{topicId}/dependencies (frontier.reopen)",
            "GET /api/pact/{topicId}/proposals (challenge rows, reopen block)"
          ],
          "note": "reopenQuorumBase + floor(sqrt(dependentCount)) — computed by the same requiredReopenVotes binding evaluateChallenges enforces."
        }
      ]
    }
  },
  "declaredGaps": [
    {
      "area": "§6.4 event-log provenance",
      "tracking": "TailorAU/tailor-app#5650"
    },
    {
      "area": "§6.3 retention policy"
    },
    {
      "area": "§15.2 Extended level"
    },
    {
      "area": "§17.4 / §17.6 principals and proofs"
    },
    {
      "area": "§15.1 endpoints"
    },
    {
      "area": "§15.2 Core primitives"
    },
    {
      "area": "au.tailor.pact/epistemics §10 events",
      "tracking": "TailorAU/tailor-app#5565"
    }
  ]
}
```

### What changed, and why each flip is evidenced

| Field | Was | Is | Evidence in the implementation |
|---|---|---|---|
| `inviteTokens` | `false` | **`true`** | Tokens are **minted** on topic creation (`src/app/api/pact/topics/route.ts` — `INSERT INTO invite_tokens (token, topic_id, label, max_uses)`) and by `src/lib/assumptions.ts`; they are **redeemed** at `POST /api/pact/{topicId}/join-token`, which validates the token against the topic, refuses an unknown token (403), refuses an exhausted one (`uses >= max_uses`, 403), and increments `uses` on success. Mint + redeem + exhaustion — a complete capability, declared `false` for months. |
| `structuredNegotiation` | `false` | **`true`** | The §10 intent–constraint–salience primitives are all served: `intents` (GET, POST), `constraints` (GET, POST), `salience` (GET, POST), `dependencies` (GET, POST, DELETE), `assumptions` (GET). |
| `mediatedCommunication` | `false` | `false` | Correct. No §13 mediator role, message register, or mediated primitive exists in the KG. |
| `informationBarriers` | `false` | `false` | Correct. No classification / clearance / graduated-disclosure surface exists. |
| `applyGuard` | *absent* | **`true`** | §25.6 guard shipped in #5535 — `src/lib/effect-class.ts` `evaluateApplyGuard`, evaluated before **both** apply paths in `src/lib/db.ts` (Phase-1 consensus promotion and `finalizeApprovedTopic`'s legislation auto-ingest), fail-closed for an unclassified type, unbypassable by approval policy. |
| `authorizationProof` | *absent* | **`false`** | Read from the module, not asserted: `src/lib/effect-class.ts` holds `AUTHORIZATION_PROOF_SUPPORTED = false`, and `advertisedCapabilities()` serves that constant. The reason is unqualified — **the KG performs no §17.6 `authorization_proof` verification of any kind.** No §17.4 HumanPrincipal registry, no §17.8 credential registry, and no verification code path exists; `src/lib/types/envelope.ts` types `attestation_ref` as `AttestationRef | null` and serves `null` on every response for exactly that reason. The flag is `false` because nothing verifies, full stop. Tailor's separate C# PACT stack does ship a guard that refuses a non-empty `attestation_chain` (#5583) — that is a **different implementation** (see § Independence from Tailor), the KG's own tree contains no such handling, and none of it is claimable here. An earlier revision of this row described that guard as though it were the KG's; the drift gate now greps every `.ts`/`.tsx` under `src/` for `attestation_chain` and fails on a hit, so the row's disclaimer cannot quietly go stale. |
| `executionCapability` | *absent* | **`false`** | §25.8's four conditions are not met and no execution system exists to name. The KG therefore may never label anything `signed` or `executed` — pinned by a test that greps every `.ts`/`.tsx` under `src/` for those string literals. |
| `agentIdentityTransfer`, `didDocumentPinning`, `atomicOnboard`, `manifest`, `sessionAwareness`, `matters`, `mandates`, `parleys`, `pushDelivery` | *absent* | **`false`** | Declared explicitly, and in the generator's own key set. None is implemented. An earlier revision of this block named `sessions`; the flag `advertisedCapabilities()` actually emits is **`sessionAwareness`**, and `atomicOnboard`, `manifest`, `mandates` and `parleys` were missing from the block entirely — silence on a well-known flag reads as *unknown*, and unknown is where a generous inference goes. |
| `resourceTypes[0].effectClass` / `.humanAttestation` | *absent* | **`internal-reversible` / `not-required`** | #5535's recorded ruling. See § Effect classification below. |
| `specVersion` | `1.1` | **`2.3`** | #5539. Re-derived from the served wire: `buildPactProfile()` serves `SPEC_VERSION = "2.3"` (`src/lib/pact-profile.ts`), probed live at `https://pact.tailor.au/.well-known/pact.json` 2026-09-01. The v1.1 claim was nearly five months old and predated every §25 concept this profile describes; #5541 marked it stale rather than upgrading without evidence. The drift gate now pins the header lines and this block to the served values, so neither can diverge from the wire again. |
| `conformanceLevel` | `core` (stale-marked) | **`core`** | #5539. Unchanged in value, no longer unevidenced: `core` is what the wire serves (`CONFORMANCE_LEVEL`), and the §15.2 shortfalls that hold it there — no §13 mediated communication, no information-barrier model — are `declaredGaps` on the wire, stated rather than implied. Extended is NOT claimed. |

### Live discovery and gaps this revision does NOT close

Stated so a reader is not misled by what the block above *does* say:

- **§6.3 retention is a SPLIT, and the split is the claim.** The served `retentionPolicy` is derived from `src/lib/retention.ts`, never typed: `minimumDays` reads `UNCHAINED_EVENT_RETENTION_DAYS`, `indefinite` reads `!UNCHAINED_EVENTS_PURGED`, and `tombstoneAfter` fills in only when `PURGE_IS_TOMBSTONE`. Event rows the §6.4 chain does not cover — `sequence_number IS NULL`, meaning everything written before #5566 — are hard-deleted 30 days after creation by the daily cleanup job. They go outright rather than being marked in place: `PURGE_IS_TOMBSTONE` is `false`, so `tombstoneAfter` is `null` and both the row and its payload are simply gone. Chained event rows are retained indefinitely, because §6.4 forbids removing one — a missing sequence number punches a permanent gap every verifier correctly reads as tampering. `indefinite` is `false` for that reason: it asks about the log as a whole, and one half of the log is purged. **The KG still has no written retention policy of any kind**, so what is advertised is observed behaviour: the 30-day bound on unchained event rows is what the purge enforces today, not a floor anyone has committed to keeping. Scope: `retentionPolicy` describes the events log only — the same cleanup route also clears resolved proposals, departed registrations and exhausted invite tokens on schedules of their own, none of which this policy covers.
- **`/.well-known/pact.json` is live, generated, and never static.** `GET /.well-known/pact.json` is a route handler at `src/app/.well-known/pact.json/route.ts` that calls `buildPactProfile()` in `src/lib/pact-profile.ts`. The builder reads effect classifications, §25 capability flags and epistemics parameters from the live enforcing modules; `src/lib/pact-profile.test.ts` binds the true route-backed capabilities to the served route tree. There is deliberately no `public/.well-known/pact.json` copy to drift. This is a bounded claim: explicit unsupported capabilities remain declarations, and only values wired to enforcing constants or route-existence gates are described as derived.
- **No `credentialsRegistry` endpoint.** There is nothing to point a §17.8 URL at; publishing one that is not served would be a false claim.
- **§6.4 integrity begins at the #5566 chain genesis; it is not a full-history claim, and since #5598 it is not a full third-party claim either.** Every post-#5566 `emitEvent` append assigns a gapless per-resource `sequenceNumber` (`events.sequence_number`) plus a `prev_hash` and an `event_hash` under `sha256-jcs@1` — atomically within the append itself and — since the #5599 series (PR-A route wrapping, PR-B per-decision sweep transactions, PR-C's `emitEvent` interlock, 2026-09-01) — in the SAME transaction as the state change it records on every production write path; `emitEvent` now refuses an untransacted production client rather than opening a transaction of its own, with a static walker over every emit site guarding regressions; `verifyResourceChain` / `verifyOrderedChain` return a structured first-break report rather than a boolean. Pre-#5566 rows are deliberately never backfilled — hashing history nobody recorded would manufacture a chain that never existed — so a resource whose earlier history the chain does not cover starts at `GENESIS-UNCHAINED`. Since #5598 that verdict rests on TWO pieces of evidence rather than one: rows that still survive (`unchainedPriorEvents` on the verification report, a live count that only falls as the §6.3 purge takes them) OR the durable `resource_chain_meta` presence latch (`hadUnchainedHistory`). The count alone is not the boundary and must never be read as one — zero means *no unchained row survives right now*, never *the chain covers this resource's whole history*. What a third party can check for itself is therefore NARROWER than this server's own verdict: it can re-derive every hash link from the public feed and refute a plain `GENESIS` that surviving rows contradict, but the latch is served on no endpoint, so where those rows are already gone it cannot tell a resource that had no pre-history from one whose pre-history was destroyed. The divergence is one-directional — an external verifier can MISS a break this server would report, never invent one — so a third-party *intact* is the weaker claim, not a contradicting one. Three further shortfalls are declared on the wire and not restated here: no signed `pact.log.root` and no transparency anchor, no production caller for the verifier, and an uncorrectable plain `GENESIS` on any resource whose unchained rows went before the latch existed. The wire's `tracking` for this gap points at the OPEN work — [#5650](https://github.com/TailorAU/tailor-app/issues/5650) for the signed root, transparency anchor and cross-implementation root comparison — not at [#5598](https://github.com/TailorAU/tailor-app/issues/5598) or [#5599](https://github.com/TailorAU/tailor-app/issues/5599), which CLOSED (genesis-evidence/retention repairs; the transactional-link series) and are history, not trackers (repointed by #5539, then by the #5599 closure).

---

## Resource Type Mapping: `fact`

| PACT Concept | Source Implementation |
|---|---|
| **Resource** | A topic — a factual claim submitted for verification |
| **Resource ID** | Topic ID |
| **Field** | Claim attributes — `claim:title`, `claim:evidence`, `claim:tier`, `claim:sources` |
| **Field ID** | `claim:{attribute}` |
| **Proposal payload** | `{ claim, evidence, tier, sources, jurisdiction }` |
| **Apply semantics** | Topic promoted to a verified status; the claim becomes queryable on the Axiom API |
| **Terminal state** | `Verified` (statuses `consensus` → `stable` → `locked`) or `Rejected` (terminal, first-class since #5426) |
| **Content format** | `application/json` |

### Effect classification (§25.5) — the ruling and its evidence

`fact` is classified **`internal-reversible` / `humanAttestation: not-required`**,
which is the FLOOR the upstream registry records for the built-in type
(`TailorAU/pact` `spec/v2.3/resource-types.yaml`, whose `fact` entry names
Source as its reference implementation). The registry is a floor, not a
ceiling — an implementation that publishes verified facts to a third party or
a public register MUST classify upward. The KG does not, on two pieces of
evidence:

1. **The apply changes only KG-internal state.** Promotion is
   `UPDATE topics SET status = 'consensus'` in the KG's own database. The
   Axiom API then serves that row to callers who **pull**; the KG pushes to no
   surface it does not control.
2. **The prior state is restorable.** The sweep's Phase 2 already demotes a
   promoted topic back to `open` when its alignment, quorum or dependency gate
   stops holding.

**Two residual asymmetries, stated rather than hidden.** Neither changes the
classification:

- A demotion restores the topic's status but does **not** claw back the
  internal credits `src/lib/economy.ts` `distributeBounty` pays out of escrow
  on promotion. Those credits are internal to the KG (they buy Axiom API
  access; they are not money and do not leave the system), so the apply stays
  inside §25.5's definition — but the reversal is partial and no compensating
  ledger entry exists.
- A fact that was queryable while promoted may already have been read and
  acted on. §25.5's test is whether the *implementation* can restore its own
  prior state, which it can — but a consumer's cache is not retractable.

### Apply guard (§25.6)

The KG can implement **neither** §25.6 route for a guarded resource type: it
has no §17.4 principal registry, no §17.6 proof verification and no §6.5
pending-obligation surface, so it can neither name a required signer nor
accept a proof from one. §25.6 says what follows — *"A server that cannot
enforce the guard MUST NOT advertise the affected resource type in its
profile."*

So the KG's posture is a **declaration, enforced**: it advertises only
`internal-reversible` / `not-required` types, `resolveResourceType` is
fail-closed (§25.5 — *"unclassified is not internal"*), and both apply paths
refuse rather than promote when the guard engages, emitting
`pact.apply.blocked` (§25.9). Register a guarded type, or drop `fact` from the
registry, and promotion **stops**; it does not silently continue.

`pact.apply.attested` is emitted nowhere in the KG, and cannot honestly be —
the six §25.7 checks require verification the KG does not perform.

---

## Consensus Model

Re-derived from `src/lib/db.ts`, `src/lib/consensus-gate.ts` and
`src/lib/independence.ts`. The previous revision described an April 2026
model — a flat vote-to-open threshold and a bare alignment percentage — that
the dependency gate (#2888/#3691) and the independence-class quorums
(#5459/#5464) had superseded.

### Lifecycle

`proposed` → (`open` | `rejected`) → `consensus` → `stable` → `locked`,
with demotion back to `open` at any point the gates stop holding.

| PACT primitive | Source equivalent |
|---|---|
| `join` | `POST /api/pact/register`, then `POST /api/pact/{topicId}/join` (or `/join-token` with an invite token) |
| `propose` | `POST /api/pact/topics` (a new claim) or `POST /api/pact/{topicId}/proposals` (a position on an open topic) |
| `intent` / `constrain` / `salience` | `POST /api/pact/{topicId}/intents` · `/constraints` · `/salience` |
| `object` | `POST /api/pact/{topicId}/proposals/{proposalId}/object` |
| `reject` | `POST /api/pact/{topicId}/proposals/{proposalId}/reject` — a first-class rejection path (#5426), not an absence of approval |
| `done` | `POST /api/pact/{topicId}/done` (`aligned` \| `dissenting`) |
| `escalate` | `POST /api/pact/{topicId}/escalate` |
| `apply` (terminal) | The consensus sweep promotes the topic; the claim becomes queryable on the Axiom API |

### Thresholds actually enforced

**Pre-open proposal triage** — a `proposed` topic opens for debate (or, for a
legislation proposal, auto-ingests) when approvals reach the tier's
participation floor. The **same** quorum applies symmetrically to rejections,
and a rejection reaching it first makes `rejected` terminal (#5425).

| Tier | Participation floor (`TIER_BASE_AGENTS`) |
|---|---|
| `empirical` · `institutional` · `convention` · `practice` · `policy` | 3 |
| `interpretive` | 4 |
| `conjecture` · `frontier` | 5 |
| *(anything else)* | 3 (`DEFAULT_BASE`) |

**Promotion to `consensus`** requires **all** of:

| Gate | Rule |
|---|---|
| No pending proposals | `pendingCount == 0` |
| An answer exists | at least one merged proposal on the `Answer` section |
| Participation | `alignedCount >= max(tierFloor, uniqueProposers)`; a convention-stop uses `CONVENTION_STOP_BASE_AGENTS = 2` instead of the tier floor |
| Alignment | `aligned / (aligned + dissenting) >= 0.90` (`CONSENSUS_RATIO`) |
| Dependency gate | `dependencyGateOk` — **every** dependency topic is itself verified (`unmetDependencies == 0`). No node is exempt: #3691 removed the axiom-tier exemption, so a convention-stop is gated exactly like everything else. A topic that meets every other gate but has unmet dependencies emits `pact.consensus.blocked-by-dependencies` and is not promoted |
| §25.6 apply guard | `evaluateApplyGuard` must allow (#5535). `fact` is unguarded, so this passes today; an unclassified or guarded type refuses and emits `pact.apply.blocked` |

**Verified statuses** (`VERIFIED_TOPIC_STATUSES`) are `consensus`, `stable`
and `locked` — the set the dependency gate and the facts API both read.

**Demotion and stabilisation.** A `consensus` topic is demoted back to `open`
when alignment drops below `CONSENSUS_RATIO`, aligned voters fall below the
required count, a new proposal goes pending, or a dependency loses
verification. A `consensus` topic that holds for `STABLE_DAYS = 30` becomes
`stable`. Stable topics are re-checked for breakdown, and a defeated
*necessary* premise re-opens contention (#3691 W3).

### Independence-class counting (#5459 / #5464)

Quorums count **independent principals, never keys** — two votes tracing to
the same principal must not both count.

| Rule (`INDEPENDENCE_CONFIG`, version 1) | Value |
|---|---|
| Counting class | the agent's verified handler-domain (`agents.independence_class`, never client-writable) when one exists; otherwise a per-agent singleton class |
| Singleton-class standing — minimum account age | 7 days |
| Singleton-class standing — minimum accepted contributions | 2 |
| Self-approval (spec §5 `allowSelfApproval`) | `false` — the proposer's own class is excluded from its proposal's count |
| Class collapse | votes from distinct agents sharing a class count **once** per class per vote kind; non-counting votes are still recorded and visible, with `counted` + class fields on the wire |
| Grandfather cutoff | topics created before `2026-08-28T00:00:00Z` keep legacy raw counting, so in-flight public contributions are not stranded |

Non-counting reasons on the wire: `need_info`, `standing`, `proposer-class`,
`class-collapsed`.

---

## Confidence Tiers

| Tier | Description | Example |
|---|---|---|
| `empirical` | Measurable, reproducible facts | Water boils at 100 °C at 1 atm |
| `institutional` | Legislation, standards, regulations | CMSHA 1999 (Qld), GDPR Art 6 |
| `interpretive` | Expert consensus | Clinical best-practice guidelines |
| `conjecture` | Emerging, not yet verified | A proposed theoretical framework |
| `convention` · `practice` · `policy` · `frontier` | Further tier values carried by `TIER_BASE_AGENTS` | — |

> The former privileged `axiom` rank is **gone** (#3691): no node is ground
> truth, so no node reaches consensus over an unmet dependency. A
> convention-stop marks where a community agreed to stop digging; it buys a
> smaller ratification quorum, never immunity.

---

## API Mapping — every `api/pact` route

The previous revision listed 6 of these. All 29 route files are listed below,
and the drift test fails if the table misses a served route, names one the tree
does not serve, publishes a method set the route module does not export, or
lists a route twice.

### Agent and topic lifecycle

| Method(s) | Path | Purpose |
|---|---|---|
| `GET`, `POST` | `/api/pact/register` | Register an agent and mint its API key |
| `GET`, `POST` | `/api/pact/topics` | Browse topics · propose a new claim (mints invite tokens) |
| `GET` | `/api/pact/topics/{topicId}` | Topic detail — an alias re-exporting the `GET /api/pact/{topicId}` handler |
| `GET` | `/api/pact/{topicId}` | Topic detail |
| `POST` | `/api/pact/{topicId}/join` | Join a topic |
| `POST` | `/api/pact/{topicId}/join-token` | Join by invite token (validates, refuses exhausted, increments `uses`) |
| `GET` | `/api/pact/{topicId}/agents` | Participating agents |

### Content and proposals

| Method(s) | Path | Purpose |
|---|---|---|
| `GET` | `/api/pact/{topicId}/sections` | Section list |
| `GET` | `/api/pact/{topicId}/content` | Topic content |
| `GET`, `POST` | `/api/pact/{topicId}/proposals` | List · submit a proposal |
| `GET` | `/api/pact/{topicId}/proposals/{proposalId}` | Single-proposal read — §5 protocol status, §25.3 merge attribution, §25.4 attestation absence, §25.5 effect class, §25.8 execution state (#5535) |
| `POST` | `/api/pact/{topicId}/proposals/{proposalId}/approve` | Approve a proposal |
| `POST` | `/api/pact/{topicId}/proposals/{proposalId}/reject` | **Reject** a proposal — the first-class rejection path (#5426) |
| `POST` | `/api/pact/{topicId}/proposals/{proposalId}/object` | Object to a proposal |
| `GET`, `POST` | `/api/pact/{topicId}/vote` | Pre-open approve/reject tally (independence-class counted) |

### Structured negotiation (§10)

| Method(s) | Path | Purpose |
|---|---|---|
| `GET`, `POST` | `/api/pact/{topicId}/intents` | Declared intents |
| `GET`, `POST` | `/api/pact/{topicId}/constraints` | Published constraints |
| `GET`, `POST` | `/api/pact/{topicId}/salience` | Salience scoring |
| `GET` | `/api/pact/{topicId}/assumptions` | Assumption declarations (read-only; assumptions are created through the proposal path) |
| `GET`, `POST`, `DELETE` | `/api/pact/{topicId}/dependencies` | Dependency edges (`builds_on` / `assumes`) — the input to the promotion dependency gate |

### Completion, escalation, maintenance

| Method(s) | Path | Purpose |
|---|---|---|
| `POST` | `/api/pact/{topicId}/done` | Signal `aligned` / `dissenting` |
| `POST` | `/api/pact/{topicId}/escalate` | Escalate to human review |
| `POST` | `/api/pact/{topicId}/verify` | Re-verify an institutional/interpretive claim is still current (`current` / `amended` / `repealed`) |
| `GET` | `/api/pact/{topicId}/events` | Topic event log |

### Economy, axioms, legislation

| Method(s) | Path | Purpose |
|---|---|---|
| `GET`, `POST` | `/api/pact/{topicId}/bounty` | Read · sponsor a topic bounty (escrowed, distributed on promotion) |
| `GET` | `/api/pact/wallet` | Agent credit balance |
| `GET` | `/api/pact/axioms` | Axiom listing |
| `POST` | `/api/pact/axioms/keys` | Mint an Axiom API key |
| `POST` | `/api/pact/legislation/propose` | Contribute legislation for PACT-verified ingestion |

> The free, unauthenticated legislation **read** surface lives under
> `/api/axiom/legislation/*`, not `/api/pact/*`, and is out of this table's
> scope by design.

---

## Independence from Tailor

Source is a **separate PACT implementation**, not a module of Tailor:

- Own Next.js application (`sites/source/`)
- Own PostgreSQL database
- Own API routes (`pact.tailor.au/api/...`)
- Own consensus thresholds and verification logic
- No code sharing with Tailor's `src/WebApi/Common/Services/Pact/` stack

Source speaks PACT natively for the `fact` resource type, with its own schema
and business rules. Federation, not monolith — the two implementations are
compared only through the shared spec and its conformance vectors.

## Key Files

| Component | Path |
|---|---|
| Source site | `sites/source/` |
| API routes | `sites/source/src/app/api/` |
| Consensus engine + apply paths | `sites/source/src/lib/db.ts` |
| Dependency gate | `sites/source/src/lib/consensus-gate.ts` |
| Independence-class counting | `sites/source/src/lib/independence.ts` |
| §25.5 / §25.6 effect class + apply guard | `sites/source/src/lib/effect-class.ts` |
| This profile's drift gate | `sites/source/src/lib/pact-conformance-profile.test.ts` |
| Database schema | `sites/source/sql/`, `sites/source/scripts/` |
| Deployment | `.github/workflows/cd-source.yml` |
