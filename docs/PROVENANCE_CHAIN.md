# Provenance chain — PACT v2.3 §6.4 over the KG operation log

Filed under [#5566](https://github.com/TailorAU/tailor-app/issues/5566).
Implementation: [`src/lib/provenance-chain.ts`](../src/lib/provenance-chain.ts);
the single writer is `emitEvent` in [`src/lib/db.ts`](../src/lib/db.ts).

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

| Sentinel | Meaning |
|---|---|
| `GENESIS` | The §6.4 literal. The resource had **no** events at all, so the chain covers its entire history. |
| `GENESIS-UNCHAINED` | The resource already had unchained rows. The chain starts here and covers **nothing** before it. |

`GENESIS-UNCHAINED` is this store's instance of §6.4's "Migration from
v2.0 / v2.0.1" sentinel idea, named for what the KG is actually migrating
from: a store with no chaining at all.

Two consequences worth stating plainly:

- **Sequence numbers start at 1 for the first chained event regardless of how
  many unchained rows precede it.** Numbering from `unchainedCount + 1` would
  assert that those rows held sequence numbers they never had.
- **The verifier reports `unchainedPriorEvents`** on every report. A resource
  with 40 legacy rows and a 3-event chain reads as exactly that, rather than
  as a clean bill of health over 43 events.

## Retention interaction (the 30-day purge)

`/api/cron/cleanup` used to run `DELETE FROM events WHERE created_at < NOW()
- INTERVAL '30 days'`. Left alone, that would punch a permanent gap into every
resource's chain a month after this shipped — and §6.4 is explicit that
"sequence numbers are never reused, never reassigned, and never skipped. A
compacted or tombstoned event retains its position — compaction replaces
payload content, not chain position."

The purge is therefore scoped to `sequence_number IS NULL`: it keeps doing
exactly what it always did to the pre-#5566 unchained backlog, and stops at
the chain. A source-level test in
[`provenance-chain.test.ts`](../src/lib/provenance-chain.test.ts) pins this.

Choosing the §6.3 retention policy for the chained stream — a declared
minimum, and tombstone-in-place instead of delete — is follow-on work
(#5566 lists retention/tombstone policy as out of scope). Until it lands, the
honest behaviour is to retain the chain rather than shred it.

## The verifier

`verifyResourceChain(db, topicId)` (and the pure `verifyOrderedChain`) walks a
resource's chain and returns a **structured report, not a boolean**:

```ts
{
  resourceId, entityType, alg,
  chainedEvents, unchainedPriorEvents,
  genesis, firstSequenceNumber, headSequenceNumber, headHash,
  intact: boolean,
  firstBreak: { kind, atSequenceNumber, eventId, expected, actual, detail } | null
}
```

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

Published conformance-level claims are **not** touched by this change; the
implementation profile and `PACT_CONFORMANCE.md` are owned by the sibling
discovery-document work (#5539 / #5541 / #5563 / PR #5578).
