# Provenance chain — PACT v2.3 §6.4 over the KG operation log

Filed under [#5566](https://github.com/TailorAU/tailor-app/issues/5566);
the genesis rule and the retention interaction were corrected in
[#5598](https://github.com/TailorAU/tailor-app/issues/5598).
Implementation: [`src/lib/provenance-chain.ts`](../src/lib/provenance-chain.ts);
the single writer is `emitEvent` in [`src/lib/db.ts`](../src/lib/db.ts); the
retention bound and its purge statement live in
[`src/lib/retention.ts`](../src/lib/retention.ts).

This document is the **declared genesis record**. It exists so nobody has to
guess what the chain covers, and so the fact that it does *not* cover the
KG's pre-#5566 history is a stated position rather than a discovered
surprise.

## What is chained

The **`events` table** — the KG's PACT operation log, published at
`GET /api/pact/{topicId}/events` and consumed by pollers. One chain per
**resource**, where a resource is a PACT topic (`events.topic_id`).

`audit_log` is **not** chained and is not the §6.4 stream. It is the
Privacy-Act compliance trail described in [`AUDIT.md`](AUDIT.md), and it is
deliberately best-effort: `recordAudit` catches, logs and continues so an
audit failure can never break a user-facing operation. That posture is
incompatible with a gapless chain by construction — a dropped best-effort
write is an undetectable gap — which is exactly why the §6.4 stream is a
different table with a different writer.

## Columns

Added to `events` by `initSchema` as additive `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS` (the repo's existing migration convention):

| Column | Type | Meaning |
|---|---|---|
| `sequence_number` | `BIGINT` | Per-topic, strictly monotonic, **gapless**. First chained event of a topic is `1`. |
| `prev_hash` | `TEXT` | Previous chained event's `event_hash`, or a genesis sentinel. |
| `event_hash` | `TEXT` | `base64url(SHA-256(RFC 8785 canonical event))`. |
| `hash_alg` | `TEXT` | Explicit algorithm identifier — currently `sha256-jcs@1`. |
| `epoch_ms` | `BIGINT` | Writer-stamped epoch milliseconds the hash commits to. |

Two indexes ship with them:

- `idx_events_topic_sequence` — **UNIQUE** on `(topic_id, sequence_number)`.
  §6.4 treats a duplicate sequence number exactly as a hash-chain break, so
  the database refuses to store one. Postgres treats `NULL`s as distinct, so
  the unchained legacy rows do not collide.
- `idx_events_chain` — `(topic_id, sequence_number DESC)` for the head read
  on the append path and the verifier's ordered walk.

`GET /api/pact/{topicId}/events` selects `e.*`, so all five columns reach
third-party consumers with no route change: an outside party can re-derive
every hash from the published rows.

## The hashed event layout (normative)

`event_hash = base64url( SHA-256( UTF-8( RFC 8785 canonical JSON ) ) )` over:

```json
{
  "agentId":        "<events.agent_id, or null>",
  "alg":            "sha256-jcs@1",
  "entityId":       "<events.topic_id>",
  "entityType":     "pact-topic",
  "epochMs":        <events.epoch_ms, integer>,
  "eventType":      "<events.type>",
  "id":             "evt_<events.id>",
  "payloadJson":    "<events.data verbatim, or null>",
  "prev_hash":      "<previous event's event_hash, or a genesis sentinel>",
  "sectionId":      "<events.section_id, or null>",
  "sequenceNumber": <events.sequence_number, integer>
}
```

Member order is owned by RFC 8785 (sorted by UTF-16 code unit); the order
above is what it produces. Notes on three deliberate choices:

- **`alg` rides inside the hashed object.** The algorithm identifier is bound
  to the link, so an algorithm downgrade cannot be performed silently. A
  consumer that meets an unrecognised `hash_alg` must **reject** the row —
  §6.4: an unverifiable row is not a verified row — which is what
  `verifyOrderedChain` does (`kind: "unknown-alg"`), rather than skipping it.
- **`epochMs` is a stamped integer column, not a derivation of
  `created_at`.** Postgres stores `timestamptz` at microsecond precision and
  JavaScript `Date` holds milliseconds; deriving the hashed timestamp from
  `created_at` would make the bytes depend on which client parsed the row.
  `created_at` is unchanged and still serves every existing query.
- **`payloadJson` is the stored TEXT verbatim**, never a re-serialization, so
  a verifier hashes exactly what the database holds.

The layout is versioned by its identifier. `sha256-jcs@1` never changes
meaning; a future layout gets a new identifier, mirroring the Tailor-side
`kernel.root@1` / `HeaderVersion` convention in
`src/WebApi/Common/Services/KernelStore/`.

## Transactional boundary

`emitEvent` runs the whole append inside **one database transaction**
(`DbClient.transaction`, a dedicated pooled connection with `BEGIN` /
`COMMIT` / `ROLLBACK`):

1. `pg_advisory_xact_lock(5566, hash(topic_id))` — serialises concurrent
   appends for this resource; released at commit or rollback. It lives in the
   two-`int4` advisory space, which never collides with the consensus
   sweep's one-`bigint` `CONSENSUS_SWEEP_LOCK_KEY`.
2. Read the chain head (`sequence_number`, `event_hash`).
3. Assign `sequence_number = head + 1` and `prev_hash = head.event_hash`, or
   declare a genesis when there is no head.
4. `INSERT ... RETURNING id`.
5. Compute the hash (it commits to the DB-assigned id, so it can only be
   computed after the insert) and `UPDATE events SET event_hash`.

**Every step throws on failure. There is no catch-and-continue anywhere on
this path.** A failure to chain rolls the event back and fails the operation
that was emitting it — that is the whole point of the change. A caller that
is already inside a transaction (`DbClient.inTransaction`) has the link
assigned in *its* transaction, alongside the state change being recorded.

## Genesis — declared, never backfilled

Events written before #5566 carry `NULL` in all five columns and are **left
exactly as they are, permanently**. No backfill exists and none should be
written: manufacturing hashes over unchained history would assert a chain
that never existed. A fabricated chain is worse than an honestly short one.

The first chained event of a resource therefore references one of two
declared sentinels:

| Sentinel | Claim | Strength |
|---|---|---|
| `GENESIS` | The §6.4 literal. **Nothing preceded this chain** — the resource had no events at all, so the chain covers its entire history. | **Strong.** Any positive evidence of prior history refutes it. |
| `GENESIS-UNCHAINED` | **Something preceded this chain.** The resource already had unchained rows; the chain starts here and covers nothing before it. | **Weak.** Nothing can refute "something existed" — least of all its later deletion. |

`GENESIS-UNCHAINED` is this store's instance of §6.4's "Migration from
v2.0 / v2.0.1" sentinel idea, named for what the KG is actually migrating
from: a store with no chaining at all.

**The two sentinels are asymmetric claims, and a verifier that tests them
symmetrically will report tampering on an honest chain.** That is not a
hypothetical: it was the rule this document described until #5598, and it is
the single most important correction below. See *Verifying the genesis
sentinel*.

Two consequences worth stating plainly:

- **Sequence numbers start at 1 for the first chained event regardless of how
  many unchained rows precede it.** Numbering from `unchainedCount + 1` would
  assert that those rows held sequence numbers they never had.
- **The verifier reports `unchainedPriorEvents`** on every report. A resource
  with 40 legacy rows and a 3-event chain reads as exactly that, rather than
  as a clean bill of health over 43 events. Read that number as a **live
  observation that can only decrease** — see below. Zero does not mean the
  chain covers everything.

## Verifying the genesis sentinel (#5598 — corrected rule)

A first chained event is checked against **two independent pieces of
evidence**, read at one instant:

| Evidence | What it is | What it proves |
|---|---|---|
| `liveUnchainedEvents` | `COUNT(*)` of the resource's rows with `sequence_number IS NULL`, right now. Published in every report as `unchainedPriorEvents`. | `> 0` proves unchained history exists **today**. `0` proves **nothing** — not that there never was any. |
| `hadUnchainedHistory` | Presence of a row for this resource in `resource_chain_meta` (below). | `true` proves unchained history **did** exist. `false` means **UNKNOWN**, never "had none". |

`liveUnchainedEvents` can only fall over time: nothing has written an
unchained row since the chain shipped, and the retention purge deletes them.
So a count of `0` cannot distinguish *"this resource never had unchained
events"* from *"it had forty and retention deleted all of them"*. That
distinction is carried by `hadUnchainedHistory` and by nothing else.

The rule, in full:

| # | `prev_hash` | live rows | latch | Verdict | Why |
|---|---|---|---|---|---|
| 1 | `GENESIS` | 0 | false / unknown | **intact** | Nothing refutes the strong claim. Nothing confirms it either — the residual case. |
| 2 | `GENESIS` | 0 | **true** | **break** — `missing-genesis`, expected `GENESIS-UNCHAINED` | The latch is durable positive evidence that history existed. The rows are gone; the evidence is not. |
| 3 | `GENESIS` | > 0 | any | **break** — `missing-genesis`, expected `GENESIS-UNCHAINED` | A surviving unchained row directly refutes "nothing preceded this chain". |
| 4 | `GENESIS-UNCHAINED` | 0 | false / unknown | **intact** | **The correction.** Retention deleting the rows is not evidence they never existed. |
| 5 | `GENESIS-UNCHAINED` | 0 | true | **intact** | The latch agrees with the sentinel. |
| 6 | `GENESIS-UNCHAINED` | > 0 | any | **intact** | Live rows agree with the sentinel. |

Collapsed, that is two sentences:

- **`GENESIS` is falsifiable** — it breaks if *any* positive evidence of prior
  history exists, whether a surviving row or the latch.
- **`GENESIS-UNCHAINED` is unfalsifiable by absence** — it never breaks on
  history grounds, at any count, with or without the latch. Rows 4-6 are one
  rule.

A `prev_hash` that is neither sentinel is always a `missing-genesis` break.

**This rule needs no new data on the wire.** `GENESIS-UNCHAINED` is
self-describing: it already says *"there was history here you cannot see"*, so
a third party holding only the published rows can apply rows 3-6 unchanged.
The `resource_chain_meta` latch exists for the **writer**, which has to choose
a sentinel it will then stamp permanently; row 2 is the only line of the table
an external verifier cannot evaluate for itself, and it can only ever make
this store's verdict *stricter*, never more generous.

> **Third parties: this matters more than an internal bug would.**
> `verifyOrderedChain` / `verifyResourceChain` have **no production caller** —
> the server does not verify its own chain. The only consumer of the rule
> above is an external verifier re-deriving it from
> `GET /api/pact/{topicId}/events`. A peer that implemented the pre-#5598 rule
> (expected sentinel = `live count > 0 ? GENESIS-UNCHAINED : GENESIS`, tested
> for equality) will report **tampering on an honest chain** as soon as this
> store's retention purge runs. If you have such an implementation, row 4 is
> the line to change.

### `resource_chain_meta` — the durable presence latch

```
resource_chain_meta(
  topic_id                PRIMARY KEY,
  unchained_purged_count  BIGINT NOT NULL DEFAULT 0,
  first_observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_purged_at          TIMESTAMPTZ,
  origin                  TEXT NOT NULL
)
```

**A row means "this resource DID have unchained history". No row means
UNKNOWN — never "it had none".** Presence is the whole signal;
`unchained_purged_count` is for telling an operator how much evidence was
destroyed and is never a decision input (`0` is ambiguous by design — it is
both "no row at all" and "latched, nothing purged yet").

Four properties are load-bearing:

- **Monotonic.** `false → true`, never back. Nothing anywhere may delete from
  this table, truncate it, or rewrite `origin` / `first_observed_at`; a
  repo-wide source guard enforces that. Monotonicity is the *only* reason the
  writer may safely consult the latch — one that could clear would make the
  choice of a permanent sentinel depend on when the append happened.
- **A separate table, not a column.** The case it has to cover is a resource
  purged **before** it ever appends a chained event. There is no chain row to
  hang a marker on.
- **No foreign key to `topics`.** `events.topic_id` has one; this must not.
  Evidence about a resource's pre-history has to outlive the resource — a
  cascading FK would destroy the latch, a restricting one would block the
  topic's deletion.
- **Stamped inside the purge, not after it.** The purge is a single
  data-modifying CTE (`DELETE … RETURNING` → aggregate → `INSERT … ON CONFLICT
  DO UPDATE`), so no reader can observe the delete without the stamp and no
  crash can land between them. A daily pre-pass latches every resource that
  currently holds an unchained row, well ahead of the retention boundary, and
  a one-shot backfill did the same for the existing estate.
- **The pre-pass and the backfill are diagnostic, not load-bearing.** Because
  the purge stamps in the same statement as the delete, the genesis rule is
  already correct with neither of them: a resource purged before its first
  chained append reads the latch and writes `GENESIS-UNCHAINED`. What the two
  sweeps add is an earlier `first_observed_at`, an `origin` that distinguishes
  "we knew before the purge" from "we learned at the moment of deletion", and
  `last_purged_at IS NULL` to tell those apart afterwards. They are therefore
  run fail-soft: a failure in either must never stop the purge, and in the cron
  it must never stop the consensus sweep that shares the same handler.

`origin` records which writer latched a resource first and is immutable
afterwards: `backfill` (one-shot, at migration time), `pre-purge-sweep` (daily
pre-pass), `purge` (first seen at the moment its rows were deleted).

### What this cannot fix

A resource whose unchained rows were destroyed **before the latch existed**
and which then wrote a plain `GENESIS` is indistinguishable from one that
genuinely had no prior events. Row 1 of the table is where it lands, and it
verifies intact while overstating what its chain covers.

That is **permanent**. `prev_hash` is bound into `event_hash`, so rewriting
the sentinel would change the hash — fabrication, not repair. It is declared
as item (iv) of the §6.4 gap in the served
[`/.well-known/pact.json`](../src/lib/pact-profile.ts) rather than quietly
carried. The set should be empty in practice: the retention cron had been
returning HTTP 308 since the 2026-07-02 domain cutover, so the purge had never
actually run when the backfill landed, and every affected resource was still
recoverable.

It also costs the `GENESIS` verdict its full re-derivability. The latch is a
decision input, and no endpoint publishes it — `GET /api/pact/{topicId}/events`
is a `SELECT` over `events` alone. A third party can confirm every hash link
and can refute a `GENESIS` that live rows contradict, but once those rows are
gone it cannot tell a resource that truly had no pre-history from one whose
pre-history was purged. The divergence runs one way only: an external verifier
can MISS a break this server would report, never invent one, so a third-party
"intact" is a weaker claim than the server's rather than a contradicting one.
`GENESIS-UNCHAINED` is unaffected — it is a weak claim no absence can refute,
so the latch never changes its verdict. Declared as item (v) of the §6.4 gap.

## Retention interaction (the 30-day purge)

`/api/cron/cleanup` used to run `DELETE FROM events WHERE created_at < NOW()
- INTERVAL '30 days'`. Left alone, that would punch a permanent gap into every
resource's chain a month after this shipped — and §6.4 is explicit that
"sequence numbers are never reused, never reassigned, and never skipped. A
compacted or tombstoned event retains its position — compaction replaces
payload content, not chain position."

The purge is therefore scoped to `sequence_number IS NULL`: it keeps doing
exactly what it always did to the pre-#5566 unchained backlog, and stops at
the chain. **Chained rows are retained indefinitely and §6.4 forbids deleting
one.** A source-level test in
[`provenance-chain.test.ts`](../src/lib/provenance-chain.test.ts) pins this.

That scoping protects the chain. It does **not** protect the *evidence about
what preceded* the chain, and #5598 found two defects that follow from
confusing the two:

1. **Retention flipped honest chains to "tampered".** The purge deletes
   exactly the rows the old verifier re-derived its expectation from, so a
   resource that honestly wrote `GENESIS-UNCHAINED` failed with
   `missing-genesis` once its unchained rows aged out. The chain was
   byte-identical and untampered; the verdict moved because the retention job
   did its job. Fixed by the asymmetric rule above — row 4.
2. **A purge before the first chained append wrote a false claim.** If every
   unchained row for a resource was deleted *before* it ever appended a
   chained event, the writer counted 0 and stamped plain `GENESIS` — "the
   chain covers this resource's entire history" — about a resource whose
   pre-history had just been destroyed. Fixed by latching
   `resource_chain_meta` **before** the boundary, so the writer chooses its
   sentinel from durable evidence rather than a live count.

Writer and verifier now read the **same statement**
(`loadChainHistoryEvidence`) and apply the **same predicate**
(`expectedGenesisSentinel` / `genesisSentinelIsFalsified`), so the writer
cannot stamp a sentinel its own verifier would reject.

### Advertised policy (§6.3)

The bound is no longer a literal inside the cron route. `src/lib/retention.ts`
is a pure module that owns `UNCHAINED_EVENT_RETENTION_DAYS` **and** builds the
statement that enforces it (`make_interval(days => ?)`, parameterised from that
same constant), and `pact-profile.ts` derives the served `retentionPolicy` from
it. The wire therefore reads:

```json
"retentionPolicy": { "minimumDays": 30, "indefinite": false, "tombstoneAfter": null }
```

Before #5598 it read `{ "minimumDays": 0, "indefinite": true }` — false on the
live wire for as long as the daily delete had existed, and guarded by a test
that grepped the wrong file. Changing the advertisement now requires changing
the enforcement.

Tombstone-in-place instead of hard delete remains follow-on work. It would be
strictly better — it would make `resource_chain_meta` unnecessary, because the
evidence would survive as a row — but it changes what the public events feed
returns to every consumer, so it is its own design.

## The verifier

`verifyResourceChain(db, topicId)` (and the pure `verifyOrderedChain`) walks a
resource's chain and returns a **structured report, not a boolean**:

```ts
{
  resourceId, entityType, alg,
  chainedEvents,
  // Live observation, can only decrease. Zero ≠ "the chain covers everything".
  unchainedPriorEvents,
  // #5598 — the durable latch. true = history DID exist; false = UNKNOWN.
  hadUnchainedHistory,
  // #5598 — reporting only. Events destroyed by retention, permanently
  // unverifiable. 0 is ambiguous, so never branch on it.
  purgedUnchainedPriorEvents,
  // #5598 — the evidence the genesis verdict was reached on, exactly as read.
  historyEvidence: { liveUnchainedEvents, hadUnchainedHistory, purgedUnchainedEvents },
  genesis, firstSequenceNumber, headSequenceNumber, headHash,
  intact: boolean,
  firstBreak: { kind, atSequenceNumber, eventId, expected, actual, detail } | null
}
```

`unchainedPriorEvents === historyEvidence.liveUnchainedEvents` is a frozen
invariant; the field is kept under its original name so existing readers do
not break, and `historyEvidence` is what makes the ambiguity in a zero
readable.

`kind` is one of `gap` · `duplicate` · `hash-mismatch` · `prev-hash-mismatch`
· `missing-genesis` · `missing-hash` · `unknown-alg`. Only the **first** break
is reported: everything after a break is untrustworthy by definition.

`headHash` is the resource's chain head — the value its next event must carry
as `prev_hash`, and the value a future §6.4 daily signed root would commit to.

It is exposed as a **callable module function**. The KG has no admin HTTP
surface to hang an operator verify endpoint off today, so adding one is
recorded here as follow-up rather than invented as a new public route.

## Not covered here

The rest of §6.4, deliberately left as follow-on work per #5566's Out of
scope:

- Daily signed `pact.log.root` events (per-resource `head_hash` leaves, a
  `root_hash` over the sorted `resources` array, and an `ed25519` signature).
- The `pact-log-anchor/1` external transparency anchor.
- Cross-implementation root comparison against the Tailor-side kernel.

The conformance **level** is not touched by this work — it stays `core`, held
there by the §15.2 shortfalls, not by §6.4. The served implementation profile
*is* touched: #5598 replaced the §6.4 and §6.3 declared gaps and derived
`retentionPolicy` from the enforcing constant (see
[`src/lib/pact-profile.ts`](../src/lib/pact-profile.ts)). `PACT_CONFORMANCE.md`
remains owned by the sibling discovery-document work
(#5539 / #5541 / #5563 / PR #5578) and is not edited here; a test
(`src/lib/pact-conformance-profile.test.ts`) instead asserts that whatever it
says about retention matches what the server serves.
