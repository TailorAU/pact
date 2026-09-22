/**
 * #5599 PR-B — real-Postgres integration tests for the consensus engine's
 * per-decision transactions (design steps 3 + 4): `runConsensusStatusUpdate`
 * (the routes' after-commit disposition), the per-decision wraps inside
 * `updateConsensusStatuses` / `autoMergeExpired` / `evaluateChallenges`, and
 * the savepoint remediation of the engine's best-effort economy catches.
 *
 * Sibling of kg-tx.itest.ts (PR-A's route-wrap proofs) — same guard, same
 * pool-tracker shape, same partial emitEvent mock for the route-level tests.
 * Two additional instruments this file needs:
 *
 *   - a query log tapped at `pg.Client.prototype.query`, armed only inside
 *     the connection-accounting test, to prove the engine BEGINs one short
 *     transaction PER DECISION and never rides a transaction across scans
 *     or between decisions (the pool-health requirement: the sweep must
 *     never hold 1 of 10 pooled connections in a transaction for its 60s
 *     time budget);
 *
 *   - two run-scoped poison triggers (real Postgres, so a REAL statement
 *     failure — not a mock throw — inside a chosen decision):
 *       events     BEFORE INSERT raises for topic ids containing 'epoison'
 *                  → the §6.4 chain append fails, exactly the crash window
 *                    the issue names;
 *       ledger_txs BEFORE INSERT raises for topic ids containing 'lpoison'
 *                  → the best-effort economy sub-region fails, exactly what
 *                    the engine's kept catches are for.
 *
 * Test order is load-bearing: the connection-accounting test runs FIRST so
 * no earlier test's poisoned residue can add decision windows to its count.
 * Every test neutralizes its topics (status 'rejected' leaves every engine
 * scan class) so later tests see a quiet database.
 *
 * Suite runs only with DATABASE_URL (CI: the `kg-integration` job's
 * postgres:16-alpine service container); see db.itest.ts for the guard
 * rationale.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import pg from "pg";
import type { NextRequest } from "next/server";
import type { DbClient } from "@/lib/db";
import type * as DbModule from "@/lib/db";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  process.stderr.write(
    "\n[kg-sweep-tx.itest] DATABASE_URL is not set — SKIPPING the #5599 PR-B consensus-engine transaction tests.\n" +
      "[kg-sweep-tx.itest] They run in CI against the kg-integration job's postgres:16-alpine service container.\n\n"
  );
}

const describeDb = DATABASE_URL ? describe : describe.skip;

// ── Hoisted state shared with the vi.mock factories ─────────────────────────
const h = vi.hoisted(() => {
  const run = `s${Date.now().toString(36)}`;
  return {
    run,
    agentId: `agent-5599s-${run}`,
    agentName: `itest 5599s ${run}`,
    /** One-shot: the NEXT route-level emitEvent call throws, then re-arms off. */
    failNextEmit: false,
  };
});

// Partial mock: everything real except emitEvent, which becomes a one-shot
// failure injector for the route-level after-commit tests. db.ts-INTERNAL
// callers (the engine's own emits) keep the real internal binding — the
// engine-side failures in this file are induced by REAL statement errors
// (the poison triggers), never by this mock.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    emitEvent: async (...args: Parameters<typeof actual.emitEvent>) => {
      if (h.failNextEmit) {
        h.failNextEmit = false;
        throw new Error("induced route-emit failure (#5599 PR-B itest)");
      }
      return actual.emitEvent(...args);
    },
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAgent: async () => ({ id: h.agentId, name: h.agentName }),
    checkAgentReputation: async () => ({ eligible: true }),
  };
});

// ── Pool tracker + query log ────────────────────────────────────────────────
// Tracker: same rationale + shape as db.itest.ts. Query log: taps EVERY
// client's query() at the prototype, recording statement TEXT only while a
// test has armed it — cheap, deterministic connection accounting without
// touching production code.
const RealPool = pg.Pool;
const trackedPools: InstanceType<typeof pg.Pool>[] = [];

function installPoolTracker(): void {
  class TrackedPool extends RealPool {
    constructor(...args: ConstructorParameters<typeof RealPool>) {
      super(...args);
      trackedPools.push(this);
    }
  }
  (pg as { Pool: typeof pg.Pool }).Pool = TrackedPool as typeof pg.Pool;
}

/** Armed (non-null) only inside the connection-accounting test. */
let queryLog: string[] | null = null;
const RealClientQuery = pg.Client.prototype.query;

function installQueryLog(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pg.Client.prototype as any).query = function (this: pg.Client, ...args: unknown[]) {
    if (queryLog) {
      const first = args[0];
      const text =
        typeof first === "string" ? first : (first as { text?: string } | null)?.text;
      if (typeof text === "string") queryLog.push(text);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (RealClientQuery as any).apply(this, args);
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const RUN = h.run;
const topicId = (slug: string): string => `kgswp-5599-${RUN}-${slug}`;

type RouteParams = { params: Promise<{ topicId: string }> };
type PostHandler = (req: NextRequest, ctx: RouteParams) => Promise<Response>;

function postJson(url: string, body: unknown): NextRequest {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function params(p: { topicId: string }): RouteParams {
  return { params: Promise.resolve(p) };
}

describeDb("#5599 PR-B — per-decision transactions in the consensus engine (real Postgres)", () => {
  let dbmod: typeof DbModule;
  let db: DbClient;
  let donePost: PostHandler;

  const proposerId = `agent-5599s-prop-${RUN}`;
  const voterIds = [1, 2, 3].map((n) => `agent-5599s-v${n}-${RUN}`);

  async function count(sql: string, args: unknown[]): Promise<number> {
    const r = await db.execute({ sql, args });
    return Number(r.rows[0]?.n ?? 0);
  }

  async function seedAgent(id: string, name: string): Promise<void> {
    await db.execute({
      sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
      args: [id, name, `key-${id}`],
    });
  }

  async function seedTopic(id: string, status: string, title?: string): Promise<void> {
    await db.execute({
      sql: "INSERT INTO topics (id, title, content, tier, status) VALUES (?, ?, ?, 'empirical', ?)",
      args: [id, title ?? id, "seed topic for the #5599 PR-B consensus-engine tests", status],
    });
  }

  /**
   * Make `id` satisfy every Phase-1 promotion gate for tier 'empirical':
   * open, zero pending proposals, one MERGED proposal on the Answer section,
   * three aligned registrations (ratio 1.0 ≥ 0.9, aligned 3 ≥ required 3),
   * no dependencies.
   */
  async function seedPromotableTopic(id: string): Promise<void> {
    await seedTopic(id, "open");
    const sectionId = `sec-answer-${id}`;
    await db.execute({
      sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, 'Answer', 2, 'merged answer', 1)",
      args: [sectionId, id],
    });
    await db.execute({
      sql: `INSERT INTO proposals (id, topic_id, section_id, agent_id, new_content, summary, status, resolved_at)
        VALUES (?, ?, ?, ?, 'merged answer', 'seed merged answer proposal', 'merged', NOW())`,
      args: [`prop-${id}`, id, sectionId, proposerId],
    });
    for (const voter of voterIds) {
      await db.execute({
        sql: `INSERT INTO registrations (id, topic_id, agent_id, done_status, done_at)
          VALUES (?, ?, ?, 'aligned', NOW())`,
        args: [`reg-${id}-${voter}`, id, voter],
      });
    }
  }

  /** Take `ids` out of every engine scan so later tests see a quiet class. */
  async function neutralizeTopics(ids: string[]): Promise<void> {
    for (const id of ids) {
      await db.execute({
        sql: "UPDATE topics SET status = 'rejected' WHERE id = ?",
        args: [id],
      });
    }
  }

  beforeAll(async () => {
    installPoolTracker();
    installQueryLog();
    // Tracker first, THEN anything that transitively imports db.ts — the
    // module init destructures pg.Pool at import time.
    dbmod = await import("@/lib/db");
    db = await dbmod.getDb();

    ({ POST: donePost } = await import("@/app/api/pact/[topicId]/done/route"));

    await seedAgent(h.agentId, h.agentName);
    await seedAgent(proposerId, `itest 5599s proposer ${RUN}`);
    for (const [i, voter] of voterIds.entries()) {
      await seedAgent(voter, `itest 5599s voter${i + 1} ${RUN}`);
    }

    // Poison trigger 1: any §6.4 chain append for a topic id containing
    // 'epoison' fails AT THE EVENTS INSERT — a real statement error inside
    // the decision transaction, at exactly the emit step.
    await db.execute(
      `CREATE OR REPLACE FUNCTION kgswp_poison_events_5599() RETURNS trigger AS $fn$
       BEGIN
         IF NEW.topic_id LIKE '%epoison%' THEN
           RAISE EXCEPTION 'induced chain-append failure (5599 prb itest)';
         END IF;
         RETURN NEW;
       END
       $fn$ LANGUAGE plpgsql`
    );
    await db.execute("DROP TRIGGER IF EXISTS kgswp_poison_events_trg ON events");
    await db.execute(
      "CREATE TRIGGER kgswp_poison_events_trg BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION kgswp_poison_events_5599()"
    );

    // Poison trigger 2: any ledger write for a topic id containing
    // 'lpoison' fails — a genuine failure inside the engine's best-effort
    // economy sub-regions (bounty distribution, stake refund, jackpot).
    await db.execute(
      `CREATE OR REPLACE FUNCTION kgswp_poison_ledger_5599() RETURNS trigger AS $fn$
       BEGIN
         IF NEW.topic_id LIKE '%lpoison%' THEN
           RAISE EXCEPTION 'induced ledger failure (5599 prb itest)';
         END IF;
         RETURN NEW;
       END
       $fn$ LANGUAGE plpgsql`
    );
    await db.execute("DROP TRIGGER IF EXISTS kgswp_poison_ledger_trg ON ledger_txs");
    await db.execute(
      "CREATE TRIGGER kgswp_poison_ledger_trg BEFORE INSERT ON ledger_txs FOR EACH ROW EXECUTE FUNCTION kgswp_poison_ledger_5599()"
    );
  });

  afterEach(() => {
    h.failNextEmit = false;
    queryLog = null;
  });

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg.Client.prototype as any).query = RealClientQuery;
    try {
      await db.execute("DROP TRIGGER IF EXISTS kgswp_poison_events_trg ON events");
      await db.execute("DROP TRIGGER IF EXISTS kgswp_poison_ledger_trg ON ledger_txs");
      await db.execute("DROP FUNCTION IF EXISTS kgswp_poison_events_5599()");
      await db.execute("DROP FUNCTION IF EXISTS kgswp_poison_ledger_5599()");
    } finally {
      (pg as { Pool: typeof pg.Pool }).Pool = RealPool;
      await Promise.all(trackedPools.map((p) => p.end().catch(() => undefined)));
    }
  });

  // ── Pool health: one SHORT transaction per decision, none across scans ────
  describe("connection accounting (runConsensusStatusUpdate)", () => {
    it("BEGINs one transaction per decision, never nests, never spans a keyset scan, and leaves no transaction open", async () => {
      const a = topicId("acct-a");
      const b = topicId("acct-b");
      await seedPromotableTopic(a);
      await seedPromotableTopic(b);

      queryLog = [];
      const updated = await dbmod.runConsensusStatusUpdate();
      const log = queryLog;
      queryLog = null;

      expect(updated).toBeGreaterThanOrEqual(2);

      // Depth walk over the statement stream: BEGIN only at depth 0,
      // COMMIT/ROLLBACK only at depth 1 (createTransactionScopedClient
      // flattens nesting — canary (b) — so a depth above 1 means a second
      // BEGIN leaked onto an already-open transaction), and depth 0 at the
      // end (no transaction left open on the released connection).
      let depth = 0;
      const windows: string[][] = [];
      let current: string[] | null = null;
      for (const sql of log) {
        const s = sql.trim().toUpperCase();
        if (s === "BEGIN") {
          expect(depth).toBe(0);
          depth = 1;
          current = [];
          continue;
        }
        if (s === "COMMIT" || s === "ROLLBACK") {
          expect(depth).toBe(1);
          depth = 0;
          windows.push(current ?? []);
          current = null;
          continue;
        }
        if (current) current.push(sql);
      }
      expect(depth).toBe(0);

      // The keyset page scans run OUTSIDE every transaction window — the
      // engine never holds a transaction across a scan.
      for (const w of windows) {
        expect(
          w.some((sql) => /LIMIT \$\d+/.test(sql) && sql.includes("FROM topics"))
        ).toBe(false);
      }

      // The two promotions rode two DIFFERENT short windows — per-decision
      // transactions, not one giant one: at least two windows carry a
      // promote status-write, and NO window carries more than one.
      const promoteCount = (w: string[]): number =>
        w.filter((sql) => sql.includes("UPDATE topics") && sql.includes("'consensus'")).length;
      const promoteWindows = windows.filter((w) => promoteCount(w) > 0);
      expect(promoteWindows.length).toBeGreaterThanOrEqual(2);
      for (const w of promoteWindows) {
        expect(promoteCount(w)).toBe(1);
      }

      // And the decisions really committed — status + chain link each.
      for (const id of [a, b]) {
        const status = await db.execute({ sql: "SELECT status FROM topics WHERE id = ?", args: [id] });
        expect(status.rows[0]?.status).toBe("consensus");
        expect(
          await count(
            "SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.topic.consensus-reached'",
            [id]
          )
        ).toBe(1);
      }

      await neutralizeTopics([a, b]);
    });
  });

  // ── Sibling isolation + land-or-vanish (Phase-1 promote) ──────────────────
  describe("updateConsensusStatuses phase 1: a poisoned decision rolls back alone", () => {
    it("the poisoned topic's status write vanishes WITH its chain link; the sibling's promotion commits with its chain link", async () => {
      const poisoned = topicId("epoison-p1");
      const sibling = topicId("clean-p1");
      await seedPromotableTopic(poisoned);
      await seedPromotableTopic(sibling);

      // Both decisions are scanned; the poisoned one's §6.4 append fails at
      // the INSERT (events trigger), aborting ITS transaction only.
      const updated = await dbmod.runConsensusStatusUpdate();
      expect(updated).toBeGreaterThanOrEqual(1);

      // Sibling: status write + chain link landed together.
      const sib = await db.execute({
        sql: "SELECT status, consensus_since FROM topics WHERE id = ?",
        args: [sibling],
      });
      expect(sib.rows[0]?.status).toBe("consensus");
      expect(sib.rows[0]?.consensus_since).not.toBeNull();
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ?", [sibling])).toBe(1);

      // Poisoned: the status write and the chain link BOTH vanished —
      // land-or-vanish together, no half-promoted topic.
      const poi = await db.execute({
        sql: "SELECT status, consensus_since FROM topics WHERE id = ?",
        args: [poisoned],
      });
      expect(poi.rows[0]?.status).toBe("open");
      expect(poi.rows[0]?.consensus_since).toBeNull();
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ?", [poisoned])).toBe(0);

      await neutralizeTopics([poisoned, sibling]);
    });
  });

  // ── Best-effort bounty inside the decision transaction (savepoint) ────────
  describe("phase 1 bounty distribution: best-effort failure no longer poisons the decision", () => {
    it("a failing ledger write inside distributeBounty rolls back only the bounty sub-region — the promotion and its chain link still commit", async () => {
      const t = topicId("lpoison-bounty");
      await seedPromotableTopic(t);
      await db.execute({
        sql: "INSERT INTO topic_bounties (id, topic_id, sponsor_id, amount, status) VALUES (?, ?, 'hub-protocol', 40, 'escrow')",
        args: [`bounty-${t}`, t],
      });

      const updated = await dbmod.runConsensusStatusUpdate();
      expect(updated).toBeGreaterThanOrEqual(1);

      // The decision committed …
      const status = await db.execute({ sql: "SELECT status FROM topics WHERE id = ?", args: [t] });
      expect(status.rows[0]?.status).toBe("consensus");
      expect(
        await count(
          "SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.topic.consensus-reached'",
          [t]
        )
      ).toBe(1);

      // … the failed bounty sub-region did not: escrow untouched, no ledger
      // rows, no bounty-distributed event.
      expect(
        await count("SELECT count(*) AS n FROM topic_bounties WHERE topic_id = ? AND status = 'escrow'", [t])
      ).toBe(1);
      expect(await count("SELECT count(*) AS n FROM ledger_txs WHERE topic_id = ?", [t])).toBe(0);
      expect(
        await count(
          "SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.bounty.distributed'",
          [t]
        )
      ).toBe(0);

      await neutralizeTopics([t]);
    });
  });

  // ── autoMergeExpired via the production sweep entry point ─────────────────
  describe("runConsensusSweep auto-merge: per-proposal transactions", () => {
    it("a poisoned auto-merge rolls back alone; the sibling proposal merges with its chain link; the sweep reports only the committed merge", async () => {
      const pTopic = topicId("epoison-am");
      const qTopic = topicId("clean-am");
      for (const t of [pTopic, qTopic]) {
        await seedTopic(t, "open");
        await db.execute({
          sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, 'Answer', 2, 'original', 1)",
          args: [`sec-am-${t}`, t],
        });
        await db.execute({
          sql: `INSERT INTO proposals (id, topic_id, section_id, agent_id, new_content, summary, status, ttl_seconds, created_at)
            VALUES (?, ?, ?, ?, 'auto-merged content', 'expired approvable proposal', 'pending', 1, NOW() - INTERVAL '1 hour')`,
          args: [`prop-am-${t}`, t, `sec-am-${t}`, proposerId],
        });
        await db.execute({
          sql: "INSERT INTO votes (id, proposal_id, agent_id, vote_type) VALUES (?, ?, ?, 'approve')",
          args: [`vote-am-${t}`, `prop-am-${t}`, voterIds[0]],
        });
      }

      const sweep = await dbmod.runConsensusSweep();
      expect(sweep.ran).toBe(true);
      expect(sweep.merged).toBe(1); // only the COMMITTED merge is counted

      // Clean topic: merge writes + chain link landed together.
      expect(
        await count("SELECT count(*) AS n FROM proposals WHERE id = ? AND status = 'merged'", [
          `prop-am-${qTopic}`,
        ])
      ).toBe(1);
      const qSection = await db.execute({ sql: "SELECT content FROM sections WHERE id = ?", args: [`sec-am-${qTopic}`] });
      expect(qSection.rows[0]?.content).toBe("auto-merged content");
      expect(
        await count(
          "SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.proposal.auto-merged'",
          [qTopic]
        )
      ).toBe(1);

      // Poisoned topic: NOTHING landed — proposal still pending, section
      // untouched, zero events.
      expect(
        await count("SELECT count(*) AS n FROM proposals WHERE id = ? AND status = 'pending'", [
          `prop-am-${pTopic}`,
        ])
      ).toBe(1);
      const pSection = await db.execute({ sql: "SELECT content FROM sections WHERE id = ?", args: [`sec-am-${pTopic}`] });
      expect(pSection.rows[0]?.content).toBe("original");
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ?", [pTopic])).toBe(0);

      // Neutralize: the poisoned proposal would be retried (and re-fail) on
      // every later sweep in this suite — reject it, and retire both topics.
      await db.execute({
        sql: "UPDATE proposals SET status = 'rejected', resolved_at = NOW() WHERE id = ?",
        args: [`prop-am-${pTopic}`],
      });
      await neutralizeTopics([pTopic, qTopic]);
    });
  });

  // ── evaluateChallenges: per-challenge transactions + savepointed economy ──
  describe("evaluateChallenges: per-challenge transactions with savepointed economy sub-regions", () => {
    async function seedChallenge(t: string, opts: { support: number; lapsed: boolean }): Promise<string> {
      await seedTopic(t, "consensus");
      await db.execute({
        sql: "UPDATE topics SET consensus_since = NOW(), consensus_ratio = 1.0, consensus_voters = 3 WHERE id = ?",
        args: [t],
      });
      const challengeId = `chal-${t}`;
      await db.execute({
        sql: `INSERT INTO proposals (id, topic_id, section_id, agent_id, new_content, summary, status, created_at)
          VALUES (?, ?, ?, ?, 'challenge content', 'challenge of the consensus', 'challenge', ${
            opts.lapsed ? "NOW() - INTERVAL '8 days'" : "NOW()"
          })`,
        args: [challengeId, t, `sec-chal-${t}`, h.agentId],
      });
      for (let i = 0; i < opts.support; i++) {
        await db.execute({
          sql: "INSERT INTO votes (id, proposal_id, agent_id, vote_type) VALUES (?, ?, ?, 'approve')",
          args: [`vote-${challengeId}-${i}`, challengeId, voterIds[i]],
        });
      }
      return challengeId;
    }

    it("reopen: a failing jackpot transfer rolls back only the reward sub-region — the reopen, both status writes and the chain link commit", async () => {
      const t = topicId("lpoison-reopen");
      const challengeId = await seedChallenge(t, { support: 3, lapsed: false });

      const before = await db.execute({
        sql: "SELECT successful_challenges FROM agents WHERE id = ?",
        args: [h.agentId],
      });
      const reopened = await dbmod.evaluateChallenges(db);
      expect(reopened).toBeGreaterThanOrEqual(1);

      const topic = await db.execute({ sql: "SELECT status FROM topics WHERE id = ?", args: [t] });
      expect(topic.rows[0]?.status).toBe("challenged");
      expect(
        await count("SELECT count(*) AS n FROM proposals WHERE id = ? AND status = 'pending'", [challengeId])
      ).toBe(1);
      expect(
        await count(
          "SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.consensus.challenged'",
          [t]
        )
      ).toBe(1);

      // The savepointed reward sub-region vanished AS A UNIT: no jackpot
      // ledger row AND no successful_challenges bump.
      expect(await count("SELECT count(*) AS n FROM ledger_txs WHERE topic_id = ?", [t])).toBe(0);
      const after = await db.execute({
        sql: "SELECT successful_challenges FROM agents WHERE id = ?",
        args: [h.agentId],
      });
      expect(after.rows[0]?.successful_challenges).toBe(before.rows[0]?.successful_challenges);

      await db.execute({
        sql: "UPDATE proposals SET status = 'rejected', resolved_at = NOW() WHERE id = ?",
        args: [challengeId],
      });
      await neutralizeTopics([t]);
    });

    it("lapse: a failing stake refund rolls back only the refund — the rejection and the lapse chain link commit", async () => {
      const t = topicId("lpoison-lapse");
      const challengeId = await seedChallenge(t, { support: 0, lapsed: true });

      await dbmod.evaluateChallenges(db);

      expect(
        await count("SELECT count(*) AS n FROM proposals WHERE id = ? AND status = 'rejected'", [challengeId])
      ).toBe(1);
      expect(
        await count(
          "SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.challenge.lapsed'",
          [t]
        )
      ).toBe(1);
      expect(await count("SELECT count(*) AS n FROM ledger_txs WHERE topic_id = ?", [t])).toBe(0);

      await neutralizeTopics([t]);
    });
  });

  // ── Route-level after-commit disposition (done route) ─────────────────────
  describe("done route: consensus evaluation runs only after the request transaction commits", () => {
    const t = topicId("route-after-commit");

    it("request-transaction failure → ZERO consensus writes (the updater never runs; extends PR-A's route pins to the done route)", async () => {
      // Promotable EXCEPT one alignment short — the acting agent's aligned
      // signal is the third and would tip it over.
      await seedTopic(t, "open");
      const sectionId = `sec-answer-${t}`;
      await db.execute({
        sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, 'Answer', 2, 'merged answer', 1)",
        args: [sectionId, t],
      });
      await db.execute({
        sql: `INSERT INTO proposals (id, topic_id, section_id, agent_id, new_content, summary, status, resolved_at)
          VALUES (?, ?, ?, ?, 'merged answer', 'seed merged answer proposal', 'merged', NOW())`,
        args: [`prop-${t}`, t, sectionId, proposerId],
      });
      for (const voter of [voterIds[0], voterIds[1]]) {
        await db.execute({
          sql: "INSERT INTO registrations (id, topic_id, agent_id, done_status, done_at) VALUES (?, ?, ?, 'aligned', NOW())",
          args: [`reg-${t}-${voter}`, t, voter],
        });
      }
      // The acting agent: registered, assumptions already declared (so the
      // route's only chain emit is pact.agent.done), no done status yet.
      await db.execute({
        sql: "INSERT INTO registrations (id, topic_id, agent_id, assumptions_declared) VALUES (?, ?, ?, 1)",
        args: [`reg-${t}-${h.agentId}`, t, h.agentId],
      });

      h.failNextEmit = true;
      await expect(
        donePost(postJson(`/api/pact/${t}/done`, { status: "aligned" }), params({ topicId: t }))
      ).rejects.toThrow("induced route-emit failure");

      // The route transaction rolled back: no done status, no events at
      // all, and — the PR-B pin — the topic was NOT promoted (still only 2
      // alignments visible to any later engine run).
      const reg = await db.execute({
        sql: "SELECT done_status FROM registrations WHERE topic_id = ? AND agent_id = ?",
        args: [t, h.agentId],
      });
      expect(reg.rows[0]?.done_status).toBeNull();
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ?", [t])).toBe(0);
      const status = await db.execute({ sql: "SELECT status FROM topics WHERE id = ?", args: [t] });
      expect(status.rows[0]?.status).toBe("open");
    });

    it("commit path: the same request then promotes the topic through the connection-scoped after-commit updater — gapless chain across both transactions", async () => {
      const res = await donePost(postJson(`/api/pact/${t}/done`, { status: "aligned" }), params({ topicId: t }));
      expect(res.status).toBe(200);

      const status = await db.execute({ sql: "SELECT status FROM topics WHERE id = ?", args: [t] });
      expect(status.rows[0]?.status).toBe("consensus");

      // Chain continuity across the two transactions (route tx on one
      // connection, promotion decision tx on another): seq 1 = the done
      // signal, seq 2 = the promotion — gapless, no duplicate.
      const events = await db.execute({
        sql: "SELECT type, sequence_number, prev_hash FROM events WHERE topic_id = ? ORDER BY sequence_number",
        args: [t],
      });
      expect(events.rows.map((r) => [r.type, r.sequence_number])).toEqual([
        ["pact.agent.done", 1],
        ["pact.topic.consensus-reached", 2],
      ]);
      expect(events.rows[0]?.prev_hash).toBe("GENESIS");

      await neutralizeTopics([t]);
    });
  });
});
