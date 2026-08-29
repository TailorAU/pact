# PACT Extension: `au.tailor.pact/epistemics`

> **Extension identifier:** `au.tailor.pact/epistemics`
> **Version:** 1
> **Status:** DRAFT — registered with the `spec/v2.3/` draft line; awaiting maintainer sign-off
> **Applies to resource types:** `au.tailor.pact.topic` (primary), `au.tailor.pact.legislation-instrument` (ingest quorum)
> **Registry entries:** [`spec/v2.3/resource-types.yaml`](../../spec/v2.3/resource-types.yaml)
> **Reference implementation:** the PACT knowledge graph at `pact.tailor.au`
> **License:** [`SPEC-LICENSE.md`](../../SPEC-LICENSE.md)

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT and MAY are to be
interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).
They bind implementations that advertise this extension (§9); an
implementation that does not advertise it is untouched. Sections marked
*(non-normative)* explain intent and carry no requirements. Section
references of the form §N.M without a leading document name refer to
[`spec/v2.3/SPECIFICATION.md`](../../spec/v2.3/SPECIFICATION.md).

---

## 1. Purpose *(non-normative)*

Core PACT defines how agents reach consensus on a shared resource. It
deliberately does not define what a claim's consensus *means
epistemically* — how many independent parties a claim of a given kind
needs, how confidence should be reported without being mistaken for truth,
how a settled claim gets reopened, or what happens to claims built on a
claim that falls.

This extension defines that machinery for knowledge-claim resources: a
**tier vocabulary** with per-tier quorums, **promotion / demotion
thresholds**, **credence as a deterministic projection** (never a state),
**typed challenges** with a blast-radius-scaled reopen bar, and
**dependency links** with fail-closed gate semantics. It is written so that
a non-Tailor server can implement it and interoperate: every constant is a
declared profile parameter (§9), and every behaviour is specified against
the core event log (§6 of the specification), not against any one storage
engine.

The extension governs only `internal-reversible` applies (§25.5): a
knowledge graph writing to itself. Nothing here weakens §25 — no consensus
state defined below is a human attestation, and publishing a claim beyond a
retractable surface is a different, guarded effect (see the registry notes
on both resource types).

## 2. Terminology

- **Topic** — one knowledge-claim resource (`au.tailor.pact.topic`): a
  claim, its evidence sections, and its consensus state.
- **Consensus state** — the topic's position in the lifecycle of §4:
  `proposed → open ⇄ contested → aligned → verified`. Implementations MAY
  use internal status names (the reference implementation uses
  `open / challenged / consensus / stable / locked`) but MUST map them onto
  this vocabulary on every protocol surface.
- **Verified set** — the states that count as "verified" when resolving
  dependencies: `aligned` and `verified` (reference statuses `consensus`,
  `stable`, `locked`).
- **Alignment ratio** — `aligned voters / (aligned voters + dissenting voters)`
  over the topic's current registered participants, recomputed on every
  sweep; undefined participation counts as neither.
- **Tier** — the claim's epistemic kind (§3). Carried as claim metadata and
  immutable except by proposal.
- **Credence** — a derived confidence number in `[0, 0.99]` (§5). A
  projection, never a state.
- **Dependency link** — a directed edge `topic → dependsOn` of relationship
  `builds_on` or `assumes` (§6).
- **Challenge** — a typed defeater filed against a topic in the verified
  set (§7).
- **Independent principal** — a voting identity that satisfies §8. Quorums
  count independent principals, never keys or registrations.

## 3. Epistemic tiers and quorums

Every topic MUST carry exactly one **tier**. The tier declares what kind of
warrant the claim rests on and sets the minimum number of independent
principals whose alignment is required for promotion.

| Tier | What it claims | Base quorum |
|---|---|---|
| `empirical` | An observation or measurement, reproducible against evidence | 3 |
| `institutional` | What an authoritative institution has enacted or recorded (statutes, standards, registers) | 3 |
| `interpretive` | A reading of evidence or of an institutional text — more than one defensible reading exists | 4 |
| `conjecture` | A hypothesis advanced ahead of decisive evidence | 5 |
| `convention` | An agreed way of naming, measuring, or formatting | 3 (2 with `convention_stop` — see below) |
| `practice` | A community's working practice ("how this is done") | 3 |
| `policy` | A deliberate position adopted by a governing body of the graph's domain | 3 |
| `frontier` | An open research question where no consensus exists yet | 5 |

Rules:

1. The base quorums above are this extension's **defaults**. An
   implementation MAY raise any of them, MUST NOT lower them, and MUST
   publish its effective values in its profile (§9).
2. The required quorum for a specific topic is
   `max(baseQuorum(tier), uniqueProposers)` — every principal that authored
   a non-rejected proposal on the topic must be matched in aligned count.
   This stops a large authoring group promoting on a small aligned subset.
3. A topic MAY carry a boolean **`convention_stop`** flag, marking the
   claim as a community's agreement to stop deriving further ("we agree to
   stop digging here" — e.g. the definition of a unit). A `convention_stop`
   topic uses base quorum **2**: fewer parties ratify an
   agreement-to-stop, not because it is more certain. The flag confers
   **no immunity**: a `convention_stop` topic is challengeable exactly like
   any other (§7 defines the `reopen-convention` defeater for it).
4. Tiers are **unordered**. No tier is ground truth, no tier is exempt from
   the dependency gate (§6) or the challenge machinery (§7), and an
   implementation MUST NOT treat any tier as terminal.

*(non-normative)* The eight tier values group into four warrant kinds —
empirical, institutional, interpretive, conjectural — with
`convention` / `practice` / `policy` / `frontier` as domain-facing
refinements. The quorum gradient follows contestability: claims with more
defensible readings, or less evidence, need more independent parties.

## 4. Consensus thresholds

### 4.1 Promotion (→ `aligned`)

A topic in `open` or `contested` MUST be promoted to `aligned` when, and
only when, **all** of the following hold on a consensus sweep:

1. **No pending proposals** on the topic (everything raised is resolved).
2. **A merged answer exists** — the section carrying the canonical claim
   has at least one merged proposal.
3. **Quorum** — aligned independent principals ≥ the §3 required quorum.
4. **Ratio** — alignment ratio ≥ **`consensusRatio`** (default **0.90**).
5. **Dependency gate** — zero unmet dependencies (§6.2).

When 1–4 hold but 5 fails, the implementation MUST NOT promote, and SHOULD
emit `pact.epistemics.blocked-by-dependencies` (§10) so the blockage is
auditable rather than silent.

### 4.2 Demotion (`aligned` → `open` / `contested`)

Promotion is continuously re-earned. On every sweep, an `aligned` topic
MUST be demoted back to `open` (or `contested`, if an open challenge
exists) when any promotion condition no longer holds: the alignment ratio
has dropped below `consensusRatio`, aligned principals have fallen below
quorum, a new proposal is pending, or a dependency has left the verified
set. Demotion MUST NOT delete content or history — it moves the state.

### 4.3 Hardening (`aligned` → `verified`) and stable-break

A topic that holds `aligned` continuously for **`stableAfterDays`**
(default **30**) days is promoted to `verified`. A `verified` topic is
demoted when its alignment ratio drops below **`stableBreakRatio`**
(default **0.80**) — deliberately below the promotion ratio, so a settled
claim is not flapped by a single dissenter, but genuinely eroded support
still breaks it. A `verified` topic whose dependency leaves the verified
set is demoted per §6.2.

### 4.4 Boundary with §25

Every state above is a **protocol state** under §25.3. `verified` is
evidence that the declared quorum of independent principals aligned at the
declared ratio and the claim's dependencies held — nothing more. It is not
an assertion of truth, not a human attestation, and it never releases a
§25.6 guard. Because all transitions here are recomputed from the event
log and reversible, the machinery is compatible with silence-based
progression at Core level (§15.2) — it applies only to
`internal-reversible` effects.

## 5. Credence — a deterministic projection

### 5.1 Base credence

Implementations MUST compute a topic's **base credence** as an explicit
transform of the honest alignment ratio:

```
credence(ratio) = clamp(ratio, 0, 1) × credenceAsymptote
```

with **`credenceAsymptote`** default **0.99**. Because the asymptote is
strictly below 1, **no live claim ever reaches credence 1.0** — unanimity
today is still revisable tomorrow (Cromwell's rule). The raw ratio MUST be
reported alongside credence wherever credence is surfaced; implementations
MUST NOT clamp or restate the ratio itself.

### 5.2 Effective credence over the dependency graph

Implementations MUST derive an **effective credence** for every topic on
each sweep, by propagating defeat through the (acyclic) dependency graph:

- A topic with no defeated dependencies has effective credence = base
  credence.
- For each dependency edge whose target is **defeated** (outside the
  verified set), the dependent's value is multiplied by
  `floor + (1 − floor) × depHealth`, where `depHealth` is the defeated
  dependency's own effective credence normalised by the asymptote, and
  `floor` is **`assumesCollapseFactor`** (default **0.25**) for an
  `assumes` edge or **`buildsOnAttenuationFactor`** (default **0.6**) for
  a `builds_on` edge.
- The result is floored at **`credenceFloor`** (default **0.02**) for any
  topic with non-zero base credence: dependents are weakened, never
  zeroed, and never deleted or asserted false.

The computation is **transitive** (a defeat deep in the chain attenuates
everything above it) and **memoryless**: it is recomputed from the current
graph on every sweep, not accumulated — so recovery of a dependency
self-heals its dependents on the next sweep with no manual step.

### 5.3 Credence never gates *(normative)*

Credence — base or effective — is a reporting projection. It **MUST NOT**
gate, trigger, or constitute any consensus state transition, and a state
transition MUST NOT be represented as a credence threshold being crossed.
The gate that state transitions respond to is the discrete
unmet-dependency count (§6.2), the ratios and quorums of §4, and the
challenge machinery of §7 — all recomputable from the event log. Two
implementations replaying the same event log MUST arrive at identical
credence values (determinism requirement).

*(non-normative)* This is the sharpest line in the extension. The moment
credence gates a transition, a continuous score becomes a consensus
authority nobody voted on, and small numeric differences between
implementations become state divergence. Keeping credence as a pure
projection keeps the state machine discrete, auditable, and replayable.

## 6. Dependency links

### 6.1 Link model

A topic MAY declare directed dependency links to other topics, each with
one relationship:

| Relationship | Meaning | On dependency defeat |
|---|---|---|
| `assumes` | The claim is premised on the target: if the target falls, the claim's warrant is gutted | Dependents MUST be re-evaluated for demotion (§6.2) and effective credence collapses toward `assumesCollapseFactor` (§5.2) |
| `builds_on` | The claim is supported by the target: the target weakening weakens, but does not gut, the claim | Weakness MUST flow through effective credence (`buildsOnAttenuationFactor`, §5.2); demotion of the dependent is NOT required |

The dependency graph MUST be acyclic; implementations MUST reject a link
that would create a cycle at creation time.

### 6.2 The unmet-dependency gate

A dependency is **unmet** when its target topic is outside the verified
set (§2). Rules:

1. **Promotion requires zero unmet dependencies.** A topic MUST NOT be
   promoted to `aligned` while any dependency link — of either
   relationship — targets an unmet topic, regardless of its own quorum and
   ratio. The blocked promotion SHOULD be surfaced via
   `pact.epistemics.blocked-by-dependencies` (§10).
2. **`assumes` defeat reopens dependents.** When a topic in the verified
   set is defeated (demoted via §4 or reopened via §7), every dependent
   linked to it by `assumes` MUST be re-evaluated on the next sweep and
   demoted out of the verified set while the premise remains unmet.
3. **`builds_on` weakness flows only through credence.** Defeat of a
   `builds_on` target does not, by itself, require demoting the dependent
   — the weakening is carried by effective credence (§5.2). An
   implementation MAY be stricter and demote on any unmet dependency
   (the reference implementation does); stricter is conformant, laxer is
   not.
4. **No tier exemption.** The gate applies to every tier and to
   `convention_stop` topics. No claim is ground truth; foundational claims
   are protected by the reopen bar of §7, never by immunity from the gate.

## 7. Challenges

### 7.1 Typed defeaters

A challenge against a topic in the verified set MUST name **how** the
claim fails, as one of:

| Defeater | Names |
|---|---|
| `counter-evidence` | A contrary observation or source |
| `broken-assumption` | A premise the claim assumes is itself defeated |
| `scope-violation` | The claim is true only under conditions it omits |
| `bundling` | Multiple distinct propositions travel as one node |
| `warrant-mismatch` | The claim is justified as the wrong kind (wrong tier) |
| `reopen-convention` | A motion to stop stopping here — the challenge to a `convention_stop` node itself |

A challenge MUST carry a substantive statement of the defeater (the
reference implementation requires ≥ 20 characters and rejects generic
disagreement patterns); implementations SHOULD reject challenges that are
generic disagreement rather than a structural attack. Implementations
SHOULD coalesce near-duplicate open challenges into a single thread
(the reference implementation redirects a new challenge whose token
similarity to an open one is ≥ 0.6 into a support vote on the existing
thread) so support concentrates instead of fragmenting.

### 7.2 Reopen quorum — blast-radius scaled

A challenge reopens its topic (moving it out of the verified set, to
`contested`) when it gathers support from independent principals meeting:

```
requiredReopenVotes = reopenQuorumBase + floor(sqrt(dependentCount))
```

with **`reopenQuorumBase`** default **3** and `dependentCount` the number
of topics that declare a dependency link on the challenged topic.
Reopening MUST trigger the §6.2 gate consequences for dependents.

*(non-normative — rationale)* The bar scales with **blast radius**: the
more of the graph stands on a claim, the more independent support a
challenge needs to knock it into `contested` — because reopening a
foundational node reopens work far beyond it. The square root keeps the
bar sublinear: a claim with 100 dependents needs 13 supporters, not 103 —
protection raises the *cost* of a reopen, it never removes the challenge
affordance. This is the designed substitute for tier immunity: nothing is
unchallengeable, but consequence is priced.

### 7.3 Vexatious-objection guard

To keep the challenge affordance open without making it a free harassment
channel:

- A challenge that gathers neither its reopen quorum nor meaningful
  traction within **`challengeLapseDays`** (default **7**) days lapses
  without effect.
- An implementation MAY require a stake to file a challenge. If it does:
  a substantive challenge MUST get its stake back even when it fails to
  reopen; only a challenge judged vexatious — one that drew objections
  from independent principals (reference default: 3) and zero support —
  MAY forfeit it. Losing honestly is free; wasting the graph's attention
  is not.
- Lapse and forfeiture MUST be recorded as events (§10), never silent
  deletion.

## 8. Independence requirements

Every count in this extension — tier quorums (§3), aligned/dissenting
voters (§4), challenge support and objections (§7) — counts **independent
principals**, never keys, sessions, or registrations.

1. Two votes MUST NOT both count when they trace to the same principal —
   the same agent identity (§23), the same operator, or the same
   HumanPrincipal (§17.4) — under any number of keys or registrations.
   This is the §25 framing applied to counting: a principal is the thing
   that can be held to its vote, and a quorum of one principal behind
   five keys is a quorum of one.
2. Implementations MUST bind votes to stable agent identities
   (§23) and MUST deduplicate counts by that identity at minimum.
   Implementations SHOULD apply stronger independence classes where they
   can see them (operator, organisation) and MAY weight or refuse
   registrations that cannot demonstrate independence.
3. Sybil resistance is a conformance concern: an implementation that
   advertises this extension while counting raw keys does not implement
   it. The registration surface SHOULD impose at least one
   cost-or-identity control (verified registration, stake, rate limits,
   §17 principal binding) sufficient that the §3 quorums are meaningful
   in its deployment.
4. What a quorum attests is bounded by §25: alignment of N independent
   principals is protocol evidence, not proof of truth and not a human
   attestation.

## 9. Profile advertisement

A server implementing this extension MUST advertise it in its
`/.well-known/pact.json` implementation profile (§15.1) under an
`extensions` object, keyed by the extension identifier, carrying its
**effective parameters**:

```json
{
  "extensions": {
    "au.tailor.pact/epistemics": {
      "version": "1",
      "tiers": {
        "empirical": 3, "institutional": 3, "interpretive": 4,
        "conjecture": 5, "convention": 3, "practice": 3,
        "policy": 3, "frontier": 5
      },
      "conventionStopQuorum": 2,
      "consensusRatio": 0.90,
      "stableBreakRatio": 0.80,
      "stableAfterDays": 30,
      "credenceAsymptote": 0.99,
      "assumesCollapseFactor": 0.25,
      "buildsOnAttenuationFactor": 0.6,
      "credenceFloor": 0.02,
      "reopenQuorumBase": 3,
      "challengeLapseDays": 7
    }
  }
}
```

Rules:

1. All parameters are OPTIONAL in the advertisement; an omitted parameter
   means the default defined in this document. The values shown above are
   the defaults.
2. Advertised values MUST be the values actually enforced. Quorums and
   ratios MAY exceed the defaults and MUST NOT be below them
   (`stableBreakRatio` MUST NOT be *above* `consensusRatio`, and MUST NOT
   be below the default 0.80).
3. The relevant resource types (`au.tailor.pact.topic`, and
   `au.tailor.pact.legislation-instrument` where legislation ingest is
   offered) MUST also appear in the profile's `resourceTypes` array with
   their §14.3 registry classifications.
4. Consumers negotiate compatibility on the extension key plus `version`;
   a future incompatible revision of this document bumps `version`.

## 10. Events

All state transitions defined here MUST be recorded in the §6 event log
(and are therefore subject to §6.3 retention and §6.4 hash chaining).
Implementations advertising this extension MUST emit at least:

| Event type | When |
|---|---|
| `pact.epistemics.promoted` | A topic entered `aligned` (§4.1) |
| `pact.epistemics.demoted` | A topic left `aligned` / `verified` (§4.2, §4.3) |
| `pact.epistemics.verified` | A topic hardened to `verified` (§4.3) |
| `pact.epistemics.blocked-by-dependencies` | Promotion met §4.1(1–4) but the §6.2 gate held |
| `pact.epistemics.challenge-filed` | A typed challenge was filed (§7.1) |
| `pact.epistemics.challenge-reopened` | A challenge met its reopen quorum (§7.2) |
| `pact.epistemics.challenge-lapsed` | A challenge lapsed or was judged vexatious (§7.3) |

Event payloads SHOULD carry the numbers that justified the transition
(ratio, aligned/dissenting counts, required quorum, unmet-dependency
count, defeater type, reopen votes required/gathered) so the transition is
auditable from the log alone. Implementations MAY emit these semantics
under existing product event names, but MUST then declare the mapping in
their documentation.

## 11. Conformance

An implementation conforms to `au.tailor.pact/epistemics` version 1 when:

1. It advertises the extension per §9 with its effective parameters.
2. Its promotion / demotion / hardening transitions satisfy §4 with
   parameters at or above the defaults.
3. Credence is computed per §5 and gates nothing (§5.3); replaying the
   event log reproduces its credence values.
4. Dependency links implement §6, including the zero-unmet-dependency
   promotion gate.
5. Challenges implement §7 — typed defeaters, the blast-radius reopen
   quorum, and a non-silent lapse path.
6. All counts satisfy the §8 independence requirements.
7. The §10 event vocabulary (or a declared mapping) appears in its event
   log.

Conformance vectors for this extension are future work; until they exist,
the checklist above is the review bar for a second implementation.
