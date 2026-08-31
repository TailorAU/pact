/**
 * #5427 — Keyset-paged consensus sweep: page-boundary correctness, full
 * coverage of large seeded populations, paged-vs-unpaged-equivalent
 * outcomes, dirty-subgraph credence scoping, and time-budget truncation
 * with clean resumption.
 *
 * These run against a stateful in-memory DbClient mock — no Postgres. The
 * mock implements exactly the SQL surface updateConsensusStatuses uses
 * (keyset page queries per phase, sweep_state, events window, dependency
 * walks) over plain JS state, so every assertion about "processed exactly
 * once" is grounded in the actual statements the sweep issued.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";
import { updateConsensusStatuses, CONSENSUS_SWEEP_DEFAULTS } from "@/lib/db";

const distributeBounty = vi.fn(async () => {});
vi.mock("@/lib/economy", () => ({
  distributeBounty: (...args: unknown[]) =>
    (distributeBounty as unknown as (...a: unknown[]) => Promise<void>)(...args),
  transfer: vi.fn(async () => {}),
}));

type Topic = {
  id: string;
  status: string;
  tier?: string;
  convention_stop?: boolean;
  consensus_since?: string | null;
  consensus_ratio?: number | null;
  consensus_voters?: number | null;
  credence?: number | null;
  locked_at?: string | null;
};

type Registration = { topic_id: string; done_status: string | null };
/** `answerMerged: true` models a merged proposal joined to an 'Answer' section. */
type Proposal = { topic_id: string; status: string; agent_id: string; answerMerged?: boolean };
type Dep = { topic_id: string; depends_on: string; relationship: string };
/** #5566 — events now carry their §6.4 chain link (NULL on legacy rows). */
type Ev = {
  id: number;
  topic_id: string;
  type: string;
  sequence_number?: number | null;
  prev_hash?: string | null;
  event_hash?: string | null;
};
type Stmt = { sql: string; args: unknown[] };
/**
 * #5598 — the durable `resource_chain_meta` presence latch. A row means the
 * resource HAD unchained history; absence means UNKNOWN, never "had none".
 * This fixture never purges, so the map stays empty and every resource reads
 * `hadUnchainedHistory: false` — but it is modelled as real state rather than
 * a hardcoded `false` so the mock answers the writer's question honestly.
 */
type ChainMeta = { unchained_purged_count: number };

const VERIFIED = new Set(["consensus", "stable", "locked"]);

const DAYS = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

class MockDb implements DbClient {
  topics: Topic[] = [];
  registrations: Registration[] = [];
  proposals: Proposal[] = [];
  deps: Dep[] = [];
  events: Ev[] = [];
  /** #5598 — `resource_chain_meta`, keyed by topic_id. Empty = no latch set. */
  chainMeta = new Map<string, ChainMeta>();
  sweepState = new Map<string, string>();
  statements: Stmt[] = [];
  private nextEventId = 1;

  addEvent(topicId: string, type: string, chain?: { sequence_number: number; prev_hash: string }): Ev {
    const ev: Ev = {
      id: this.nextEventId++,
      topic_id: topicId,
      type,
      sequence_number: chain?.sequence_number ?? null,
      prev_hash: chain?.prev_hash ?? null,
      event_hash: null,
    };
    this.events.push(ev);
    return ev;
  }

  topic(id: string): Topic {
    const t = this.topics.find((x) => x.id === id);
    if (!t) throw new Error(`no topic ${id}`);
    return t;
  }

  private counts(topicId: string) {
    const regs = this.registrations.filter((r) => r.topic_id === topicId);
    const props = this.proposals.filter((p) => p.topic_id === topicId);
    return {
      uniqueProposers: new Set(props.filter((p) => p.status !== "rejected").map((p) => p.agent_id)).size,
      pendingCount: props.filter((p) => p.status === "pending").length,
      answerMergedCount: props.filter((p) => p.status === "merged" && p.answerMerged).length,
      alignedCount: regs.filter((r) => r.done_status === "aligned").length,
      dissentingCount: regs.filter((r) => r.done_status === "dissenting").length,
      unmetDependencies: this.deps.filter(
        (d) => d.topic_id === topicId && !VERIFIED.has(this.topic(d.depends_on).status)
      ).length,
    };
  }

  private phasePage(
    filter: (t: Topic) => boolean,
    cursor: string,
    limit: number,
    project: (t: Topic) => Record<string, unknown>
  ): DbResult {
    const rows = this.topics
      .filter((t) => filter(t) && t.id > cursor)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit)
      .map(project);
    return { rows };
  }

  async execute(stmtOrSql: string | { sql: string; args: unknown[] }): Promise<DbResult> {
    const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
    const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
    this.statements.push({ sql, args });

    // ── Phase page scans ──
    if (sql.includes("WHERE t.status IN ('open', 'challenged') AND t.id > ?")) {
      return this.phasePage(
        (t) => t.status === "open" || t.status === "challenged",
        args[0] as string,
        args[1] as number,
        (t) => ({ id: t.id, tier: t.tier ?? "practice", convention_stop: t.convention_stop ?? false, ...this.counts(t.id) })
      );
    }
    if (sql.includes("WHERE t.status = 'consensus' AND t.id > ?")) {
      return this.phasePage(
        (t) => t.status === "consensus",
        args[0] as string,
        args[1] as number,
        (t) => ({
          id: t.id,
          tier: t.tier ?? "practice",
          convention_stop: t.convention_stop ?? false,
          consensus_since: t.consensus_since ?? null,
          ...this.counts(t.id),
        })
      );
    }
    if (sql.includes("WHERE t.status = 'stable' AND t.id > ?")) {
      return this.phasePage(
        (t) => t.status === "stable",
        args[0] as string,
        args[1] as number,
        (t) => ({ id: t.id, ...this.counts(t.id) })
      );
    }
    if (sql.includes("td.relationship = 'assumes'") && sql.includes("AND t.id > ?")) {
      return this.phasePage(
        (t) =>
          (t.status === "stable" || t.status === "locked") &&
          this.deps.some(
            (d) =>
              d.topic_id === t.id &&
              d.relationship === "assumes" &&
              !VERIFIED.has(this.topic(d.depends_on).status)
          ),
        args[0] as string,
        args[1] as number,
        (t) => ({ id: t.id })
      );
    }

    // ── Phase-5 credence node loads ──
    if (sql.includes("t.credence") && sql.includes("WHERE t.id > ?")) {
      return this.phasePage(
        () => true,
        args[0] as string,
        args[1] as number,
        (t) => ({
          id: t.id,
          status: t.status,
          consensus_ratio: t.consensus_ratio ?? null,
          credence: t.credence ?? null,
          ...this.counts(t.id),
        })
      );
    }
    if (sql.includes("t.credence") && sql.includes("WHERE t.id = ANY(?)")) {
      const ids = new Set(args[0] as string[]);
      return {
        rows: this.topics
          .filter((t) => ids.has(t.id))
          .map((t) => ({
            id: t.id,
            status: t.status,
            consensus_ratio: t.consensus_ratio ?? null,
            credence: t.credence ?? null,
            ...this.counts(t.id),
          })),
      };
    }

    // ── Edge queries ──
    if (sql.includes("(topic_id, depends_on) > (?, ?)")) {
      const [ct, cd, limit] = args as [string, string, number];
      const rows = this.deps
        .filter((d) => d.topic_id > ct || (d.topic_id === ct && d.depends_on > cd))
        .sort((a, b) =>
          a.topic_id !== b.topic_id
            ? a.topic_id < b.topic_id ? -1 : 1
            : a.depends_on < b.depends_on ? -1 : a.depends_on > b.depends_on ? 1 : 0
        )
        .slice(0, limit)
        .map((d) => ({ topic_id: d.topic_id, depends_on: d.depends_on, relationship: d.relationship }));
      return { rows };
    }
    if (sql.includes("FROM topic_dependencies WHERE depends_on = ANY(?)")) {
      const ids = new Set(args[0] as string[]);
      const seen = new Set<string>();
      const rows: Record<string, unknown>[] = [];
      for (const d of this.deps) {
        if (ids.has(d.depends_on) && !seen.has(d.topic_id)) {
          seen.add(d.topic_id);
          rows.push({ topic_id: d.topic_id });
        }
      }
      return { rows };
    }
    if (sql.includes("FROM topic_dependencies WHERE topic_id = ANY(?)")) {
      const ids = new Set(args[0] as string[]);
      return {
        rows: this.deps
          .filter((d) => ids.has(d.topic_id))
          .map((d) => ({ topic_id: d.topic_id, depends_on: d.depends_on, relationship: d.relationship })),
      };
    }
    if (sql.includes("SELECT topic_id FROM topic_dependencies WHERE depends_on = ?")) {
      return {
        rows: this.deps
          .filter((d) => d.depends_on === (args[0] as string))
          .map((d) => ({ topic_id: d.topic_id })),
      };
    }

    // ── sweep_state ──
    if (sql.includes("SELECT value FROM sweep_state WHERE key = ?")) {
      const value = this.sweepState.get(args[0] as string);
      return { rows: value === undefined ? [] : [{ value }] };
    }
    if (sql.includes("INSERT INTO sweep_state")) {
      this.sweepState.set(args[0] as string, args[1] as string);
      return { rows: [], rowsAffected: 1 };
    }

    // ── events ──
    if (sql.includes("MAX(id)") && sql.includes("FROM events")) {
      const max = this.events.reduce((m, e) => Math.max(m, e.id), 0);
      return { rows: [{ max_event_id: max }] };
    }
    if (sql.includes("SELECT DISTINCT topic_id FROM events WHERE id > ?")) {
      const [after, limit] = args as [number, number];
      const seen = new Set<string>();
      const rows: Record<string, unknown>[] = [];
      for (const e of this.events) {
        if (e.id > after && !seen.has(e.topic_id)) {
          seen.add(e.topic_id);
          rows.push({ topic_id: e.topic_id });
          if (rows.length >= limit) break;
        }
      }
      return { rows };
    }
    // ── §6.4 provenance chain (#5566, #5598) ──
    // The sweep emits chained events, so the mock implements the writer's
    // SQL surface: advisory lock, chain-head read, chain-history evidence,
    // insert-returning-id, hash stamp.
    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT sequence_number, event_hash FROM events")) {
      const head = this.events
        .filter((e) => e.topic_id === args[0] && e.sequence_number != null)
        .sort((a, b) => b.sequence_number! - a.sequence_number!)[0];
      return { rows: head ? [{ sequence_number: head.sequence_number, event_hash: head.event_hash }] : [] };
    }
    // #5598 — `loadChainHistoryEvidence`: ONE statement reading BOTH evidence
    // sources. Replaces the pre-#5598 bare `COUNT(*) AS unchained_count`,
    // which no production query issues any more. `had_unchained_history` must
    // be a real boolean — the loader compares with `=== true`, so returning a
    // truthy non-boolean would silently read as "no latch".
    if (sql.includes("AS live_unchained_events")) {
      const topicId = args[0] as string;
      const meta = this.chainMeta.get(topicId);
      return {
        rows: [
          {
            live_unchained_events: this.events.filter(
              (e) => e.topic_id === topicId && e.sequence_number == null
            ).length,
            // NULL when there is no latch row — the loader maps that to 0.
            purged_unchained_events: meta ? meta.unchained_purged_count : null,
            had_unchained_history: meta !== undefined,
          },
        ],
      };
    }
    if (sql.includes("INSERT INTO events")) {
      const ev = this.addEvent(args[0] as string, args[1] as string, {
        sequence_number: args[6] as number,
        prev_hash: args[7] as string,
      });
      return { rows: [{ id: ev.id }], rowsAffected: 1 };
    }
    if (sql.includes("UPDATE events SET event_hash")) {
      const ev = this.events.find((e) => e.id === args[1]);
      if (!ev) return { rows: [], rowsAffected: 0 };
      ev.event_hash = args[0] as string;
      return { rows: [], rowsAffected: 1 };
    }

    // ── topic mutations ──
    if (sql.includes("status = 'consensus'") && sql.startsWith("UPDATE topics")) {
      const t = this.topic(args[2] as string);
      t.status = "consensus";
      t.consensus_ratio = args[0] as number;
      t.consensus_voters = args[1] as number;
      t.consensus_since = t.consensus_since ?? new Date().toISOString();
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.includes("SET status = 'open', consensus_since = NULL")) {
      const t = this.topic(args[0] as string);
      t.status = "open";
      t.consensus_since = null;
      t.consensus_ratio = null;
      t.consensus_voters = null;
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.includes("SET status = 'stable', locked_at = NOW()")) {
      const t = this.topic(args[2] as string);
      t.status = "stable";
      t.locked_at = new Date().toISOString();
      t.consensus_ratio = args[0] as number;
      t.consensus_voters = args[1] as number;
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.includes("SET status = 'open', locked_at = NULL")) {
      const t = this.topic(args[0] as string);
      t.status = "open";
      t.locked_at = null;
      t.consensus_since = null;
      t.consensus_ratio = null;
      t.consensus_voters = null;
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.includes("SET status = 'challenged', locked_at = NULL")) {
      const t = this.topic(args[0] as string);
      t.status = "challenged";
      t.locked_at = null;
      t.consensus_since = null;
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.includes("UPDATE topics SET credence = ?")) {
      const t = this.topic(args[1] as string);
      t.credence = args[0] as number;
      return { rows: [], rowsAffected: 1 };
    }

    throw new Error(`MockDb: unhandled SQL: ${sql}`);
  }

  async batch(stmts: { sql: string; args: unknown[] }[]): Promise<void> {
    for (const s of stmts) await this.execute(s);
  }
}

/** An open topic that meets every promotion criterion. */
function eligibleOpenTopic(db: MockDb, id: string) {
  db.topics.push({ id, status: "open", tier: "practice" });
  db.proposals.push({ topic_id: id, status: "merged", agent_id: `${id}-a1`, answerMerged: true });
  for (let i = 0; i < 3; i++) db.registrations.push({ topic_id: id, done_status: "aligned" });
}

function promoteStatements(db: MockDb, id: string): Stmt[] {
  return db.statements.filter((s) => s.sql.includes("status = 'consensus'") && s.args[2] === id);
}

beforeEach(() => {
  distributeBounty.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("keyset paging — page-boundary correctness (#5427)", () => {
  it("processes every topic exactly once when the class straddles pages", async () => {
    const db = new MockDb();
    for (let i = 1; i <= 5; i++) eligibleOpenTopic(db, `t00${i}`);

    const updated = await updateConsensusStatuses(db, { pageSize: 2 });

    expect(updated).toBe(5);
    for (let i = 1; i <= 5; i++) {
      const id = `t00${i}`;
      expect(db.topic(id).status).toBe("consensus");
      // Exactly ONE promotion UPDATE and ONE consensus-reached event per
      // topic: a row on a page boundary is neither skipped nor
      // double-processed.
      expect(promoteStatements(db, id)).toHaveLength(1);
      expect(db.events.filter((e) => e.topic_id === id && e.type === "pact.topic.consensus-reached")).toHaveLength(1);
    }
    expect(distributeBounty).toHaveBeenCalledTimes(5);
  });

  it("a phase's writes cannot make its own scan skip rows (scan-then-apply)", async () => {
    // 4 consensus topics that all demote. With naive interleaved paging,
    // demoting page 1 would shrink the 'consensus' class under the cursor;
    // keyset + scan-then-apply must still demote all 4 exactly once.
    const db = new MockDb();
    for (let i = 1; i <= 4; i++) {
      const id = `c00${i}`;
      db.topics.push({ id, status: "consensus", consensus_since: iso(1 * DAYS) });
      db.registrations.push({ topic_id: id, done_status: "aligned" });
      db.registrations.push({ topic_id: id, done_status: "dissenting" }); // ratio 0.5 < 0.9
    }

    const updated = await updateConsensusStatuses(db, { pageSize: 2 });

    expect(updated).toBe(4);
    for (let i = 1; i <= 4; i++) {
      const id = `c00${i}`;
      expect(db.topic(id).status).toBe("open");
      expect(db.events.filter((e) => e.topic_id === id && e.type === "pact.consensus.broken")).toHaveLength(1);
    }
  });
});

describe("keyset paging — large seeded population sweeps completely (#5427)", () => {
  it("promotes all 250 eligible topics with pageSize=20", async () => {
    const db = new MockDb();
    const ids: string[] = [];
    for (let i = 1; i <= 250; i++) {
      const id = `t${String(i).padStart(4, "0")}`;
      ids.push(id);
      eligibleOpenTopic(db, id);
    }

    const updated = await updateConsensusStatuses(db, { pageSize: 20 });

    expect(updated).toBe(250);
    for (const id of ids) {
      expect(db.topic(id).status).toBe("consensus");
      expect(promoteStatements(db, id)).toHaveLength(1);
    }
    // Every phase-1 page statement was bounded to pageSize rows.
    const phase1Pages = db.statements.filter((s) =>
      s.sql.includes("WHERE t.status IN ('open', 'challenged') AND t.id > ?")
    );
    for (const p of phase1Pages) expect(p.args[1]).toBe(20);
    expect(phase1Pages.length).toBeGreaterThanOrEqual(Math.ceil(250 / 20));
  });
});

/**
 * A representative fixture graph exercising all five phases:
 *  - tA open+eligible            → promotes (phase 1)
 *  - tB open+eligible-but-unmet  → blocked event, stays open (phase 1)
 *  - tC consensus, ratio 0.5     → demotes (phase 2)
 *  - tD consensus 40d, healthy   → stabilizes (phase 2)
 *  - tE stable, ratio 0.5        → breaks open (phase 3)
 *  - tF stable, assumes tG(open) → challenged (phase 4)
 *  - tG open, weak alignment     → untouched by phases 1–4
 *  - tH consensus, builds_on tG  → demoted (unmet dep, phase 2) and its
 *                                  credence attenuated through defeated
 *                                  weak tG (phase 5)
 */
function fixtureGraph(): MockDb {
  const db = new MockDb();
  eligibleOpenTopic(db, "tA");
  eligibleOpenTopic(db, "tB");
  db.deps.push({ topic_id: "tB", depends_on: "tG", relationship: "builds_on" });
  db.topics.push({ id: "tC", status: "consensus", consensus_since: iso(1 * DAYS) });
  db.registrations.push({ topic_id: "tC", done_status: "aligned" });
  db.registrations.push({ topic_id: "tC", done_status: "dissenting" });
  db.topics.push({ id: "tD", status: "consensus", consensus_since: iso(40 * DAYS) });
  for (let i = 0; i < 3; i++) db.registrations.push({ topic_id: "tD", done_status: "aligned" });
  db.proposals.push({ topic_id: "tD", status: "merged", agent_id: "d1", answerMerged: true });
  db.topics.push({ id: "tE", status: "stable", consensus_ratio: 0.95 });
  db.registrations.push({ topic_id: "tE", done_status: "aligned" });
  db.registrations.push({ topic_id: "tE", done_status: "dissenting" });
  db.topics.push({ id: "tF", status: "stable", consensus_ratio: 1.0 });
  for (let i = 0; i < 3; i++) db.registrations.push({ topic_id: "tF", done_status: "aligned" });
  db.deps.push({ topic_id: "tF", depends_on: "tG", relationship: "assumes" });
  // tG: open with weak alignment (0.25) so a dependent's attenuation
  // through the defeated dependency is visible in the credence values.
  db.topics.push({ id: "tG", status: "open" });
  db.registrations.push({ topic_id: "tG", done_status: "aligned" });
  for (let i = 0; i < 3; i++) db.registrations.push({ topic_id: "tG", done_status: "dissenting" });
  db.topics.push({ id: "tH", status: "consensus", consensus_ratio: 1.0, consensus_since: iso(1 * DAYS) });
  for (let i = 0; i < 3; i++) db.registrations.push({ topic_id: "tH", done_status: "aligned" });
  db.deps.push({ topic_id: "tH", depends_on: "tG", relationship: "builds_on" });
  return db;
}

function snapshot(db: MockDb) {
  return db.topics
    .map((t) => ({
      id: t.id,
      status: t.status,
      consensus_ratio: t.consensus_ratio ?? null,
      consensus_voters: t.consensus_voters ?? null,
      credence: typeof t.credence === "number" ? Number(t.credence.toFixed(9)) : null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe("paged sweep is outcome-equivalent across page sizes (#5427)", () => {
  it("pageSize=1 and pageSize=1000 produce identical final states over the fixture graph", async () => {
    const dbSmall = fixtureGraph();
    const dbLarge = fixtureGraph();

    const updatedSmall = await updateConsensusStatuses(dbSmall, { pageSize: 1 });
    const updatedLarge = await updateConsensusStatuses(dbLarge, { pageSize: 1000 });

    expect(updatedSmall).toBe(updatedLarge);
    expect(snapshot(dbSmall)).toEqual(snapshot(dbLarge));

    const eventKey = (db: MockDb) =>
      db.events.map((e) => `${e.topic_id}:${e.type}`).sort();
    expect(eventKey(dbSmall)).toEqual(eventKey(dbLarge));

    // Sanity of the fixture's expected transitions.
    expect(dbSmall.topic("tA").status).toBe("consensus");
    expect(dbSmall.topic("tB").status).toBe("open"); // blocked by unmet dep
    expect(
      dbSmall.events.some((e) => e.topic_id === "tB" && e.type === "pact.consensus.blocked-by-dependencies")
    ).toBe(true);
    expect(dbSmall.topic("tC").status).toBe("open");
    expect(dbSmall.topic("tD").status).toBe("stable");
    expect(dbSmall.topic("tE").status).toBe("open");
    expect(dbSmall.topic("tF").status).toBe("challenged");
    expect(dbSmall.topic("tG").status).toBe("open");
    // tH demotes in phase 2 (unmet dependency) and its credence
    // attenuates through the defeated, weakly-aligned tG.
    expect(dbSmall.topic("tH").status).toBe("open");
    const tH = dbSmall.topic("tH");
    expect(typeof tH.credence).toBe("number");
    expect(tH.credence as number).toBeLessThan(0.99);
    expect(tH.credence as number).toBeGreaterThan(0);
  });
});

describe("phase-5 credence recompute is scoped to the dirty subgraph (#5427)", () => {
  it("cold start runs a full recompute and sets the watermark", async () => {
    const db = fixtureGraph();
    await updateConsensusStatuses(db, { pageSize: 50 });
    expect(db.sweepState.get("credence_events_watermark")).toBeDefined();
    expect(db.sweepState.get("credence_full_recompute_at")).toBeDefined();
    // Full mode used the paged full-graph node load.
    expect(db.statements.some((s) => s.sql.includes("t.credence") && s.sql.includes("WHERE t.id > ?"))).toBe(true);
  });

  it("a quiet graph skips the recompute entirely (noop) and advances the watermark", async () => {
    const db = new MockDb();
    db.topics.push({ id: "q1", status: "open" });
    db.topics.push({ id: "q2", status: "stable", consensus_ratio: 1.0 });
    db.registrations.push({ topic_id: "q2", done_status: "aligned" });

    await updateConsensusStatuses(db); // cold start → full
    const watermarkAfterFirst = db.sweepState.get("credence_events_watermark");
    db.statements = [];

    await updateConsensusStatuses(db); // nothing changed since

    expect(db.statements.some((s) => s.sql.includes("UPDATE topics SET credence"))).toBe(false);
    expect(db.statements.some((s) => s.sql.includes("t.credence") && s.sql.includes("WHERE t.id > ?"))).toBe(false);
    expect(db.sweepState.get("credence_events_watermark")).toBe(watermarkAfterFirst);
  });

  it("an event on one topic recomputes only its dependency neighbourhood", async () => {
    const db = new MockDb();
    // Two disconnected islands: {x1 ← x2} and {y1 ← y2}.
    db.topics.push({ id: "x1", status: "stable", consensus_ratio: 1.0 });
    db.topics.push({ id: "x2", status: "consensus", consensus_ratio: 1.0, consensus_since: iso(1 * DAYS) });
    for (const id of ["x1", "x2"]) {
      for (let i = 0; i < 3; i++) db.registrations.push({ topic_id: id, done_status: "aligned" });
    }
    db.deps.push({ topic_id: "x2", depends_on: "x1", relationship: "builds_on" });
    db.topics.push({ id: "y1", status: "stable", consensus_ratio: 1.0 });
    db.topics.push({ id: "y2", status: "consensus", consensus_ratio: 1.0, consensus_since: iso(1 * DAYS) });
    for (const id of ["y1", "y2"]) {
      for (let i = 0; i < 3; i++) db.registrations.push({ topic_id: id, done_status: "aligned" });
    }
    db.deps.push({ topic_id: "y2", depends_on: "y1", relationship: "builds_on" });

    await updateConsensusStatuses(db); // cold start → full recompute

    // Dissent floods x1: alignment drops below 0.80 → phase 3 breaks it,
    // and the dirty recompute must touch ONLY the x-island.
    for (let i = 0; i < 10; i++) db.registrations.push({ topic_id: "x1", done_status: "dissenting" });
    db.addEvent("x1", "pact.done.recorded");
    db.statements = [];

    await updateConsensusStatuses(db);

    expect(db.topic("x1").status).toBe("open");
    const credenceWrites = db.statements.filter((s) => s.sql.includes("UPDATE topics SET credence"));
    const touched = credenceWrites.map((s) => s.args[1]);
    expect(touched.length).toBeGreaterThan(0);
    for (const id of touched) expect(["x1", "x2"]).toContain(id);
    // The full-graph paged node load was NOT used — dirty mode only loads
    // by id.
    expect(db.statements.some((s) => s.sql.includes("t.credence") && s.sql.includes("WHERE t.id > ?"))).toBe(false);
    expect(db.statements.some((s) => s.sql.includes("t.credence") && s.sql.includes("WHERE t.id = ANY(?)"))).toBe(true);
    // x2's credence self-attenuated through the defeated x1; y-island untouched.
    expect(db.topic("x2").credence as number).toBeLessThan(0.99);
    expect(db.topic("y2").credence as number).toBeCloseTo(0.99, 9);
  });
});

describe("time budget bounds the sweep and the remainder resumes cleanly (#5427)", () => {
  it("truncates between pages on budget overrun, then the next sweep finishes the class", async () => {
    const db = new MockDb();
    for (let i = 1; i <= 6; i++) eligibleOpenTopic(db, `t00${i}`);

    // Clock advances 30ms per observation → the 50ms budget dies after the
    // first full page.
    let tick = 0;
    const fastClock = () => {
      tick += 30;
      return tick;
    };
    const updatedFirst = await updateConsensusStatuses(db, {
      pageSize: 2,
      timeBudgetMs: 50,
      now: fastClock,
    });

    expect(updatedFirst).toBeGreaterThan(0);
    expect(updatedFirst).toBeLessThan(6);
    // Truncation must not advance the credence watermark.
    expect(db.sweepState.get("credence_events_watermark")).toBeUndefined();

    const updatedSecond = await updateConsensusStatuses(db, { pageSize: 2 });
    expect(updatedFirst + updatedSecond).toBe(6);
    for (let i = 1; i <= 6; i++) {
      const id = `t00${i}`;
      expect(db.topic(id).status).toBe("consensus");
      // Across BOTH sweeps each topic was promoted exactly once.
      expect(promoteStatements(db, id)).toHaveLength(1);
    }
  });
});

describe("sweep bounds are exported defaults, not flags (#5427)", () => {
  it("defaults are sane and paging is unconditional", () => {
    expect(CONSENSUS_SWEEP_DEFAULTS.pageSize).toBeGreaterThan(0);
    expect(CONSENSUS_SWEEP_DEFAULTS.timeBudgetMs).toBeGreaterThan(0);
    expect(CONSENSUS_SWEEP_DEFAULTS.dirtyMaxTopics).toBeGreaterThan(0);
    expect(CONSENSUS_SWEEP_DEFAULTS.fullRecomputeIntervalMs).toBeGreaterThan(0);
  });
});
