/**
 * #5566 — PACT v2.3 §6.4 provenance chain over the KG's PACT operation log.
 *
 * Coverage, matching the issue's Definition of done:
 *   - the chain arithmetic (RFC 8785 canonicalization + the hash layout)
 *   - the transactional append: gapless sequencing, prev_hash linkage, and
 *     the fact that a failure to chain FAILS the operation
 *   - the declared genesis (both sentinels), with legacy rows untouched
 *   - the verifier reporting the FIRST break: gap, duplicate, tamper
 *
 * #5598 extends it to the §6.3 retention interaction, because retention is
 * what made an honest chain read as tampered:
 *   - the six-row genesis truth table over `ChainHistoryEvidence` — GENESIS is
 *     falsifiable, GENESIS-UNCHAINED is not falsifiable by absence
 *   - the `resource_chain_meta` latch end to end: purge, then first append,
 *     then verify (the Defect 2 regression)
 *   - live / purged / latch reported as three distinct facts, never one number
 *   - six source-level guards over the delete paths, the latch, and the SQL
 *     shapes this codebase fails silently on
 *
 * The append tests run against a stateful in-memory `DbClient` mock — the
 * same shape `consensus-sweep-paging.test.ts` uses — that implements exactly
 * the SQL surface `appendChainedEvent` issues (advisory lock, chain-head
 * read, the shared history-evidence read, insert-returning, hash stamp) plus
 * the two `resource_chain_meta` writers `retention.ts` builds. Real Postgres is not
 * reachable from CI or a dev box here (`sites/source` runs against Neon and
 * ships NO DB-integration harness — every existing DB test in this directory
 * is either a pure-function test or a SQL-surface mock), so the unit layer
 * is made as strong as the seam allows: every statement the writer issues is
 * recorded and asserted, and the atomicity the mock cannot prove is the one
 * thing the production `DbClient.transaction` seam owns.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DbClient, DbResult } from "@/lib/db";
import {
  CHAIN_HASH_ALG,
  CHAIN_LOCK_NAMESPACE,
  ChainAppendError,
  FIRST_SEQUENCE_NUMBER,
  GENESIS,
  GENESIS_UNCHAINED,
  appendChainedEvent,
  canonicalize,
  chainCanonicalBytes,
  chainEventHash,
  chainLockKey,
  expectedGenesisSentinel,
  genesisSentinelIsFalsified,
  verifyOrderedChain,
  verifyResourceChain,
  type ChainHistoryEvidence,
  type ChainRow,
} from "./provenance-chain";
import {
  CHAIN_META_ORIGIN_BACKFILL,
  CHAIN_META_ORIGIN_PRE_PURGE_SWEEP,
  UNCHAINED_EVENT_RETENTION_DAYS,
  buildUnchainedEventPurge,
  buildUnchainedHistoryStamp,
  buildUnchainedRowCount,
  readUnchainedPurgeResult,
  type ChainMetaOrigin,
} from "./retention";

// ─── Chain history evidence, as the verifier and the writer both read it ────

/**
 * #5598 — the third argument to {@link verifyOrderedChain} is the whole
 * {@link ChainHistoryEvidence} object, never a bare count. `liveUnchainedEvents`
 * and `hadUnchainedHistory` are independent facts and only one of them survives
 * retention, so a single number cannot carry the distinction the §6.4 genesis
 * rule turns on.
 */
function evidence(
  liveUnchainedEvents: number,
  hadUnchainedHistory: boolean,
  purgedUnchainedEvents = 0
): ChainHistoryEvidence {
  return { liveUnchainedEvents, hadUnchainedHistory, purgedUnchainedEvents };
}

/**
 * No live unchained rows AND no durable latch — i.e. **UNKNOWN**, not "this
 * resource had no prior history". Every pre-#5598 call site that passed the
 * literal `0` meant this, and the old signature let `0` be misread as proof
 * that nothing preceded the chain.
 */
const NO_PRIOR_HISTORY: ChainHistoryEvidence = evidence(0, false);

// ─── In-memory events table implementing the chained-append SQL surface ─────

type Row = {
  id: number;
  topic_id: string;
  type: string;
  agent_id: string | null;
  section_id: string | null;
  data: string | null;
  epoch_ms: number | null;
  /** Wall clock the row was written at — what the retention bound compares. */
  created_at: number;
  sequence_number: number | null;
  prev_hash: string | null;
  event_hash: string | null;
  hash_alg: string | null;
};

/**
 * A `resource_chain_meta` row — the #5598 durable PRESENCE latch.
 *
 * Modelled as its own table, not a column on `events`, for the reason the
 * production schema does it: the resource whose pre-history was purged may have
 * no surviving row anywhere to hang a marker on.
 */
type MetaRow = {
  topic_id: string;
  unchained_purged_count: number;
  first_observed_at: number;
  last_purged_at: number | null;
  origin: ChainMetaOrigin;
};

type Stmt = { sql: string; args: unknown[] };

const DAY_MS = 86_400_000;

class EventsDb implements DbClient {
  rows: Row[] = [];
  /** `resource_chain_meta`, keyed by topic_id (its PRIMARY KEY). */
  chainMeta = new Map<string, MetaRow>();
  statements: Stmt[] = [];
  transactions = 0;
  /** Statement fragment that should blow up, to model a chaining failure. */
  failOn: string | null = null;
  private nextId = 1;

  /**
   * Seed a pre-#5566 (unchained) row: NULL sequence_number, no hash.
   *
   * `ageDays` back-dates `created_at` so a test can put a row on either side of
   * the §6.3 retention boundary. Default 0 = written just now, so every
   * pre-#5598 test that never purges is unaffected.
   */
  addLegacyRow(topicId: string, type: string, ageDays = 0): Row {
    const row: Row = {
      id: this.nextId++,
      topic_id: topicId,
      type,
      agent_id: null,
      section_id: null,
      data: null,
      epoch_ms: null,
      created_at: Date.now() - ageDays * DAY_MS,
      sequence_number: null,
      prev_hash: null,
      event_hash: null,
      hash_alg: null,
    };
    this.rows.push(row);
    return row;
  }

  chained(topicId: string): ChainRow[] {
    return this.rows
      .filter((r) => r.topic_id === topicId && r.sequence_number !== null)
      .sort((a, b) => a.sequence_number! - b.sequence_number! || a.id - b.id) as unknown as ChainRow[];
  }

  async execute(stmtOrSql: string | { sql: string; args: unknown[] }): Promise<DbResult> {
    const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
    const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
    this.statements.push({ sql, args });

    if (this.failOn && sql.includes(this.failOn)) {
      throw new Error(`EventsDb: simulated failure on ${this.failOn}`);
    }

    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };

    if (sql.includes("SELECT sequence_number, event_hash FROM events")) {
      const head = this.rows
        .filter((r) => r.topic_id === args[0] && r.sequence_number !== null)
        .sort((a, b) => b.sequence_number! - a.sequence_number!)[0];
      return { rows: head ? [{ sequence_number: head.sequence_number, event_hash: head.event_hash }] : [] };
    }

    // ── #5598 `loadChainHistoryEvidence` — the ONE statement the writer and
    // the verifier now share. Three subselects, three placeholders, all bound
    // to the same topic_id.
    if (sql.includes("live_unchained_events")) {
      const topicId = args[0] as string;
      const live = this.rows.filter(
        (r) => r.topic_id === topicId && r.sequence_number === null
      ).length;
      const meta = this.chainMeta.get(topicId);
      return {
        rows: [
          {
            live_unchained_events: live,
            // Scalar subquery over a missing row yields NULL, NOT 0 — the
            // ambiguity `purgedUnchainedEvents` is documented to carry.
            purged_unchained_events: meta ? meta.unchained_purged_count : null,
            had_unchained_history: meta !== undefined,
          },
        ],
      };
    }

    // ── #5598 the purge CTE: delete expired unchained rows AND stamp the latch
    // in ONE statement. Modelled as one atomic step precisely because that is
    // the property `buildUnchainedEventPurge` exists to guarantee.
    if (sql.includes("DELETE FROM events")) {
      const cutoff = Date.now() - Number(args[0]) * DAY_MS;
      const origin = args[1] as ChainMetaOrigin;
      const doomed = new Set(
        this.rows.filter((r) => r.sequence_number === null && r.created_at < cutoff)
      );
      this.rows = this.rows.filter((r) => !doomed.has(r));

      const perTopic = new Map<string, number>();
      for (const r of doomed) perTopic.set(r.topic_id, (perTopic.get(r.topic_id) ?? 0) + 1);
      for (const [topicId, purged] of perTopic) {
        const existing = this.chainMeta.get(topicId);
        if (existing) {
          // ON CONFLICT DO UPDATE — accumulates across runs; `origin` and
          // `first_observed_at` are deliberately NOT in the SET list.
          existing.unchained_purged_count += purged;
          existing.last_purged_at = Date.now();
        } else {
          this.chainMeta.set(topicId, {
            topic_id: topicId,
            unchained_purged_count: purged,
            first_observed_at: Date.now(),
            last_purged_at: Date.now(),
            origin,
          });
        }
      }
      // rowsAffected is the OUTER one-row SELECT — always 1, no matter how many
      // events were deleted. Modelled faithfully so a caller that reads it
      // instead of rows[0] gets the wrong answer here too.
      return {
        rows: [{ events_deleted: doomed.size, resources_stamped: perTopic.size }],
        rowsAffected: 1,
      };
    }

    // ── #5598 the pre-pass / backfill stamp: latch every resource that has an
    // unchained row RIGHT NOW, deleting nothing. Presence-only, so DO NOTHING.
    if (sql.includes("INSERT INTO resource_chain_meta")) {
      const origin = args[0] as ChainMetaOrigin;
      const topicIds = [
        ...new Set(this.rows.filter((r) => r.sequence_number === null).map((r) => r.topic_id)),
      ];
      const inserted: Record<string, unknown>[] = [];
      for (const topicId of topicIds) {
        if (this.chainMeta.has(topicId)) continue; // ON CONFLICT DO NOTHING
        this.chainMeta.set(topicId, {
          topic_id: topicId,
          unchained_purged_count: 0,
          first_observed_at: Date.now(),
          last_purged_at: null, // latched, nothing deleted yet
          origin,
        });
        inserted.push({ topic_id: topicId });
      }
      return { rows: inserted, rowsAffected: inserted.length };
    }

    if (sql.includes("INSERT INTO events")) {
      const [topicId, type, agentId, sectionId, data, epochMs, sequenceNumber, prevHash, alg] = args as [
        string, string, string | null, string | null, string | null, number, number, string, string,
      ];
      // The production UNIQUE INDEX on (topic_id, sequence_number).
      if (this.rows.some((r) => r.topic_id === topicId && r.sequence_number === sequenceNumber)) {
        throw new Error(`duplicate key value violates unique constraint "idx_events_topic_sequence"`);
      }
      const row: Row = {
        id: this.nextId++,
        topic_id: topicId,
        type,
        agent_id: agentId,
        section_id: sectionId,
        data,
        epoch_ms: epochMs,
        created_at: Date.now(),
        sequence_number: sequenceNumber,
        prev_hash: prevHash,
        event_hash: null,
        hash_alg: alg,
      };
      this.rows.push(row);
      return { rows: [{ id: row.id }], rowsAffected: 1 };
    }

    if (sql.includes("UPDATE events SET event_hash")) {
      const row = this.rows.find((r) => r.id === args[1]);
      if (!row) return { rows: [], rowsAffected: 0 };
      row.event_hash = args[0] as string;
      return { rows: [], rowsAffected: 1 };
    }

    if (sql.includes("FROM events") && sql.includes("ORDER BY sequence_number ASC")) {
      return { rows: this.chained(args[0] as string) as unknown as Record<string, unknown>[] };
    }

    throw new Error(`EventsDb: unhandled SQL: ${sql}`);
  }

  async batch(stmts: Stmt[]): Promise<void> {
    for (const s of stmts) await this.execute(s);
  }

  /** Snapshot/rollback so a failed transaction leaves nothing behind. */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const snapshot = this.rows.map((r) => ({ ...r }));
    const metaSnapshot = new Map([...this.chainMeta].map(([k, v]) => [k, { ...v }]));
    const nextId = this.nextId;
    try {
      return await fn(this);
    } catch (e) {
      this.rows = snapshot;
      this.chainMeta = metaSnapshot;
      this.nextId = nextId;
      throw e;
    }
  }
}

const APPEND = (topicId: string, eventType: string, payload: Record<string, unknown> | null = null) => ({
  topicId,
  eventType,
  agentId: "agent-1",
  sectionId: null,
  payloadJson: payload ? JSON.stringify(payload) : null,
});

// ─── RFC 8785 canonicalization ──────────────────────────────────────────────

describe("RFC 8785 (JCS) canonicalization (#5566)", () => {
  it("sorts object members by UTF-16 code unit, not insertion order", () => {
    expect(canonicalize({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
  });

  it("is insertion-order independent — the same object hashes the same either way", () => {
    expect(canonicalize({ x: "1", y: [1, 2], z: null })).toBe(canonicalize({ z: null, y: [1, 2], x: "1" }));
  });

  it("drops undefined members but keeps explicit nulls", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("emits no insignificant whitespace and preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize({ a: { b: [1, { c: "d" }] } })).toBe('{"a":{"b":[1,{"c":"d"}]}}');
  });

  it("refuses non-finite numbers rather than emitting something unverifiable", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow(ChainAppendError);
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow(ChainAppendError);
  });
});

describe("the hashed event layout (#5566)", () => {
  const record = {
    id: 42,
    topicId: "topic-a",
    eventType: "pact.proposal.merged",
    agentId: "agent-1",
    sectionId: "sec-1",
    payloadJson: '{"proposalId":"p1"}',
    epochMs: 1747276800000,
    sequenceNumber: 7,
    prevHash: "abc",
  };

  it("emits the documented member set in RFC 8785 order", () => {
    expect(chainCanonicalBytes(record)).toBe(
      '{"agentId":"agent-1","alg":"sha256-jcs@1","entityId":"topic-a","entityType":"pact-topic",' +
        '"epochMs":1747276800000,"eventType":"pact.proposal.merged","id":"evt_42",' +
        '"payloadJson":"{\\"proposalId\\":\\"p1\\"}","prev_hash":"abc","sectionId":"sec-1","sequenceNumber":7}'
    );
  });

  it("produces an unpadded base64url SHA-256 and is deterministic", () => {
    const hash = chainEventHash(record);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(chainEventHash({ ...record })).toBe(hash);
  });

  it("binds every material field — changing any one changes the hash", () => {
    const base = chainEventHash(record);
    expect(chainEventHash({ ...record, sequenceNumber: 8 })).not.toBe(base);
    expect(chainEventHash({ ...record, prevHash: "abd" })).not.toBe(base);
    expect(chainEventHash({ ...record, payloadJson: '{"proposalId":"p2"}' })).not.toBe(base);
    expect(chainEventHash({ ...record, epochMs: record.epochMs + 1 })).not.toBe(base);
    expect(chainEventHash({ ...record, eventType: "pact.proposal.rejected" })).not.toBe(base);
    expect(chainEventHash({ ...record, id: 43 })).not.toBe(base);
  });

  it("refuses to produce a hash under an algorithm it does not implement", () => {
    expect(() => chainEventHash({ ...record, alg: "blake3" })).toThrow(/Unknown chain hash algorithm/);
  });

  it("derives a stable int4 advisory-lock key per resource", () => {
    const key = chainLockKey("topic-a");
    expect(Number.isInteger(key)).toBe(true);
    expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(key).toBeLessThan(2 ** 31);
    expect(chainLockKey("topic-a")).toBe(key);
    expect(chainLockKey("topic-b")).not.toBe(key);
  });
});

// ─── The transactional append ───────────────────────────────────────────────

describe("appendChainedEvent — gapless sequencing + prev_hash (#5566)", () => {
  it("starts a virgin resource at 1 with the GENESIS sentinel", async () => {
    const db = new EventsDb();
    const appended = await appendChainedEvent(db, APPEND("topic-a", "pact.agent.joined"));

    expect(appended.sequenceNumber).toBe(FIRST_SEQUENCE_NUMBER);
    expect(appended.prevHash).toBe(GENESIS);
    expect(appended.alg).toBe(CHAIN_HASH_ALG);
    expect(db.rows[0].event_hash).toBe(appended.eventHash);
  });

  it("takes a per-resource advisory lock BEFORE reading the chain head", async () => {
    const db = new EventsDb();
    await appendChainedEvent(db, APPEND("topic-a", "pact.agent.joined"));

    expect(db.statements[0].sql).toContain("pg_advisory_xact_lock");
    expect(db.statements[0].args).toEqual([CHAIN_LOCK_NAMESPACE, chainLockKey("topic-a")]);
    expect(db.statements[1].sql).toContain("SELECT sequence_number, event_hash FROM events");
  });

  it("assigns strictly monotonic gapless numbers and links each prev_hash to the head", async () => {
    const db = new EventsDb();
    const first = await appendChainedEvent(db, APPEND("topic-a", "pact.agent.joined"));
    const second = await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.created", { p: 1 }));
    const third = await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged", { p: 1 }));

    expect([first, second, third].map((e) => e.sequenceNumber)).toEqual([1, 2, 3]);
    expect(second.prevHash).toBe(first.eventHash);
    expect(third.prevHash).toBe(second.eventHash);
    expect(verifyOrderedChain("topic-a", db.chained("topic-a"), NO_PRIOR_HISTORY).intact).toBe(true);
  });

  it("keeps each resource on its OWN chain", async () => {
    const db = new EventsDb();
    await appendChainedEvent(db, APPEND("topic-a", "pact.agent.joined"));
    await appendChainedEvent(db, APPEND("topic-b", "pact.agent.joined"));
    await appendChainedEvent(db, APPEND("topic-a", "pact.intent.declared"));

    expect(db.chained("topic-a").map((r) => r.sequence_number)).toEqual([1, 2]);
    expect(db.chained("topic-b").map((r) => r.sequence_number)).toEqual([1]);
    expect(db.chained("topic-b")[0].prev_hash).toBe(GENESIS);
  });

  it("refuses to chain onto a head that stores no hash", async () => {
    const db = new EventsDb();
    await appendChainedEvent(db, APPEND("topic-a", "pact.agent.joined"));
    db.rows[0].event_hash = null; // a hashless head cannot be linked to

    await expect(appendChainedEvent(db, APPEND("topic-a", "pact.intent.declared"))).rejects.toThrow(
      ChainAppendError
    );
  });
});

describe("declared genesis over pre-existing rows (#5566)", () => {
  it("uses GENESIS-UNCHAINED when the resource already has unchained history", async () => {
    const db = new EventsDb();
    db.addLegacyRow("topic-a", "pact.agent.joined");
    db.addLegacyRow("topic-a", "pact.proposal.created");

    const appended = await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));

    expect(appended.prevHash).toBe(GENESIS_UNCHAINED);
    expect(appended.sequenceNumber).toBe(FIRST_SEQUENCE_NUMBER);
  });

  it("NEVER backfills the legacy rows — they stay NULL forever", async () => {
    const db = new EventsDb();
    const legacy = db.addLegacyRow("topic-a", "pact.agent.joined");
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.approved"));

    expect(legacy.sequence_number).toBeNull();
    expect(legacy.prev_hash).toBeNull();
    expect(legacy.event_hash).toBeNull();
    // The chain covers only what it actually witnessed.
    expect(db.chained("topic-a").map((r) => r.sequence_number)).toEqual([1, 2]);
  });

  it("numbers from 1, not from unchainedCount + 1 — no sequence is ever asserted retroactively", async () => {
    const db = new EventsDb();
    for (let i = 0; i < 40; i++) db.addLegacyRow("topic-a", "pact.agent.joined");

    const appended = await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));

    expect(appended.sequenceNumber).toBe(1);
  });

  it("verifies clean, reporting the unchained history rather than absorbing it", async () => {
    const db = new EventsDb();
    db.addLegacyRow("topic-a", "pact.agent.joined");
    db.addLegacyRow("topic-a", "pact.proposal.created");
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.approved"));

    const report = await verifyResourceChain(db, "topic-a");

    expect(report.intact).toBe(true);
    expect(report.genesis).toBe(GENESIS_UNCHAINED);
    expect(report.chainedEvents).toBe(2);
    expect(report.unchainedPriorEvents).toBe(2);
    expect(report.headSequenceNumber).toBe(2);
  });

  it("the writer's history query is sequence_number IS NULL-scoped, and IDENTICAL to the verifier's", async () => {
    // #5598 §5 — the writer's genesis branch used to run its own count that
    // omitted the `AND sequence_number IS NULL` predicate the verifier's count
    // carried. Latent, never yet wrong (the branch is guarded by
    // `head.rows.length === 0`, so no chained row exists and the two counts are
    // provably equal at that instant) — but writer and verifier deciding a
    // sentinel from two different questions is the shape of the bug this issue
    // is about. There is now ONE query, `loadChainHistoryEvidence`, and both
    // call it.
    //
    // Without the predicate, a resource's own chained rows would count as
    // "unchained prior history" and every append after the first would stamp
    // GENESIS-UNCHAINED onto a chain that had a real head.
    const writerDb = new EventsDb();
    await appendChainedEvent(writerDb, APPEND("topic-a", "pact.agent.joined"));
    const writerQuery = writerDb.statements.find((s) => s.sql.includes("live_unchained_events"));

    expect(writerQuery).toBeDefined();
    expect(writerQuery!.sql).toContain("sequence_number IS NULL");
    // All three placeholders bind the same resource — the live count, the
    // purged count and the presence probe are one snapshot of one resource.
    expect(writerQuery!.args).toEqual(["topic-a", "topic-a", "topic-a"]);
    // It reads the latch too, not merely the live rows.
    expect(writerQuery!.sql).toContain("resource_chain_meta");

    const verifierDb = new EventsDb();
    await appendChainedEvent(verifierDb, APPEND("topic-a", "pact.agent.joined"));
    verifierDb.statements.length = 0;
    await verifyResourceChain(verifierDb, "topic-a");
    const verifierQuery = verifierDb.statements.find((s) => s.sql.includes("live_unchained_events"));

    expect(verifierQuery?.sql).toBe(writerQuery!.sql);
    expect(verifierQuery?.args).toEqual(writerQuery!.args);
  });
});

describe("a failure to chain FAILS the operation (#5566)", () => {
  it("throws when the chain-head read fails — no unchained row is written", async () => {
    const db = new EventsDb();
    db.failOn = "SELECT sequence_number, event_hash FROM events";

    await expect(
      db.transaction((tx) => appendChainedEvent(tx, APPEND("topic-a", "pact.agent.joined")))
    ).rejects.toThrow(/simulated failure/);
    expect(db.rows).toHaveLength(0);
  });

  it("throws when the hash stamp fails — the whole append rolls back", async () => {
    const db = new EventsDb();
    db.failOn = "UPDATE events SET event_hash";

    await expect(
      db.transaction((tx) => appendChainedEvent(tx, APPEND("topic-a", "pact.agent.joined")))
    ).rejects.toThrow(/simulated failure/);
    // The insert did happen inside the transaction; the rollback removed it.
    expect(db.rows).toHaveLength(0);
    expect(db.statements.some((s) => s.sql.includes("INSERT INTO events"))).toBe(true);
  });

  it("throws when the insert returns no id, rather than leaving an unhashed row", async () => {
    const db = new EventsDb();
    const patched: DbClient = {
      execute: async (stmt) => {
        const result = await db.execute(stmt);
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        return sql.includes("INSERT INTO events") ? { rows: [], rowsAffected: 1 } : result;
      },
      batch: (stmts) => db.batch(stmts),
    };

    await expect(appendChainedEvent(patched, APPEND("topic-a", "pact.agent.joined"))).rejects.toThrow(
      ChainAppendError
    );
  });

  it("throws when the hash stamp matches no row", async () => {
    const db = new EventsDb();
    const patched: DbClient = {
      execute: async (stmt) => {
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        const result = await db.execute(stmt);
        return sql.includes("UPDATE events SET event_hash") ? { rows: [], rowsAffected: 0 } : result;
      },
      batch: (stmts) => db.batch(stmts),
    };

    await expect(appendChainedEvent(patched, APPEND("topic-a", "pact.agent.joined"))).rejects.toThrow(
      /Failed to stamp the chain hash/
    );
  });

  it("surfaces the unique-index violation when a duplicate sequence number is attempted", async () => {
    const db = new EventsDb();
    await appendChainedEvent(db, APPEND("topic-a", "pact.agent.joined"));
    // Model a lost advisory lock: a racing writer that read the same head.
    await expect(
      db.execute({
        sql: `INSERT INTO events (topic_id, type, agent_id, section_id, data, epoch_ms, sequence_number, prev_hash, hash_alg)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: ["topic-a", "pact.agent.joined", null, null, null, Date.now(), 1, GENESIS, CHAIN_HASH_ALG],
      })
    ).rejects.toThrow(/idx_events_topic_sequence/);
  });
});

// ─── The verifier ───────────────────────────────────────────────────────────

/** Build a valid chain of `count` events, then let a test corrupt it. */
function buildChain(count: number, genesis: string = GENESIS): ChainRow[] {
  const rows: ChainRow[] = [];
  let prevHash = genesis;
  for (let i = 0; i < count; i++) {
    const sequenceNumber = FIRST_SEQUENCE_NUMBER + i;
    const row: ChainRow = {
      id: 100 + i,
      topic_id: "topic-a",
      type: "pact.proposal.merged",
      agent_id: "agent-1",
      section_id: null,
      data: `{"n":${i}}`,
      epoch_ms: 1747276800000 + i,
      sequence_number: sequenceNumber,
      prev_hash: prevHash,
      event_hash: null,
      hash_alg: CHAIN_HASH_ALG,
    };
    row.event_hash = chainEventHash({
      id: row.id,
      topicId: row.topic_id,
      eventType: row.type,
      agentId: row.agent_id,
      sectionId: row.section_id,
      payloadJson: row.data,
      epochMs: row.epoch_ms as number,
      sequenceNumber,
      prevHash,
    });
    prevHash = row.event_hash;
    rows.push(row);
  }
  return rows;
}

describe("verifyOrderedChain — structured first-break report (#5566)", () => {
  it("reports an empty chain as intact but names the unverifiable prior history", () => {
    const report = verifyOrderedChain("topic-a", [], evidence(12, false));
    expect(report.intact).toBe(true);
    expect(report.firstBreak).toBeNull();
    expect(report.genesis).toBeNull();
    expect(report.chainedEvents).toBe(0);
    expect(report.unchainedPriorEvents).toBe(12);
  });

  it("accepts an intact chain and reports the head a consumer must link to", () => {
    const rows = buildChain(4);
    const report = verifyOrderedChain("topic-a", rows, NO_PRIOR_HISTORY);

    expect(report.intact).toBe(true);
    expect(report.firstBreak).toBeNull();
    expect(report.alg).toBe(CHAIN_HASH_ALG);
    expect(report.genesis).toBe(GENESIS);
    expect(report.firstSequenceNumber).toBe(1);
    expect(report.headSequenceNumber).toBe(4);
    expect(report.headHash).toBe(rows[3].event_hash);
  });

  it("detects a GAP — a deleted event", () => {
    const rows = buildChain(4);
    const withGap = [rows[0], rows[1], rows[3]]; // seq 3 removed

    const report = verifyOrderedChain("topic-a", withGap, NO_PRIOR_HISTORY);

    expect(report.intact).toBe(false);
    expect(report.firstBreak).toMatchObject({
      kind: "gap",
      atSequenceNumber: 4,
      eventId: rows[3].id,
      expected: "3",
      actual: "4",
    });
  });

  it("detects a leading gap when the chain does not start at 1", () => {
    const rows = buildChain(3).slice(1); // starts at seq 2
    const report = verifyOrderedChain("topic-a", rows, NO_PRIOR_HISTORY);

    expect(report.firstBreak?.kind).toBe("gap");
    expect(report.firstBreak?.expected).toBe("1");
  });

  it("detects a DUPLICATE sequence number — a forked history", () => {
    const rows = buildChain(3);
    const forked = [rows[0], rows[1], { ...rows[1], id: 999 }, rows[2]];

    const report = verifyOrderedChain("topic-a", forked, NO_PRIOR_HISTORY);

    expect(report.intact).toBe(false);
    expect(report.firstBreak).toMatchObject({ kind: "duplicate", atSequenceNumber: 2, eventId: 999 });
  });

  it("detects TAMPER — an altered payload no longer matches its stored hash", () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1], data: '{"n":"tampered"}' };

    const report = verifyOrderedChain("topic-a", rows, NO_PRIOR_HISTORY);

    expect(report.intact).toBe(false);
    expect(report.firstBreak?.kind).toBe("hash-mismatch");
    expect(report.firstBreak?.atSequenceNumber).toBe(2);
    expect(report.firstBreak?.actual).toBe(rows[1].event_hash);
    expect(report.firstBreak?.expected).not.toBe(rows[1].event_hash);
  });

  it("detects a spliced row whose prev_hash does not continue the chain", () => {
    const rows = buildChain(3);
    const spliced = { ...rows[2], prev_hash: rows[0].event_hash };
    spliced.event_hash = chainEventHash({
      id: spliced.id,
      topicId: spliced.topic_id,
      eventType: spliced.type,
      agentId: spliced.agent_id,
      sectionId: spliced.section_id,
      payloadJson: spliced.data,
      epochMs: spliced.epoch_ms as number,
      sequenceNumber: spliced.sequence_number as number,
      prevHash: spliced.prev_hash as string,
    });

    const report = verifyOrderedChain("topic-a", [rows[0], rows[1], spliced], NO_PRIOR_HISTORY);

    expect(report.firstBreak?.kind).toBe("prev-hash-mismatch");
    expect(report.firstBreak?.atSequenceNumber).toBe(3);
  });

  it("reports only the FIRST break when a chain is broken twice", () => {
    const rows = buildChain(5);
    rows[1] = { ...rows[1], data: '{"n":"tampered"}' }; // break at seq 2
    const withGap = [rows[0], rows[1], rows[2], rows[4]]; // and a gap at seq 5

    const report = verifyOrderedChain("topic-a", withGap, NO_PRIOR_HISTORY);

    expect(report.firstBreak?.kind).toBe("hash-mismatch");
    expect(report.firstBreak?.atSequenceNumber).toBe(2);
  });

  it("rejects a row whose algorithm it does not recognise instead of skipping verification", () => {
    const rows = buildChain(2);
    rows[1] = { ...rows[1], hash_alg: "sha256-jcs@99" };

    const report = verifyOrderedChain("topic-a", rows, NO_PRIOR_HISTORY);

    expect(report.firstBreak).toMatchObject({ kind: "unknown-alg", expected: CHAIN_HASH_ALG, actual: "sha256-jcs@99" });
  });

  it("reports a chained row that stores no hash", () => {
    const rows = buildChain(2);
    rows[1] = { ...rows[1], event_hash: null };

    expect(verifyOrderedChain("topic-a", rows, NO_PRIOR_HISTORY).firstBreak?.kind).toBe("missing-hash");
  });

  it("rejects a first event that declares no genesis sentinel", () => {
    const rows = buildChain(1, "not-a-genesis");
    expect(verifyOrderedChain("topic-a", rows, NO_PRIOR_HISTORY).firstBreak).toMatchObject({
      kind: "missing-genesis",
      expected: GENESIS,
      actual: "not-a-genesis",
    });
  });

  it("names the sentinel the evidence DOES support when a non-sentinel is found", () => {
    // Same break, but the `expected` field tracks the evidence: with a latch
    // set, the value this store would legitimately have written is
    // GENESIS-UNCHAINED, not GENESIS.
    expect(
      verifyOrderedChain("topic-a", buildChain(1, "not-a-genesis"), evidence(0, true, 9)).firstBreak
    ).toMatchObject({
      kind: "missing-genesis",
      expected: GENESIS_UNCHAINED,
      actual: "not-a-genesis",
    });
  });
});

// ─── The §6.4 genesis rule: two asymmetric claims, not one equality test ────

/**
 * #5598 — the six-row truth table, one test per row.
 *
 * `GENESIS` and `GENESIS-UNCHAINED` are NOT two values of one enum to be
 * compared for equality against a re-derived expectation. They are claims of
 * opposite strength:
 *
 *   - `GENESIS` = "nothing preceded this chain" — a STRONG claim, refuted by
 *     ANY positive evidence: a surviving unchained row, or the durable latch.
 *   - `GENESIS-UNCHAINED` = "something preceded this chain" — a WEAK claim.
 *     **No amount of deletion can falsify "something existed."**
 *
 * The pre-#5598 verifier applied a symmetric equality test to both, so the
 * daily retention purge — which deletes exactly the rows the expectation was
 * re-derived from — flipped byte-identical, untampered chains to
 * `missing-genesis`. Row 4 is that bug; it now asserts the opposite.
 */
describe("verifyOrderedChain — the genesis rule over asymmetric claims (#5598)", () => {
  it("row 1 — GENESIS with no live rows and no latch is intact (nothing refutes it)", () => {
    // Also nothing CONFIRMS it: an absent latch means UNKNOWN, and a resource
    // purged before #5598 shipped is indistinguishable from one that genuinely
    // had no prior events. That residual case is a declared §6.4 gap, not
    // something the verifier can resolve.
    const report = verifyOrderedChain("topic-a", buildChain(2, GENESIS), NO_PRIOR_HISTORY);

    expect(report.intact).toBe(true);
    expect(report.firstBreak).toBeNull();
  });

  it("row 2 — GENESIS breaks on the DURABLE LATCH ALONE, with zero live rows", () => {
    // The rows are gone; the evidence is not. `resource_chain_meta` outlives
    // what it attests to, so "nothing preceded this chain" is still refuted at
    // a live count of 0. A count-only verifier passes this case wrongly.
    const report = verifyOrderedChain("topic-a", buildChain(2, GENESIS), evidence(0, true, 12));

    expect(report.intact).toBe(false);
    expect(report.firstBreak).toMatchObject({
      kind: "missing-genesis",
      expected: GENESIS_UNCHAINED,
      actual: GENESIS,
    });
    // The operator is told the evidence is destroyed, not merely absent.
    expect(report.firstBreak?.detail).toContain("12");
    expect(report.firstBreak?.detail).toContain("resource_chain_meta");
  });

  it("row 3 — GENESIS breaks while unchained rows still survive", () => {
    // Unchanged from #5566: a surviving unchained row directly refutes the
    // claim that nothing preceded the chain.
    const report = verifyOrderedChain("topic-a", buildChain(2, GENESIS), evidence(3, false));

    expect(report.intact).toBe(false);
    expect(report.firstBreak).toMatchObject({
      kind: "missing-genesis",
      expected: GENESIS_UNCHAINED,
      actual: GENESIS,
    });
  });

  it("row 4 — GENESIS-UNCHAINED stays INTACT after retention deleted every corroborating row", () => {
    // THE FIX. This exact call asserted `missing-genesis` before #5598.
    //
    // The sentinel is a claim about the PAST — "something preceded this chain"
    // — permanently stamped into `prev_hash` and bound into `event_hash`. The
    // retention purge deleting the rows that corroborated it is not evidence
    // the rows were never there; it is only evidence they are not there NOW.
    // Absence of corroboration cannot falsify an existence claim, so the daily
    // cleanup job must not be able to turn an honest chain into a tampered
    // verdict.
    const report = verifyOrderedChain("topic-a", buildChain(2, GENESIS_UNCHAINED), NO_PRIOR_HISTORY);

    expect(report.intact).toBe(true);
    expect(report.firstBreak).toBeNull();
  });

  it("row 5 — GENESIS-UNCHAINED with the latch set is intact (the latch agrees)", () => {
    const report = verifyOrderedChain(
      "topic-a",
      buildChain(2, GENESIS_UNCHAINED),
      evidence(0, true, 40)
    );

    expect(report.intact).toBe(true);
    expect(report.firstBreak).toBeNull();
  });

  it("row 6 — GENESIS-UNCHAINED with surviving rows is intact (live rows agree)", () => {
    expect(
      verifyOrderedChain("topic-a", buildChain(3, GENESIS_UNCHAINED), evidence(7, false)).intact
    ).toBe(true);
    // ...and with both sources of evidence present.
    expect(
      verifyOrderedChain("topic-a", buildChain(3, GENESIS_UNCHAINED), evidence(7, true, 2)).intact
    ).toBe(true);
  });

  it("writer and verifier can never disagree — one predicate, both directions", () => {
    // `appendChainedEvent` stamps `expectedGenesisSentinel(evidence)`; the
    // verifier refutes with `genesisSentinelIsFalsified`. They are the same
    // rule read two ways, so the writer cannot mint a sentinel its own
    // verifier rejects. Exhaustive over the evidence space the rule branches on.
    for (const live of [0, 1, 40]) {
      for (const latch of [false, true]) {
        const ev = evidence(live, latch, latch ? 5 : 0);
        const stamped = expectedGenesisSentinel(ev);

        expect(genesisSentinelIsFalsified(stamped, ev)).toBe(false);
        expect(stamped === GENESIS_UNCHAINED).toBe(genesisSentinelIsFalsified(GENESIS, ev));
        // The weak claim is never refutable, whatever the evidence says.
        expect(genesisSentinelIsFalsified(GENESIS_UNCHAINED, ev)).toBe(false);
        // Anything outside the sentinel vocabulary always is.
        expect(genesisSentinelIsFalsified("not-a-genesis", ev)).toBe(true);
        expect(genesisSentinelIsFalsified(null, ev)).toBe(true);
      }
    }
  });
});

// ─── Source-level invariants the chain depends on ──────────────────────────

const SRC_DIR = path.resolve(__dirname, "..");
const APP_ROOT = path.resolve(SRC_DIR, "..");
/** `sql/` is executed AT BOOT — `_loadSqlStatements` (db.ts) reads these files
 *  and `initSchema` runs every statement in them. It is production, not
 *  reference material, and until #5598's repair the walkers below did not look
 *  at it: a delete added there would have run in production and been invisible
 *  to every guard. */
const SQL_DIR = path.join(APP_ROOT, "sql");
/** Operator scripts. NOT executed by the server, so they are out of scope for
 *  G1 (which is a statement about the server's delete paths) but firmly IN
 *  scope for G4, whose invariant is "nothing, anywhere, ever clears the latch"
 *  — an operator tidying up `resource_chain_meta` by hand destroys the evidence
 *  just as permanently as a cron would. */
const SCRIPTS_DIR = path.join(APP_ROOT, "scripts");

function filesUnder(dir: string, matches: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, matches));
    else if (matches(entry.name)) out.push(full);
  }
  return out;
}

/** Every non-test .ts/.tsx under src/, so an invariant can be asserted repo-wide. */
function productionSourceFiles(dir: string = SRC_DIR): string[] {
  return filesUnder(dir, (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"));
}

/** Everything the SERVER executes: `src/**` plus the boot-time `sql/**`. */
function serverExecutedFiles(): string[] {
  return [...productionSourceFiles(), ...filesUnder(SQL_DIR, (n) => n.endsWith(".sql"))];
}

/** Every file that could touch the database at all, operator scripts included. */
function databaseTouchingFiles(): string[] {
  return [
    ...serverExecutedFiles(),
    ...filesUnder(SCRIPTS_DIR, (n) => /\.(py|sql|ts|js|mjs|cjs|sh|ps1)$/.test(n)),
  ];
}

/**
 * Source with comments removed, so a source-walker guard measures EXECUTABLE
 * SQL rather than prose about it.
 *
 * `pact-profile.ts` legitimately names `DELETE FROM events` twice in JSDoc —
 * it is explaining why the served `retentionPolicy` had been false over a live
 * purge. A raw `.includes()` walker would count that documentation as a delete
 * path, which would either make the guard permanently red or force the guard's
 * expected set to enshrine another module's wording. Neither is an invariant
 * about behaviour.
 *
 * This is a scanner, NOT a pair of regexes, and the difference is load-bearing.
 * A naive `/\/\*[\s\S]*?\*\//g` treats the `/*` inside `// the /api/fiscal/*
 * routes` (fiscal-queries.ts:2) as the start of a block comment and deletes
 * everything up to the next block-comment terminator — 95% of that file,
 * including any SQL a violating diff put there. Nine files under `src/` carry
 * unbalanced `/*`
 * markers of exactly that kind, `retention.ts` among them. A guard with a
 * silent blind spot is the defect this issue exists to remove, so the scanner
 * tracks state properly:
 *
 *  - `//` to end of line and `/* … *\/` are dropped — the only lossy paths.
 *  - `'…'`, `"…"` and `` `…` `` are copied VERBATIM, so a comment marker inside
 *    a string (`"https://…"`, or SQL in a template literal) can never open one.
 *  - A mis-scanned string keeps its content rather than dropping it, so the
 *    residual failure mode is a loud false positive, never a silent miss.
 */
interface SourceScan {
  /** The source with comments removed. */
  readonly code: string;
  /**
   * Offsets that begin a line AND are outside every comment and every string —
   * i.e. positions where inserting a statement inserts real, reachable code.
   *
   * Emitted by the SAME pass as `code`, deliberately: the meta-test below
   * injects a violating statement at these offsets, and if the two disagreed
   * about what "top level" means the injection could land inside a comment and
   * a CORRECT stripper would then be marked blind for removing it. One pass,
   * one definition.
   */
  readonly topLevelLineStarts: readonly number[];
}

function scanSource(source: string): SourceScan {
  let out = "";
  let i = 0;
  const lineStarts: number[] = [];
  if (source.length > 0) lineStarts.push(0);
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        const closed = source[i] === c;
        i++;
        if (closed) break;
      }
      continue;
    }

    out += c;
    i++;
    // Reached only in the code state: a comment or string consumes its own
    // newlines in the loops above and never gets here.
    if (c === "\n") lineStarts.push(i);
  }
  return { code: out, topLevelLineStarts: lineStarts };
}

function stripSourceComments(source: string): string {
  return scanSource(source).code;
}

/**
 * Relative, forward-slashed paths of files whose EXECUTABLE source matches.
 *
 * `.sql` and `.py` files are scanned RAW. The scanner above models JS/TS
 * comment syntax, and `--` / `#` are not that; running it over them would strip
 * nothing and, worse, could mis-model their string escaping. Raw scanning fails
 * in the safe direction — a `-- DELETE FROM resource_chain_meta` in a SQL
 * comment is a loud false positive naming the file, never a silent miss — and
 * these guards are the ones where a silent miss is the whole hazard.
 */
function sourceFilesMatching(
  pattern: RegExp,
  files: string[] = productionSourceFiles()
): string[] {
  return files
    .filter((file) => {
      const raw = fs.readFileSync(file, "utf8");
      return pattern.test(/\.tsx?$/.test(file) ? stripSourceComments(raw) : raw);
    })
    .map((file) => path.relative(APP_ROOT, file).replace(/\\/g, "/"))
    .sort();
}

/**
 * The three ways SQL removes rows, in one place so G1 and G4 cannot drift.
 *
 * `DELETE FROM` alone is not the invariant — a `TRUNCATE` or a `DROP TABLE`
 * destroys the same evidence — and the #5598 originals allowed at most a bare
 * `"` before the table name, so `DELETE FROM public.resource_chain_meta`
 * executed identically and matched nothing.
 */
const DESTRUCTIVE_VERB = String.raw`(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+`;
const SCHEMA_QUALIFIER = String.raw`(?:"?\w+"?\s*\.\s*)?`;
const destructiveAgainst = (table: string) =>
  new RegExp(`${DESTRUCTIVE_VERB}${SCHEMA_QUALIFIER}"?\\b${table}\\b"?`, "i");

const EVENTS_DELETE = destructiveAgainst("events");
const META_DELETE = destructiveAgainst("resource_chain_meta");
/**
 * Destructive statements whose TABLE NAME is interpolated — see G5. Two
 * patterns rather than one, because of a genuine collision: `truncate` is a
 * Tailwind utility class, and `className={\`… truncate ${cond ? … }\`}` appears
 * in template literals throughout `src/app/**`. So the two-word SQL forms are
 * matched in any case, and a BARE `TRUNCATE` only in upper case — which is the
 * convention every SQL string in this repo already follows (see the header of
 * `retention.ts`). Matching `truncate ${` case-insensitively made this guard
 * red on a fuel-map button's CSS.
 */
const INTERPOLATED_TARGETS: readonly RegExp[] = [
  new RegExp(
    `(?:DELETE\\s+FROM|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|TRUNCATE\\s+TABLE)\\s+${SCHEMA_QUALIFIER}\\$\\{`,
    "i"
  ),
  new RegExp(`TRUNCATE\\s+${SCHEMA_QUALIFIER}\\$\\{`),
];

describe("chain invariants enforced at the source level (#5566, #5598)", () => {
  it("emitEvent → appendChainedEvent is the ONLY writer of the events table", () => {
    // A direct INSERT would put an unchained row in the middle of a
    // resource's log, which no verifier can distinguish from a deleted one.
    // (#5566 removed exactly one such insert, in the legislation-propose
    // route.)
    const offenders = productionSourceFiles()
      .filter((file) => fs.readFileSync(file, "utf8").includes("INSERT INTO events"))
      .map((file) => path.relative(SRC_DIR, file).replace(/\\/g, "/"));

    expect(offenders).toEqual(["lib/provenance-chain.ts"]);
  });

  /**
   * The violating statement the meta-test below splices into real source.
   * Balanced quotes and braces, so inserting it cannot change the scanner's
   * state for anything that follows it.
   */
  const VIOLATION =
    "await db.execute(`DELETE FROM events WHERE topic_id = ?`);\n" +
    "await db.execute(`DELETE FROM resource_chain_meta WHERE topic_id = ?`);\n";

  /**
   * Hand-computed adversarial inputs. This is the NON-CIRCULAR half of the
   * stripper's proof: the expectations are worked out from the language, not
   * from the scanner, so a rewrite that changes the scanner cannot quietly
   * change what "correct" means. Each of the first two is failed by one of the
   * two naive strippers, and they fail on OPPOSITE inputs — which is the point:
   * neither regex order is safe, only a state machine is.
   */
  const STRIPPER_FIXTURES: {
    name: string;
    source: string;
    keeps: string[];
    drops: string[];
  }[] = [
    {
      // Defeats `replace(/\/\*[\s\S]*?\*\//g, "")` run first: the `/*` inside
      // the LINE comment opens a phantom block that runs to the `*/` on line 3,
      // swallowing the executable SQL between them. This is the exact shape of
      // `fiscal-queries.ts:2`, which is why that file is the one #5598's
      // meta-test could not see into.
      name: "a `/*` inside a line comment opens no block comment",
      source:
        "// see the /api/fiscal/* routes\n" +
        "const q = `DELETE FROM events`;\n" +
        "/* a real doc comment */\n" +
        "const keep = 1;\n",
      keeps: ["DELETE FROM events", "const keep = 1"],
      drops: ["a real doc comment", "api/fiscal"],
    },
    {
      // Defeats `replace(/\/\/.*/g, "")` run first: eating `//` to end of line
      // truncates the URL mid-block-comment, leaving `/*` unterminated to
      // swallow everything after it.
      name: "a `//` inside a block comment does not truncate it",
      source:
        "/* see http://example.com/spec */\n" +
        "const q = `DELETE FROM events`;\n" +
        "const keep = 2;\n",
      keeps: ["DELETE FROM events", "const keep = 2"],
      drops: ["example.com/spec"],
    },
    {
      // A comment marker inside a STRING is data, not syntax. `pact-profile.ts`
      // and this file both carry URLs and SQL in literals.
      name: "comment markers inside string literals are data",
      source:
        'const u = "https://example.com/*x";\n' +
        "const q = `DELETE FROM events`;\n" +
        "const keep = 3;\n",
      keeps: ["DELETE FROM events", "const keep = 3", "https://example.com/*x"],
      drops: [],
    },
    {
      // The job the stripper was added for, in both comment forms: prose ABOUT
      // a delete path must not read as one.
      name: "prose about a delete path is removed, in both comment forms",
      source:
        "/* history: DELETE FROM events used to live here */\n" +
        "// and DELETE FROM resource_chain_meta was proposed\n" +
        "const keep = 4;\n",
      keeps: ["const keep = 4"],
      drops: ["DELETE FROM events", "DELETE FROM resource_chain_meta"],
    },
  ];

  it("the comment scanner is correct on inputs that defeat the obvious strippers", () => {
    for (const fixture of STRIPPER_FIXTURES) {
      const stripped = stripSourceComments(fixture.source);
      for (const keep of fixture.keeps) {
        expect(stripped, `${fixture.name}: must keep ${JSON.stringify(keep)}`).toContain(keep);
      }
      for (const drop of fixture.drops) {
        expect(stripped, `${fixture.name}: must drop ${JSON.stringify(drop)}`).not.toContain(
          drop
        );
      }
    }

    // And on the two real files the walkers depend on being classified
    // correctly: prose about the statement in `pact-profile.ts`, the statement
    // itself in `retention.ts`.
    expect(
      stripSourceComments(fs.readFileSync(path.join(SRC_DIR, "lib/pact-profile.ts"), "utf8"))
    ).not.toContain("DELETE FROM events");
    expect(
      stripSourceComments(fs.readFileSync(path.join(SRC_DIR, "lib/retention.ts"), "utf8"))
    ).toContain("DELETE FROM events");
  });

  it("the walkers below have NO blind spot — a violation is visible ANYWHERE in a file", () => {
    // A guard that cannot fail is worse than no guard: it reports safety it
    // never checked. G1 and G4 read comment-stripped source, so the scanner is
    // part of the trusted path, and a scanner that eats real code hides exactly
    // the diff the guards exist to catch.
    //
    // #5598 shipped this test APPENDING the violation to each file. That is the
    // one position structurally immune to the failure it claimed to test: a
    // phantom `/*` opened mid-file runs only to the next `*/`, so an
    // end-of-file tail always survives it. The named naive stripper passed this
    // test while genuinely hiding a violation placed where a real diff would
    // put it — the meta-guard had the same defect as the guard it was checking.
    //
    // So splice the violation at INTERIOR positions instead: line starts the
    // scanner itself reports as top level (outside every comment and string),
    // sampled across each file, plus the end. A stripper with a phantom-comment
    // bug drops the injections that land inside its phantom region, and the
    // file is named.
    const blind: string[] = [];
    for (const file of productionSourceFiles()) {
      const source = fs.readFileSync(file, "utf8");
      const starts = scanSource(source).topLevelLineStarts;
      // Up to 12 evenly spread interior positions, plus EOF. Bounded so this
      // stays a few seconds over ~200 files rather than a minute.
      const sampleCount = Math.min(12, starts.length);
      const offsets = new Set<number>([source.length]);
      for (let n = 0; n < sampleCount; n++) {
        offsets.add(starts[Math.floor((n * starts.length) / sampleCount)]);
      }
      for (const at of offsets) {
        const spliced = `${source.slice(0, at)}\n${VIOLATION}${source.slice(at)}`;
        const stripped = stripSourceComments(spliced);
        if (!EVENTS_DELETE.test(stripped) || !META_DELETE.test(stripped)) {
          blind.push(`${path.relative(APP_ROOT, file).replace(/\\/g, "/")}@${at}`);
          break;
        }
      }
    }

    expect(blind).toEqual([]);
  });

  it("G1 — the retention seam is the ONLY module that deletes events", () => {
    // #5598 moved the purge out of the cron route into the pure `retention.ts`
    // seam so the advertised §6.3 policy and the enforced one derive from one
    // constant. One deleter means one place to audit, and one place the
    // stamp-with-the-delete invariant (G3) has to hold.
    //
    // Violating diff: add `db.execute("DELETE FROM events WHERE …")` to any
    // other module — the offender appears in this list and the assertion goes
    // red naming the file.
    //
    // Scanned over everything the SERVER executes: `src/**` AND `sql/**`. The
    // #5598 original walked `src/` only, which left `sql/*.sql` — files
    // `_loadSqlStatements` reads and `initSchema` runs at every boot — as a
    // hole a delete could be added through in production, unseen. A qualified
    // `public.events` and an interpolated `${TABLE}` target are matched too:
    // both execute identically and neither matched the original literal-only
    // regex.
    expect(sourceFilesMatching(EVENTS_DELETE, serverExecutedFiles())).toEqual([
      "src/lib/retention.ts",
    ]);
  });

  it("G2 — the purge stops at the chain: it is sequence_number IS NULL-scoped", () => {
    // §6.4: a sequence number is never reused, reassigned or skipped, and a
    // compacted event keeps its chain position. Deleting a CHAINED row punches
    // a permanent, unrecoverable gap that every verifier correctly reads as
    // evidence of tampering — the purge would be forging exactly the signal
    // the chain exists to detect.
    //
    // Asserted against the built statement, not against the cron route's
    // source: since #5598 the route contains no SQL to grep.
    //
    // Violating diff: drop the predicate from `buildUnchainedEventPurge`.
    expect(buildUnchainedEventPurge().sql).toContain("sequence_number IS NULL");
  });

  it("G3 — nothing is deleted without being stamped: ONE statement does both", () => {
    // The delete and the latch stamp live in a single data-modifying CTE, so
    // there is no instant at which a reader sees the deletion without the
    // evidence, and no window in which a crash between two statements destroys
    // the rows without recording that they existed.
    //
    // Violating diff: split the CTE into a DELETE statement and a separate
    // INSERT — the single `sql` string then holds one or the other, never both.
    const purge = buildUnchainedEventPurge();

    expect(purge.sql).toContain("DELETE FROM events");
    expect(purge.sql).toContain("resource_chain_meta");
    // The bound is a parameter fed from the advertised constant, never a
    // literal that could drift away from `retentionPolicy.minimumDays`.
    expect(purge.sql).toContain("make_interval(days => ?)");
    expect(purge.args[0]).toBe(UNCHAINED_EVENT_RETENTION_DAYS);
  });

  it("G4 — NOTHING anywhere deletes from resource_chain_meta", () => {
    // The latch is monotonic: false → true, never back. That monotonicity is
    // the entire reason the WRITER may consult it — a latch that could clear
    // would make the writer's genesis decision time-dependent in exactly the
    // way #5598 fixes, and would silently re-arm the bug for every resource
    // whose evidence was cleared. Evidence about a resource's pre-history has
    // to outlive the resource, which is also why the table carries no FK.
    //
    // Violating diff: add a "tidy up orphaned chain meta" DELETE (or a
    // TRUNCATE, or a DROP) to the cleanup cron — the file is named and the
    // list is no longer empty.
    //
    // Widest scope of any guard here, because the invariant is the widest:
    // NOTHING clears the latch. `src/**`, the boot-time `sql/**`, and
    // `scripts/**` — an operator script that tidies this table destroys the
    // evidence exactly as permanently as a cron would, and #5598's original
    // walker looked at none of the last two.
    expect(sourceFilesMatching(META_DELETE, databaseTouchingFiles())).toEqual([]);
  });

  it("G5 — no destructive statement names its table through an interpolation", () => {
    // G1 and G4 are text guards, so they can only see a table name that is
    // WRITTEN. `DELETE FROM ${SOME_TABLE}` executes identically and matches
    // neither — the guards report an invariant they did not check.
    //
    // #5598 shipped this evasion ready-made: `retention.ts` exported
    // `RESOURCE_CHAIN_META_TABLE = "resource_chain_meta"` and referenced it
    // nowhere. Its only possible use was interpolation, and interpolation is
    // the one form G4 cannot see. That constant is gone, and this guard closes
    // the shape rather than the single instance — a future author reaching for
    // it has to name the table in full, where G1 and G4 can read it.
    //
    // Server-executed files only. Operator scripts build SQL dynamically as a
    // matter of course, and G4 already covers them for the invariant that
    // actually matters there.
    //
    // Violating diff: `db.execute(\`DELETE FROM ${TABLE} WHERE …\`)` anywhere in
    // `src/` or `sql/` — the file is named.
    const files = serverExecutedFiles();
    const offenders = new Set(
      INTERPOLATED_TARGETS.flatMap((pattern) => sourceFilesMatching(pattern, files))
    );
    expect([...offenders].sort()).toEqual([]);
  });

  it("G6 — no untyped literal sits under a DISTINCT or GROUP BY", () => {
    // THE TRAP THIS GUARD EXISTS FOR, and it is not hypothetical: #5598 shipped
    //
    //   SELECT DISTINCT topic_id, 0, NOW(), NULL, ?
    //
    // into `buildUnchainedHistoryStamp`, feeding a `TIMESTAMPTZ` column.
    // `DISTINCT` needs a sort/equality operator for every output column, so
    // parse analysis resolves each still-UNKNOWN target entry to `text` BEFORE
    // the INSERT's assignment coercion runs — and `text → timestamptz` has no
    // assignment cast. Postgres rejects the statement outright:
    //
    //   column "last_purged_at" is of type timestamp with time zone
    //   but expression is of type text
    //
    // Remove the `DISTINCT` and the identical statement is accepted, which is
    // what makes it silent. Both call sites threw on every run against a real
    // database — taking the daily cron down with them — while this suite stayed
    // green, because the in-memory `EventsDb` below dispatches on
    // `sql.includes(...)` and never parses SQL. Nothing here can execute
    // Postgres, so the next best thing is to refuse the shape.
    //
    // Violating diff: drop the `::TIMESTAMPTZ` from the stamp's NULL.
    const statements = [
      buildUnchainedEventPurge(),
      buildUnchainedHistoryStamp(CHAIN_META_ORIGIN_BACKFILL),
      buildUnchainedHistoryStamp(CHAIN_META_ORIGIN_PRE_PURGE_SWEEP),
      buildUnchainedRowCount(),
    ];
    for (const { sql } of statements) {
      // Target lists that Postgres must find an operator for: everything from
      // `SELECT DISTINCT` or `GROUP BY` to the end of that line.
      for (const clause of sql.match(/(?:SELECT\s+DISTINCT|GROUP\s+BY)[^\n]*/gi) ?? []) {
        // A bare NULL — one not immediately followed by `::type`.
        expect(clause, `untyped NULL under DISTINCT/GROUP BY: ${clause}`).not.toMatch(
          /\bNULL\b(?!\s*::)/i
        );
      }
    }
  });
});

describe("verifyResourceChain — the DB-backed entry point (#5566)", () => {
  it("loads the chain and its unchained prior count, then verifies", async () => {
    const db = new EventsDb();
    db.addLegacyRow("topic-a", "pact.agent.joined");
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.created"));
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));

    const report = await verifyResourceChain(db, "topic-a");

    expect(report).toMatchObject({
      resourceId: "topic-a",
      entityType: "pact-topic",
      alg: CHAIN_HASH_ALG,
      chainedEvents: 2,
      unchainedPriorEvents: 1,
      genesis: GENESIS_UNCHAINED,
      intact: true,
    });
  });

  it("surfaces tamper written directly into the store", async () => {
    const db = new EventsDb();
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.created", { claim: "original" }));
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));
    // A compromised server rewriting a past event's payload in place.
    db.rows[0].data = JSON.stringify({ claim: "rewritten" });

    const report = await verifyResourceChain(db, "topic-a");

    expect(report.intact).toBe(false);
    expect(report.firstBreak?.kind).toBe("hash-mismatch");
    expect(report.firstBreak?.atSequenceNumber).toBe(1);
  });

  it("reports live, purged and latch as THREE distinct facts (#5598)", async () => {
    // The whole defect class is one number being asked to carry two facts.
    // This resource ends up with all three simultaneously different:
    //   unchainedPriorEvents        = 2    (still present, still verifiable)
    //   purgedUnchainedPriorEvents  = 5    (destroyed, permanently unverifiable)
    //   hadUnchainedHistory         = true (the durable latch)
    // If any pair ever collapses into one field, this test says so.
    const db = new EventsDb();
    for (let i = 0; i < 5; i++) db.addLegacyRow("topic-a", "pact.proposal.created", 60); // expired
    for (let i = 0; i < 2; i++) db.addLegacyRow("topic-a", "pact.proposal.created", 1); // inside the bound

    await db.execute(buildUnchainedEventPurge());
    await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));

    const report = await verifyResourceChain(db, "topic-a");

    expect(report.unchainedPriorEvents).toBe(2);
    expect(report.purgedUnchainedPriorEvents).toBe(5);
    expect(report.hadUnchainedHistory).toBe(true);
    expect(report.unchainedPriorEvents).not.toBe(report.purgedUnchainedPriorEvents);
    // The frozen invariant: the report mirrors, exactly, the evidence the
    // genesis verdict was reached on — no independently re-read count.
    expect(report.historyEvidence).toEqual({
      liveUnchainedEvents: 2,
      hadUnchainedHistory: true,
      purgedUnchainedEvents: 5,
    });
    expect(report.intact).toBe(true);
    expect(report.genesis).toBe(GENESIS_UNCHAINED);
  });
});

// ─── Defect 2: the purge that ran before the resource's first chained event ─

describe("retention runs BEFORE the first chained append (#5598 Defect 2)", () => {
  it("writes GENESIS-UNCHAINED, not a false whole-history GENESIS", async () => {
    // The scenario the latch exists for, end to end.
    //
    // Pre-#5598 this resource verified INTACT and stayed wrong forever: the
    // purge removed every unchained row, the writer counted 0, stamped plain
    // `GENESIS` — "this chain covers the resource's entire history" — over a
    // history that had just been deleted, and the verifier then agreed with
    // it. `prev_hash` is bound into `event_hash`, so nothing can correct that
    // sentinel afterwards without fabricating the chain.
    const db = new EventsDb();
    for (let i = 0; i < 40; i++) db.addLegacyRow("topic-a", "pact.proposal.created", 60);

    // 1. The daily purge runs. Rows deleted AND the latch stamped, one stmt.
    const purged = await db.execute(buildUnchainedEventPurge());
    const { eventsDeleted, resourcesStamped } = readUnchainedPurgeResult(purged.rows);

    expect(eventsDeleted).toBe(40);
    expect(resourcesStamped).toBe(1);
    expect(db.rows.filter((r) => r.topic_id === "topic-a")).toHaveLength(0); // really gone
    expect(db.chainMeta.get("topic-a")).toMatchObject({ unchained_purged_count: 40 });
    // The count comes OUT OF rows[0]: on a data-modifying CTE `rowsAffected`
    // reports the outer one-row SELECT and would claim 1 deleted event.
    expect(purged.rowsAffected).toBe(1);

    // 2. Only NOW does the resource append its first chained event. The live
    //    count is 0; the latch is the only surviving evidence.
    const appended = await appendChainedEvent(db, APPEND("topic-a", "pact.proposal.merged"));

    expect(appended.prevHash).toBe(GENESIS_UNCHAINED);
    expect(appended.prevHash).not.toBe(GENESIS);
    expect(appended.sequenceNumber).toBe(FIRST_SEQUENCE_NUMBER);

    // 3. And it verifies intact — the sentinel is honest and the report says
    //    exactly how much history is permanently unverifiable.
    const report = await verifyResourceChain(db, "topic-a");

    expect(report.intact).toBe(true);
    expect(report.genesis).toBe(GENESIS_UNCHAINED);
    expect(report.unchainedPriorEvents).toBe(0);
    expect(report.hadUnchainedHistory).toBe(true);
    expect(report.purgedUnchainedPriorEvents).toBe(40);
  });

  it("the pre-pass latches ahead of the boundary, so the marker never races the delete", async () => {
    // The purge alone would only latch at the instant of deletion. The daily
    // pre-pass stamps every resource that holds ANY unchained row today, so
    // the evidence exists well before a row reaches the 30-day bound.
    const db = new EventsDb();
    db.addLegacyRow("topic-a", "pact.agent.joined", 1); // nowhere near expiry

    const stamped = await db.execute(buildUnchainedHistoryStamp(CHAIN_META_ORIGIN_PRE_PURGE_SWEEP));

    expect(stamped.rows).toHaveLength(1);
    expect(db.chainMeta.get("topic-a")).toMatchObject({
      origin: CHAIN_META_ORIGIN_PRE_PURGE_SWEEP,
      unchained_purged_count: 0, // latched, nothing deleted yet
      last_purged_at: null,
    });

    // Presence-only and idempotent: re-running it every day must not re-stamp.
    const again = await db.execute(buildUnchainedHistoryStamp(CHAIN_META_ORIGIN_PRE_PURGE_SWEEP));
    expect(again.rows).toHaveLength(0);

    // A latch whose purged count is still 0 is STILL positive evidence — the
    // count is reporting, the presence is the decision. Branching on
    // `purgedUnchainedEvents > 0` would reintroduce the bug in a new place.
    expect(expectedGenesisSentinel(evidence(0, true, 0))).toBe(GENESIS_UNCHAINED);
  });
});
