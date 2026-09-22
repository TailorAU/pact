/**
 * #5566 — PACT v2.3 §6.4 provenance chain for the KG's PACT operation log.
 *
 * The KG's operation log is the `events` table. Until this module it carried
 * neither a `sequenceNumber` nor a `prev_hash`, which §6.4 (as tightened by
 * TailorAU/pact#60) makes non-conformant at Extended: "A store that never
 * assigns `sequenceNumber` is non-conformant at Extended and
 * Authorization-Required."
 *
 * What this module owns:
 *
 *  1. The chain arithmetic — RFC 8785 (JCS) canonicalization, the hashed
 *     event layout, and the base64url SHA-256 link. Pure, DB-free, so the
 *     writer (`appendChainedEvent`) and the verifier (`verifyOrderedChain`)
 *     share ONE implementation and a third party can reproduce the bytes.
 *  2. The transactional append — sequence assignment + `prev_hash` + hash,
 *     all inside the caller's transaction. See § Transactional boundary.
 *  3. The verifier — walks a resource's chain and reports the FIRST break as
 *     a structured record, never a bare boolean.
 *
 * § Transactional boundary (the point of the change).
 * `src/lib/audit.ts` documents the audit_log writer as deliberately
 * best-effort ("audit-log write failures must NEVER break the user-facing
 * operation"). A best-effort writer cannot produce a gapless chain — a
 * dropped write is an undetectable gap. So the chained stream is NOT
 * best-effort: `appendChainedEvent` throws on any failure to chain, and
 * `emitEvent` (db.ts) runs it inside a database transaction so the
 * head-read, the sequence assignment, the insert and the hash stamp either
 * all land or none do. A failure to chain fails the operation. The
 * per-resource advisory lock (taken as the transaction's first statement)
 * serialises concurrent appends for the same resource, and the
 * `(topic_id, sequence_number)` UNIQUE index is the database-level backstop
 * against a duplicate sequence number.
 *
 * audit_log itself stays best-effort by design — it is the Privacy-Act
 * compliance trail (docs/AUDIT.md), NOT the §6.4 operation log. The §6.4
 * stream is `events`, which is what `/api/pact/{topicId}/events` publishes
 * and therefore what a third party has to be able to verify.
 *
 * § Genesis (declared, never backfilled).
 * Events written before this change carry NULL `sequence_number` /
 * `prev_hash` and are left exactly as they are, forever. Inventing hashes
 * over unchained history would manufacture a chain that never existed — a
 * fabricated chain is worse than an honestly short one. Instead the first
 * chained event of a resource references a declared genesis sentinel:
 *
 *   - `GENESIS` — the §6.4 literal, and the STRONG claim: the resource had
 *     no prior events AND there is no record that it ever had any, so the
 *     chain covers the resource's entire history. #5598 — that is no longer
 *     "no prior events VISIBLE TODAY". The writer decides it from BOTH the
 *     surviving unchained rows AND the durable `resource_chain_meta`
 *     presence latch, because the daily retention purge deletes unchained
 *     rows: a purge that ran before a resource's first chained append used
 *     to leave the writer counting zero and stamping a permanent, false
 *     claim to cover a history that had already been destroyed.
 *   - `GENESIS-UNCHAINED` — the WEAK claim: something preceded this chain.
 *     The resource already had unchained rows. The chain starts here and
 *     covers NOTHING before it; the prior rows are unverifiable and are
 *     reported by the verifier — `unchainedPriorEvents` for the ones that
 *     still exist, `purgedUnchainedPriorEvents` for the ones retention
 *     destroyed — rather than being silently absorbed. (This is the §6.4
 *     "Migration from v2.0 / v2.0.1" sentinel idea, named for what the KG
 *     is actually migrating from: an unchained store.)
 *
 * The two sentinels are ASYMMETRIC claims, and #5598 exists because they
 * were tested symmetrically. `GENESIS` is falsifiable: one surviving
 * unchained row — or the latch on its own — refutes it. `GENESIS-UNCHAINED`
 * is not falsifiable by absence: no amount of deletion is evidence that the
 * deleted rows never existed, so it NEVER breaks on history grounds. The
 * writer and the verifier read the same evidence through
 * `loadChainHistoryEvidence` and apply the same predicates
 * (`expectedGenesisSentinel` / `genesisSentinelIsFalsified`), so the writer
 * cannot stamp a sentinel its own verifier would reject.
 *
 * Sequence numbers therefore start at 1 for the first CHAINED event of a
 * resource regardless of how many unchained rows precede it — numbering
 * from `unchainedCount + 1` would assert those rows held sequence numbers
 * they never had. Full write-up: docs/PROVENANCE_CHAIN.md.
 *
 * § Out of scope here (§6.4 continues in follow-on work, per the issue):
 * daily signed `pact.log.root` events, the `pact-log-anchor/1` transparency
 * anchor, and cross-implementation root comparison.
 */
import { createHash } from "node:crypto";
import type { DbClient } from "./db";

/**
 * Explicit algorithm identifier stored on every chained row, mirroring the
 * Tailor-side precedent (`KernelRootMath` / `KernelChainMath`, #5456/#5445):
 * SHA-256 over the RFC 8785 (JCS) canonical UTF-8 encoding of the event
 * object, layout version 1. Stored so a consumer can REJECT a row whose alg
 * it does not recognise rather than skipping verification — §6.4:
 * "an unverifiable root is not a verified root".
 *
 * Never mutate the meaning of `@1`. A future layout gets a new identifier.
 */
export const CHAIN_HASH_ALG = "sha256-jcs@1";

/** §6.4 first-event `prev_hash` literal — the resource had no prior events. */
export const GENESIS = "GENESIS";

/**
 * Declared genesis for a resource that already had UNCHAINED events when
 * chaining was switched on (#5566). Never backfilled: everything before it
 * stays unchained and is reported, not absorbed.
 */
export const GENESIS_UNCHAINED = "GENESIS-UNCHAINED";

/** Every genesis sentinel this store may legitimately write. */
export const GENESIS_SENTINELS: readonly string[] = [GENESIS, GENESIS_UNCHAINED];

/**
 * §6.4 lets an implementation start at 0 or 1 but requires it to "pick one
 * convention and apply it uniformly". The KG picks 1.
 */
export const FIRST_SEQUENCE_NUMBER = 1;

/** §6.4 `entityType` of a KG chain — one chain per PACT topic. */
export const CHAIN_ENTITY_TYPE = "pact-topic";

/**
 * Advisory-lock namespace for per-resource append serialisation. Arbitrary
 * app-unique constant (the issue number), same convention as
 * `CONSENSUS_SWEEP_LOCK_KEY`. Uses the two-int4 advisory-lock space, which
 * never collides with the sweep's one-bigint lock.
 */
export const CHAIN_LOCK_NAMESPACE = 5566;

/** Thrown when an event cannot be chained. Never swallowed — see § Transactional boundary. */
export class ChainAppendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainAppendError";
  }
}

// ─── RFC 8785 (JCS) canonicalization ────────────────────────────────────────

/**
 * RFC 8785 canonical JSON of `value`.
 *
 * - Object members are sorted by UTF-16 code unit — which is exactly what
 *   JavaScript's default string `<` comparison does, so `.sort()` IS the
 *   RFC 8785 ordering, not an approximation of it.
 * - Numbers use ECMAScript `Number::toString`, which `JSON.stringify`
 *   emits verbatim for finite values (§6.4 payloads only ever carry
 *   integers here — epochMs and sequenceNumber).
 * - Strings use JSON escaping, which V8 already emits in RFC 8785's
 *   shortest form (control characters as the two-char escapes where they
 *   exist, `\u00xx` otherwise).
 * - `undefined` members are dropped; a non-finite number or a function
 *   throws rather than silently serialising to something unverifiable.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  const kind = typeof value;

  if (kind === "boolean") return value ? "true" : "false";

  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throw new ChainAppendError(`RFC 8785 cannot canonicalize the non-finite number ${String(value)}`);
    }
    return JSON.stringify(value);
  }

  if (kind === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((element) => canonicalize(element)).join(",")}]`;
  }

  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(); // default sort === UTF-16 code-unit order === RFC 8785 order
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }

  throw new ChainAppendError(`RFC 8785 cannot canonicalize a value of type ${kind}`);
}

// ─── The hashed event layout ────────────────────────────────────────────────

/** The fields of a KG event that the §6.4 chain hash commits to. */
export interface ChainedEventRecord {
  /** `events.id` (SERIAL) — surfaces in the hashed object as `evt_<id>`. */
  id: number;
  /** The §6.4 resource: the PACT topic this event belongs to. */
  topicId: string;
  eventType: string;
  agentId: string | null;
  sectionId: string | null;
  /** The exact TEXT stored in `events.data` (or null) — never a re-serialization. */
  payloadJson: string | null;
  /** Writer-stamped epoch milliseconds, persisted in `events.epoch_ms`. */
  epochMs: number;
  sequenceNumber: number;
  prevHash: string;
  /** Defaults to {@link CHAIN_HASH_ALG}; an unknown alg is rejected, never skipped. */
  alg?: string;
}

/** §6.4 event id form used inside the hashed object. */
export function eventIdFor(rowId: number): string {
  return `evt_${rowId}`;
}

/**
 * The canonical bytes the chain hash is taken over (normative — a verifier
 * in another language must reproduce this string exactly). RFC 8785 owns
 * member ordering; the order shown is what it produces:
 *
 * ```json
 * {"agentId","alg","entityId","entityType","epochMs","eventType","id",
 *  "payloadJson","prev_hash","sectionId","sequenceNumber"}
 * ```
 *
 * `alg` rides INSIDE the hashed object so the algorithm identifier is bound
 * to the link — an attacker cannot downgrade the algorithm without breaking
 * the hash. `epochMs` is a writer-stamped integer column rather than a
 * derivation of `created_at`, so the bytes are reproducible from the stored
 * row with no timestamp-parsing ambiguity (Postgres stores microseconds;
 * JS Dates hold milliseconds).
 */
export function chainCanonicalBytes(record: ChainedEventRecord): string {
  return canonicalize({
    agentId: record.agentId ?? null,
    alg: record.alg ?? CHAIN_HASH_ALG,
    entityId: record.topicId,
    entityType: CHAIN_ENTITY_TYPE,
    epochMs: record.epochMs,
    eventType: record.eventType,
    id: eventIdFor(record.id),
    payloadJson: record.payloadJson ?? null,
    prev_hash: record.prevHash,
    sectionId: record.sectionId ?? null,
    sequenceNumber: record.sequenceNumber,
  });
}

/** `base64url(SHA-256(RFC 8785 canonical UTF-8 bytes))` — §6.4's hash encoding. */
export function chainEventHash(record: ChainedEventRecord): string {
  const alg = record.alg ?? CHAIN_HASH_ALG;
  if (alg !== CHAIN_HASH_ALG) {
    throw new ChainAppendError(
      `Unknown chain hash algorithm '${alg}' — this store only produces '${CHAIN_HASH_ALG}'.`
    );
  }
  return createHash("sha256").update(chainCanonicalBytes(record), "utf8").digest("base64url");
}

/**
 * Stable per-resource advisory-lock key. Derived in JS (not SQL) so the
 * lock statement stays a plain two-parameter call and the key is unit
 * testable. int4 range, as `pg_advisory_xact_lock(int4, int4)` requires.
 */
export function chainLockKey(topicId: string): number {
  return createHash("sha256").update(topicId, "utf8").digest().readInt32BE(0);
}

// ─── The transactional append ───────────────────────────────────────────────

export interface ChainAppendInput {
  topicId: string;
  eventType: string;
  agentId: string | null;
  sectionId: string | null;
  payloadJson: string | null;
}

export interface AppendedChainedEvent {
  id: number;
  sequenceNumber: number;
  prevHash: string;
  eventHash: string;
  epochMs: number;
  alg: string;
}

/**
 * Appends ONE event to a resource's chain: assigns the next gapless
 * `sequenceNumber`, links `prev_hash` to the current head's hash, inserts
 * the row and stamps its own hash.
 *
 * MUST be called with a transaction-scoped client (`emitEvent` in db.ts is
 * the only production caller and guarantees that). Every step throws on
 * failure — there is no catch-and-continue anywhere in this function, which
 * is precisely what stops "best-effort" from applying to the chained
 * stream.
 */
export async function appendChainedEvent(
  tx: DbClient,
  input: ChainAppendInput
): Promise<AppendedChainedEvent> {
  // Serialise concurrent appends for THIS resource. Transaction-scoped, so
  // it releases on COMMIT/ROLLBACK and two writers can never read the same
  // head. The UNIQUE index on (topic_id, sequence_number) is the backstop
  // if this lock is ever bypassed.
  await tx.execute({
    sql: "SELECT pg_advisory_xact_lock(?, ?)",
    args: [CHAIN_LOCK_NAMESPACE, chainLockKey(input.topicId)],
  });

  const head = await tx.execute({
    sql: `SELECT sequence_number, event_hash FROM events
          WHERE topic_id = ? AND sequence_number IS NOT NULL
          ORDER BY sequence_number DESC LIMIT 1`,
    args: [input.topicId],
  });

  let sequenceNumber: number;
  let prevHash: string;

  if (head.rows.length === 0) {
    // No chained events yet — declare a genesis. Which sentinel depends on
    // EVERYTHING the store knows about pre-chain history, not merely the
    // rows that happen to survive today: the durable `resource_chain_meta`
    // latch outlives the retention purge that destroyed the rows it attests
    // to (#5598). Without it, a purge that ran before this first chained
    // append left this branch counting zero and stamping a permanent, false
    // `GENESIS` — a whole-history claim over a history already deleted, and
    // one that then verified intact forever. Neither sentinel backfills.
    //
    // Writer/verifier symmetry: this reads the SAME statement
    // (`loadChainHistoryEvidence`) and applies the SAME predicate
    // (`expectedGenesisSentinel`) the verifier uses — both defined with the
    // verifier below. `expectedGenesisSentinel` returns GENESIS_UNCHAINED
    // exactly when `genesisSentinelIsFalsified(GENESIS, evidence)` is true,
    // so this writer can never stamp a sentinel its own verifier rejects.
    //
    // It also closes a latent query asymmetry: the count this replaces
    // omitted the `AND sequence_number IS NULL` predicate the verifier's
    // count carried. That never yet produced a wrong sentinel — this branch
    // is guarded by `head.rows.length === 0`, so no chained row exists and
    // the two counts are provably equal at this instant — but the writer and
    // the verifier must ask the same question, and now there is only one
    // question to ask.
    const evidence = await loadChainHistoryEvidence(tx, input.topicId);
    sequenceNumber = FIRST_SEQUENCE_NUMBER;
    prevHash = expectedGenesisSentinel(evidence);
  } else {
    const headSequence = Number(head.rows[0].sequence_number);
    const headHash = head.rows[0].event_hash;
    if (!Number.isInteger(headSequence)) {
      throw new ChainAppendError(
        `Chain head for '${input.topicId}' has a non-integer sequence number; refusing to append.`
      );
    }
    if (typeof headHash !== "string" || headHash.length === 0) {
      throw new ChainAppendError(
        `Chain head for '${input.topicId}' at sequence ${headSequence} has no stored hash; ` +
          "refusing to chain onto an unverifiable head."
      );
    }
    sequenceNumber = headSequence + 1;
    prevHash = headHash;
  }

  const epochMs = Date.now();

  const inserted = await tx.execute({
    sql: `INSERT INTO events (topic_id, type, agent_id, section_id, data, epoch_ms, sequence_number, prev_hash, hash_alg)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
    args: [
      input.topicId,
      input.eventType,
      input.agentId,
      input.sectionId,
      input.payloadJson,
      epochMs,
      sequenceNumber,
      prevHash,
      CHAIN_HASH_ALG,
    ],
  });

  const rowId = Number(inserted.rows[0]?.id);
  if (!Number.isInteger(rowId)) {
    throw new ChainAppendError(
      `Chained insert for '${input.topicId}' did not return an event id; the chain cannot be completed.`
    );
  }

  // The hash commits to the DB-assigned id, so it can only be computed
  // after the insert — and must be stamped before the transaction commits,
  // or the row would land hashless and break the chain for the next event.
  const eventHash = chainEventHash({
    id: rowId,
    topicId: input.topicId,
    eventType: input.eventType,
    agentId: input.agentId,
    sectionId: input.sectionId,
    payloadJson: input.payloadJson,
    epochMs,
    sequenceNumber,
    prevHash,
  });

  const stamped = await tx.execute({
    sql: "UPDATE events SET event_hash = ? WHERE id = ?",
    args: [eventHash, rowId],
  });
  if (stamped.rowsAffected !== undefined && stamped.rowsAffected !== 1) {
    throw new ChainAppendError(
      `Failed to stamp the chain hash on event ${rowId} (${stamped.rowsAffected} rows affected); ` +
        "the append is rolled back rather than left unchained."
    );
  }

  return { id: rowId, sequenceNumber, prevHash, eventHash, epochMs, alg: CHAIN_HASH_ALG };
}

// ─── The verifier ───────────────────────────────────────────────────────────

/**
 * Kinds of chain break, each reported with the sequence number it was found
 * at. §6.4 Verification: a consumer "MUST treat a hash-chain break, a
 * sequence gap, or a duplicate sequence number" as evidence the server is
 * compromised — so all three are first-class break kinds here, alongside
 * the two ways a row can be unverifiable at all.
 */
export type ChainBreakKind =
  | "gap"
  | "duplicate"
  | "hash-mismatch"
  | "prev-hash-mismatch"
  | "missing-genesis"
  | "missing-hash"
  | "unknown-alg";

export interface ChainBreak {
  kind: ChainBreakKind;
  /** Sequence number the break was found at (null when the row has none). */
  atSequenceNumber: number | null;
  /** `events.id` of the offending row. */
  eventId: number | null;
  expected: string | null;
  actual: string | null;
  detail: string;
}

/**
 * Everything the store knows about a resource's UNCHAINED (pre-#5566)
 * history, assembled at one instant from two independent sources — the live
 * `events` rows and the durable `resource_chain_meta` latch.
 *
 * This type exists because #5598 found that a single number could not carry
 * the distinction the §6.4 genesis rule turns on. `GENESIS` and
 * `GENESIS-UNCHAINED` are ASYMMETRIC claims:
 *
 *   - `GENESIS` is a STRONG claim — "nothing preceded this chain". Any
 *     surviving unchained row falsifies it, and so does the latch, because
 *     both are positive evidence that something did precede it.
 *   - `GENESIS-UNCHAINED` is a WEAK claim — "something preceded this chain".
 *     NO AMOUNT OF DELETION CAN FALSIFY "something existed". Retention
 *     removing the rows is not evidence the rows were never there.
 *
 * The pre-#5598 verifier applied a symmetric equality test to those two
 * asymmetric claims, so the daily retention purge flipped honest chains to
 * `missing-genesis`. See {@link genesisSentinelIsFalsified} for the rule
 * that replaces it.
 *
 * There is deliberately NO numeric overload of the verifier that accepts a
 * bare count: an unmigrated caller must FAIL TO COMPILE rather than silently
 * keep the old, wrong semantics.
 */
export interface ChainHistoryEvidence {
  /**
   * `COUNT(*)` of this resource's rows with `sequence_number IS NULL`, AS OF
   * THE MOMENT THIS EVIDENCE WAS READ.
   *
   * THIS IS A LIVE OBSERVATION THAT CAN ONLY DECREASE. Nothing has written
   * an unchained row since #5566 made `appendChainedEvent` the sole writer
   * of `events`, and the daily retention purge deletes them — so this number
   * falls over time and never rises.
   *
   * **ZERO MUST NEVER BE READ AS "THE CHAIN COVERS THE RESOURCE'S ENTIRE
   * HISTORY".** Zero means exactly one thing: *no unchained row survives
   * today*. It does not distinguish "this resource never had unchained
   * events" from "this resource had forty and retention deleted all of
   * them". That distinction is what
   * {@link ChainHistoryEvidence.hadUnchainedHistory} carries, and it is the
   * ONLY field that carries it.
   *
   * A value `> 0` is positive proof that unchained history exists right now,
   * and therefore falsifies a `GENESIS` sentinel. A value of `0` proves
   * nothing in either direction.
   */
  readonly liveUnchainedEvents: number;

  /**
   * The DURABLE presence latch: `true` iff a `resource_chain_meta` row
   * exists for this resource.
   *
   * PRESENCE-ONLY, and asymmetric by construction:
   *   - `true`  = a row exists = durable evidence that unchained history DID
   *               exist for this resource. This survives the purge that
   *               destroyed the rows it attests to.
   *   - `false` = NO ROW = **UNKNOWN**. It does NOT mean "this resource had
   *               no unchained history". It means nothing has recorded that
   *               it did — which is also the state of every resource whose
   *               unchained rows were purged before #5598 shipped.
   *
   * MONOTONIC: `false → true` only. Nothing may ever delete from
   * `resource_chain_meta` (guarded by a repo-wide source walker). That
   * monotonicity is the entire reason the WRITER may safely consult this
   * field: a latch that could clear would make the writer's genesis decision
   * time-dependent in exactly the way #5598 fixes.
   */
  readonly hadUnchainedHistory: boolean;

  /**
   * `resource_chain_meta.unchained_purged_count`, or `0` when no latch row
   * exists.
   *
   * REPORTING ONLY — never a decision input, and never a substitute for
   * {@link ChainHistoryEvidence.hadUnchainedHistory}. The value `0` is
   * ambiguous by design: it is returned both when there is no latch row at
   * all (unknown) and when a latch row exists that has not yet purged
   * anything (a `pre-purge-sweep` or `backfill` stamp). Branching on
   * `purgedUnchainedEvents > 0` would reintroduce the count-as-evidence bug
   * in a new place.
   *
   * Use it to tell an operator "N unchained events were destroyed for this
   * resource and are permanently unverifiable". Use `hadUnchainedHistory` to
   * decide anything.
   */
  readonly purgedUnchainedEvents: number;
}

/**
 * The sentinel a first chained event SHOULD carry, given this evidence.
 *
 * Returns `GENESIS_UNCHAINED` exactly when
 * `genesisSentinelIsFalsified(GENESIS, evidence)` is `true` — which is what
 * makes the writer and the verifier agree by construction.
 */
export function expectedGenesisSentinel(evidence: ChainHistoryEvidence): string {
  return evidence.liveUnchainedEvents > 0 || evidence.hadUnchainedHistory
    ? GENESIS_UNCHAINED
    : GENESIS;
}

/**
 * True iff `prevHash` is REFUTED by this evidence. Not an equality test —
 * the two sentinels are asymmetric claims:
 *
 * | `prev_hash`         | live | latch | verdict |
 * |---------------------|------|-------|---------|
 * | `GENESIS`           | 0    | false | intact — nothing refutes it (and nothing confirms it) |
 * | `GENESIS`           | 0    | true  | BREAK  — the latch is durable positive evidence |
 * | `GENESIS`           | > 0  | any   | BREAK  — a surviving row refutes "nothing preceded" |
 * | `GENESIS-UNCHAINED` | 0    | false | intact — #5598: deletion is not disproof |
 * | `GENESIS-UNCHAINED` | 0    | true  | intact — the latch agrees with the sentinel |
 * | `GENESIS-UNCHAINED` | > 0  | any   | intact — live rows agree with the sentinel |
 *
 * Anything that is not a sentinel this store may legitimately write is
 * always refuted.
 */
export function genesisSentinelIsFalsified(
  prevHash: string | null,
  evidence: ChainHistoryEvidence
): boolean {
  // A weak claim ("something preceded this") cannot be refuted by absence.
  if (prevHash === GENESIS_UNCHAINED) return false;
  // A strong claim ("nothing preceded this") is refuted by ANY positive
  // evidence — a surviving row OR the durable latch.
  if (prevHash === GENESIS) {
    return evidence.liveUnchainedEvents > 0 || evidence.hadUnchainedHistory;
  }
  // Not a sentinel this store may legitimately write.
  return true;
}

/**
 * Reads BOTH evidence sources in ONE statement. The writer
 * (`appendChainedEvent`, inside its transaction so the latch read rides the
 * same transaction as the append) and the verifier (`verifyResourceChain`)
 * MUST both call this — one query is what makes them ask the same question,
 * and stops the two from drifting apart again.
 *
 * `purged_unchained_events` is `NULL` when there is no latch row, which maps
 * to `0`; presence is carried by `had_unchained_history`, NEVER by the
 * count. `resource_chain_meta` is never deleted from, so
 * `hadUnchainedHistory` is monotonic.
 */
export async function loadChainHistoryEvidence(
  db: DbClient,
  topicId: string
): Promise<ChainHistoryEvidence> {
  const result = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM events
              WHERE topic_id = ? AND sequence_number IS NULL) AS live_unchained_events,
            (SELECT unchained_purged_count FROM resource_chain_meta
              WHERE topic_id = ?) AS purged_unchained_events,
            EXISTS (SELECT 1 FROM resource_chain_meta
              WHERE topic_id = ?) AS had_unchained_history`,
    args: [topicId, topicId, topicId],
  });

  const row = result.rows[0];
  return {
    liveUnchainedEvents: Number(row?.live_unchained_events ?? 0),
    hadUnchainedHistory: row?.had_unchained_history === true,
    purgedUnchainedEvents: Number(row?.purged_unchained_events ?? 0),
  };
}

/** Structured verification report — never a boolean. */
export interface ChainVerificationReport {
  resourceId: string;
  entityType: string;
  alg: string;
  /** Rows participating in the chain. */
  chainedEvents: number;
  /**
   * Rows for this resource written before chaining existed and STILL
   * PRESENT. NOT part of the chain and never backfilled — reported so the
   * gap in coverage is visible instead of implied.
   *
   * #5598 — a LIVE OBSERVATION THAT CAN ONLY DECREASE, identical to
   * {@link ChainHistoryEvidence.liveUnchainedEvents}, not a historical
   * total. Zero here must never be read as "the chain covers everything":
   * the daily retention purge deletes exactly these rows. Read
   * {@link ChainVerificationReport.hadUnchainedHistory} for the distinction
   * between "had none" and "had some, and retention deleted them".
   */
  unchainedPriorEvents: number;
  /**
   * #5598 — the durable `resource_chain_meta` presence latch. `true` =
   * unchained history DID exist; `false` = NO ROW = **unknown**, never "had
   * none". Mirrors {@link ChainHistoryEvidence.hadUnchainedHistory} and is
   * the only field on this report that carries that distinction.
   */
  hadUnchainedHistory: boolean;
  /**
   * #5598 — unchained events destroyed by retention, permanently
   * unverifiable. REPORTING ONLY: `0` is ambiguous (no latch row at all, or
   * a latch that has purged nothing yet), so never branch on it. Mirrors
   * {@link ChainHistoryEvidence.purgedUnchainedEvents}.
   */
  purgedUnchainedPriorEvents: number;
  /**
   * #5598 — the full evidence the genesis verdict was reached on, exactly as
   * read. Frozen invariants:
   * `unchainedPriorEvents === historyEvidence.liveUnchainedEvents`,
   * `hadUnchainedHistory === historyEvidence.hadUnchainedHistory`,
   * `purgedUnchainedPriorEvents === historyEvidence.purgedUnchainedEvents`.
   */
  historyEvidence: ChainHistoryEvidence;
  /** The declared genesis sentinel the chain starts from (null when empty). */
  genesis: string | null;
  firstSequenceNumber: number | null;
  headSequenceNumber: number | null;
  /** Chain head hash — the value the resource's NEXT event must carry as prev_hash. */
  headHash: string | null;
  intact: boolean;
  /** The FIRST break found. Everything after a break is untrustworthy by definition. */
  firstBreak: ChainBreak | null;
}

/** A raw `events` row as the verifier reads it. */
export interface ChainRow {
  id: number;
  topic_id: string;
  type: string;
  agent_id: string | null;
  section_id: string | null;
  data: string | null;
  epoch_ms: number | string | null;
  sequence_number: number | string | null;
  prev_hash: string | null;
  event_hash: string | null;
  hash_alg: string | null;
}

function break_(
  kind: ChainBreakKind,
  row: { id?: number; sequence_number?: number | string | null },
  detail: string,
  expected: string | null = null,
  actual: string | null = null
): ChainBreak {
  const seq = row.sequence_number === null || row.sequence_number === undefined ? null : Number(row.sequence_number);
  return {
    kind,
    atSequenceNumber: seq !== null && Number.isFinite(seq) ? seq : null,
    eventId: row.id ?? null,
    expected,
    actual,
    detail,
  };
}

/**
 * Walks a fully-loaded chain (rows ordered by `sequence_number` ascending)
 * and reports the FIRST break. Pure — no DB — so it is exhaustively
 * testable and a caller can verify rows fetched any way it likes.
 *
 * An empty chain is intact (nothing has diverged), but the report still
 * carries the history evidence so "this resource has 40 unverifiable rows
 * and no chain" reads as exactly that rather than as a clean bill.
 *
 * #5598 — the third parameter is the whole {@link ChainHistoryEvidence}
 * object, NOT a count, and there is deliberately no numeric overload: an
 * unmigrated caller must FAIL TO COMPILE rather than silently keep the old
 * semantics, under which a live count of `0` was read as proof that nothing
 * preceded the chain.
 */
export function verifyOrderedChain(
  resourceId: string,
  orderedRows: readonly ChainRow[],
  evidence: ChainHistoryEvidence
): ChainVerificationReport {
  const report: ChainVerificationReport = {
    resourceId,
    entityType: CHAIN_ENTITY_TYPE,
    alg: CHAIN_HASH_ALG,
    chainedEvents: orderedRows.length,
    unchainedPriorEvents: evidence.liveUnchainedEvents,
    hadUnchainedHistory: evidence.hadUnchainedHistory,
    purgedUnchainedPriorEvents: evidence.purgedUnchainedEvents,
    historyEvidence: evidence,
    genesis: null,
    firstSequenceNumber: null,
    headSequenceNumber: null,
    headHash: null,
    intact: true,
    firstBreak: null,
  };

  if (orderedRows.length === 0) return report;

  report.genesis = orderedRows[0].prev_hash;
  report.firstSequenceNumber = Number(orderedRows[0].sequence_number);

  let expectedSequence = FIRST_SEQUENCE_NUMBER;
  let expectedPrevHash: string | null = null; // null ⇒ the genesis row

  for (const row of orderedRows) {
    const sequence = Number(row.sequence_number);

    if (!Number.isInteger(sequence)) {
      return fail(report, break_("gap", row, "Chained row carries no usable sequence number."));
    }

    // ── Sequence: gapless and never duplicated (§6.4 per-resource sequencing).
    if (sequence < expectedSequence) {
      return fail(
        report,
        break_(
          "duplicate",
          row,
          `Duplicate sequence number ${sequence}: a sequence number is never reused or reassigned.`,
          String(expectedSequence),
          String(sequence)
        )
      );
    }
    if (sequence > expectedSequence) {
      return fail(
        report,
        break_(
          "gap",
          row,
          `Sequence gap: expected ${expectedSequence} but found ${sequence}. A deleted event leaves a gap.`,
          String(expectedSequence),
          String(sequence)
        )
      );
    }

    // ── The link.
    if (expectedPrevHash === null) {
      // Genesis row. NOT an equality test against a re-derived expectation:
      // the two sentinels are asymmetric claims and only ONE of them is
      // falsifiable — see genesisSentinelIsFalsified. Pre-#5598 this compared
      // the stored sentinel against `liveCount > 0 ? UNCHAINED : GENESIS`, so
      // the daily retention purge — which deletes exactly the rows that count
      // — flipped honest `GENESIS-UNCHAINED` chains to `missing-genesis`: a
      // byte-identical, untampered chain reported as tampered.
      if (genesisSentinelIsFalsified(row.prev_hash, evidence)) {
        return fail(
          report,
          break_(
            "missing-genesis",
            row,
            row.prev_hash === GENESIS
              ? `Genesis sentinel '${GENESIS}' claims nothing preceded this chain, but ${describeUnchainedHistory(evidence)}.`
              : `First chained event must declare a genesis sentinel, found '${row.prev_hash ?? "null"}'.`,
            expectedGenesisSentinel(evidence),
            row.prev_hash
          )
        );
      }
    } else if (row.prev_hash !== expectedPrevHash) {
      return fail(
        report,
        break_(
          "prev-hash-mismatch",
          row,
          `prev_hash at sequence ${sequence} does not match the recomputed hash of sequence ${sequence - 1}.`,
          expectedPrevHash,
          row.prev_hash
        )
      );
    }

    // ── The row must be verifiable at all.
    if (row.hash_alg !== CHAIN_HASH_ALG) {
      // §6.4: reject an unrecognised algorithm rather than skipping
      // verification — an unverifiable row is not a verified row.
      return fail(
        report,
        break_(
          "unknown-alg",
          row,
          `Unrecognised chain hash algorithm '${row.hash_alg ?? "null"}' — verification is refused, not skipped.`,
          CHAIN_HASH_ALG,
          row.hash_alg
        )
      );
    }
    if (typeof row.event_hash !== "string" || row.event_hash.length === 0) {
      return fail(report, break_("missing-hash", row, `Chained event at sequence ${sequence} stores no hash.`));
    }

    // ── Recompute.
    const recomputed = chainEventHash({
      id: row.id,
      topicId: row.topic_id,
      eventType: row.type,
      agentId: row.agent_id,
      sectionId: row.section_id,
      payloadJson: row.data,
      epochMs: Number(row.epoch_ms),
      sequenceNumber: sequence,
      prevHash: row.prev_hash ?? "",
    });
    if (recomputed !== row.event_hash) {
      return fail(
        report,
        break_(
          "hash-mismatch",
          row,
          `Recomputed hash at sequence ${sequence} does not match the stored hash — the row has been altered.`,
          recomputed,
          row.event_hash
        )
      );
    }

    report.headSequenceNumber = sequence;
    report.headHash = recomputed;
    expectedPrevHash = recomputed;
    expectedSequence = sequence + 1;
  }

  return report;
}

/**
 * Human-readable statement of WHY a `GENESIS` sentinel is refuted. Names the
 * source of the refutation — surviving rows, the durable latch, or both — so
 * an operator reading the break knows whether the evidence still exists.
 */
function describeUnchainedHistory(evidence: ChainHistoryEvidence): string {
  const parts: string[] = [];
  if (evidence.liveUnchainedEvents > 0) {
    parts.push(`${evidence.liveUnchainedEvents} unchained prior event(s) still exist for this resource`);
  }
  if (evidence.hadUnchainedHistory) {
    parts.push(
      evidence.purgedUnchainedEvents > 0
        ? `the durable resource_chain_meta latch records unchained history (${evidence.purgedUnchainedEvents} event(s) since purged and now permanently unverifiable)`
        : "the durable resource_chain_meta latch records that unchained history existed"
    );
  }
  return parts.length > 0 ? parts.join(" and ") : "unchained history is on record for this resource";
}

function fail(report: ChainVerificationReport, chainBreak: ChainBreak): ChainVerificationReport {
  report.intact = false;
  report.firstBreak = chainBreak;
  return report;
}

/**
 * Loads a resource's chain and verifies it. Callable module function — the
 * KG has no admin HTTP surface to hang this off today, so exposing it as an
 * operator/admin endpoint is deliberately left as follow-up rather than
 * inventing a new public route here (and #5563 owns the discovery document).
 * The chain columns are already published: `/api/pact/{topicId}/events`
 * selects `e.*`, so `sequence_number`, `prev_hash`, `event_hash`, `hash_alg`
 * and `epoch_ms` reach third-party consumers with no route change.
 */
export async function verifyResourceChain(db: DbClient, topicId: string): Promise<ChainVerificationReport> {
  const chained = await db.execute({
    sql: `SELECT id, topic_id, type, agent_id, section_id, data, epoch_ms,
                 sequence_number, prev_hash, event_hash, hash_alg
          FROM events
          WHERE topic_id = ? AND sequence_number IS NOT NULL
          ORDER BY sequence_number ASC, id ASC`,
    args: [topicId],
  });

  // #5598 — ONE statement for all three evidence fields (the live unchained
  // rows, the durable latch, and the purged count), and it is the SAME
  // statement `appendChainedEvent` uses to choose the sentinel it stamps.
  const evidence = await loadChainHistoryEvidence(db, topicId);

  return verifyOrderedChain(topicId, chained.rows as unknown as ChainRow[], evidence);
}
