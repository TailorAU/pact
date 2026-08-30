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
 * The append tests run against a stateful in-memory `DbClient` mock — the
 * same shape `consensus-sweep-paging.test.ts` uses — that implements exactly
 * the SQL surface `appendChainedEvent` issues (advisory lock, chain-head
 * read, unchained count, insert-returning, hash stamp). Real Postgres is not
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
  verifyOrderedChain,
  verifyResourceChain,
  type ChainRow,
} from "./provenance-chain";

// ─── In-memory events table implementing the chained-append SQL surface ─────

type Row = {
  id: number;
  topic_id: string;
  type: string;
  agent_id: string | null;
  section_id: string | null;
  data: string | null;
  epoch_ms: number | null;
  sequence_number: number | null;
  prev_hash: string | null;
  event_hash: string | null;
  hash_alg: string | null;
};

type Stmt = { sql: string; args: unknown[] };

class EventsDb implements DbClient {
  rows: Row[] = [];
  statements: Stmt[] = [];
  transactions = 0;
  /** Statement fragment that should blow up, to model a chaining failure. */
  failOn: string | null = null;
  private nextId = 1;

  /** Seed a pre-#5566 (unchained) row: NULL sequence_number, no hash. */
  addLegacyRow(topicId: string, type: string): Row {
    const row: Row = {
      id: this.nextId++,
      topic_id: topicId,
      type,
      agent_id: null,
      section_id: null,
      data: null,
      epoch_ms: null,
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

    if (sql.includes("COUNT(*) AS unchained_count")) {
      const scoped = this.rows.filter((r) => r.topic_id === args[0]);
      const matching = sql.includes("sequence_number IS NULL")
        ? scoped.filter((r) => r.sequence_number === null)
        : scoped;
      return { rows: [{ unchained_count: matching.length }] };
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
    const nextId = this.nextId;
    try {
      return await fn(this);
    } catch (e) {
      this.rows = snapshot;
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
    expect(verifyOrderedChain("topic-a", db.chained("topic-a"), 0).intact).toBe(true);
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
    const report = verifyOrderedChain("topic-a", [], 12);
    expect(report.intact).toBe(true);
    expect(report.firstBreak).toBeNull();
    expect(report.genesis).toBeNull();
    expect(report.chainedEvents).toBe(0);
    expect(report.unchainedPriorEvents).toBe(12);
  });

  it("accepts an intact chain and reports the head a consumer must link to", () => {
    const rows = buildChain(4);
    const report = verifyOrderedChain("topic-a", rows, 0);

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

    const report = verifyOrderedChain("topic-a", withGap, 0);

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
    const report = verifyOrderedChain("topic-a", rows, 0);

    expect(report.firstBreak?.kind).toBe("gap");
    expect(report.firstBreak?.expected).toBe("1");
  });

  it("detects a DUPLICATE sequence number — a forked history", () => {
    const rows = buildChain(3);
    const forked = [rows[0], rows[1], { ...rows[1], id: 999 }, rows[2]];

    const report = verifyOrderedChain("topic-a", forked, 0);

    expect(report.intact).toBe(false);
    expect(report.firstBreak).toMatchObject({ kind: "duplicate", atSequenceNumber: 2, eventId: 999 });
  });

  it("detects TAMPER — an altered payload no longer matches its stored hash", () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1], data: '{"n":"tampered"}' };

    const report = verifyOrderedChain("topic-a", rows, 0);

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

    const report = verifyOrderedChain("topic-a", [rows[0], rows[1], spliced], 0);

    expect(report.firstBreak?.kind).toBe("prev-hash-mismatch");
    expect(report.firstBreak?.atSequenceNumber).toBe(3);
  });

  it("reports only the FIRST break when a chain is broken twice", () => {
    const rows = buildChain(5);
    rows[1] = { ...rows[1], data: '{"n":"tampered"}' }; // break at seq 2
    const withGap = [rows[0], rows[1], rows[2], rows[4]]; // and a gap at seq 5

    const report = verifyOrderedChain("topic-a", withGap, 0);

    expect(report.firstBreak?.kind).toBe("hash-mismatch");
    expect(report.firstBreak?.atSequenceNumber).toBe(2);
  });

  it("rejects a row whose algorithm it does not recognise instead of skipping verification", () => {
    const rows = buildChain(2);
    rows[1] = { ...rows[1], hash_alg: "sha256-jcs@99" };

    const report = verifyOrderedChain("topic-a", rows, 0);

    expect(report.firstBreak).toMatchObject({ kind: "unknown-alg", expected: CHAIN_HASH_ALG, actual: "sha256-jcs@99" });
  });

  it("reports a chained row that stores no hash", () => {
    const rows = buildChain(2);
    rows[1] = { ...rows[1], event_hash: null };

    expect(verifyOrderedChain("topic-a", rows, 0).firstBreak?.kind).toBe("missing-hash");
  });

  it("rejects a first event that declares no genesis sentinel", () => {
    const rows = buildChain(1, "not-a-genesis");
    expect(verifyOrderedChain("topic-a", rows, 0).firstBreak).toMatchObject({
      kind: "missing-genesis",
      expected: GENESIS,
      actual: "not-a-genesis",
    });
  });

  it("rejects a genesis sentinel that contradicts the recorded unchained history", () => {
    // GENESIS claims the resource had no prior events; 3 unchained rows say otherwise.
    expect(verifyOrderedChain("topic-a", buildChain(2, GENESIS), 3).firstBreak).toMatchObject({
      kind: "missing-genesis",
      expected: GENESIS_UNCHAINED,
      actual: GENESIS,
    });
    // ...and the converse.
    expect(verifyOrderedChain("topic-a", buildChain(2, GENESIS_UNCHAINED), 0).firstBreak).toMatchObject({
      kind: "missing-genesis",
      expected: GENESIS,
      actual: GENESIS_UNCHAINED,
    });
  });

  it("accepts GENESIS-UNCHAINED when unchained history is exactly what was recorded", () => {
    expect(verifyOrderedChain("topic-a", buildChain(3, GENESIS_UNCHAINED), 7).intact).toBe(true);
  });
});

// ─── Source-level invariants the chain depends on ──────────────────────────

const SRC_DIR = path.resolve(__dirname, "..");

/** Every non-test .ts/.tsx under src/, so an invariant can be asserted repo-wide. */
function productionSourceFiles(dir: string = SRC_DIR): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("chain invariants enforced at the source level (#5566)", () => {
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

  it("the retention purge never deletes a chained row", () => {
    // §6.4: a sequence number is never reused, reassigned or skipped, and a
    // compacted event keeps its chain position. Deleting a chained row
    // punches a permanent gap. The cleanup cron therefore purges only the
    // unchained pre-#5566 backlog.
    const cleanup = fs.readFileSync(path.join(SRC_DIR, "app/api/cron/cleanup/route.ts"), "utf8");
    const purge = cleanup.match(/DELETE FROM events[^`]*/)?.[0] ?? "";

    expect(purge).toContain("sequence_number IS NULL");
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
});
