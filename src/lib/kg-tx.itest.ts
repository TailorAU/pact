/**
 * #5599 PR-A — real-Postgres integration tests for the transactional route
 * wrap (`withTransaction`) and the swallowed-error-site remediation
 * (`ON CONFLICT DO NOTHING` rewrites + `withSavepoint`).
 *
 * These are the proofs the mock suite structurally cannot give: the mocks
 * have no `transaction()` (the wrap degrades to a plain call) and no
 * transaction-abort semantics (no 25P02, no savepoints). Everything here
 * runs the REAL route handlers against a real database — only auth,
 * rate-limiting and (per-test, one-shot) `emitEvent` are substituted.
 *
 * Layout mirrors the PR's three route batches (~6 routes each); one
 * representative route per batch gets the atomicity proof:
 *
 *   batch 1 (single-write + emit: join, join-token, salience, intents,
 *            constraints, escalate)               → intents (+ join-token,
 *            tailor-group#63: existing-identity refusal and races)
 *   batch 2 (multi-write: bounty, verify, reject, object, approve,
 *            dependencies)                        → bounty
 *   batch 3 (complex: topics, vote, done, legislation/propose, staleness,
 *            + the finalize helpers)              → topics, vote
 *
 * The mid-region failure is induced at the LAST step of each region — the
 * §6.4 chain append — which is exactly the crash window the issue names:
 * state change lands, chain link does not. With the wrap, the answer must
 * be NO partial rows.
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
    "\n[kg-tx.itest] DATABASE_URL is not set — SKIPPING the #5599 PR-A transactional-route tests.\n" +
      "[kg-tx.itest] They run in CI against the kg-integration job's postgres:16-alpine service container.\n\n"
  );
}

const describeDb = DATABASE_URL ? describe : describe.skip;

// ── Hoisted state shared with the vi.mock factories ─────────────────────────
const h = vi.hoisted(() => {
  const run = `x${Date.now().toString(36)}`;
  return {
    run,
    agentId: `agent-5599a-${run}`,
    agentName: `itest 5599a ${run}`,
    peerId: `agent-5599b-${run}`,
    peerName: `itest 5599b ${run}`,
    /** One-shot: the NEXT route-level emitEvent call throws, then re-arms off. */
    failNextEmit: false,
  };
});

// Partial mock: everything real except emitEvent, which becomes a one-shot
// failure injector for the mid-region-crash tests. Routes (and lib helpers
// importing "./db") resolve to this wrapper; db.ts-INTERNAL callers
// (finalizeApprovedTopic etc.) keep the real internal binding — which is
// what the tests want: the injection point is the route's own emit.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    emitEvent: async (...args: Parameters<typeof actual.emitEvent>) => {
      if (h.failNextEmit) {
        h.failNextEmit = false;
        throw new Error("induced mid-region failure (#5599 itest)");
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
    checkCivicDuty: async () => ({ allowed: true, votesNeeded: 0, topicsCreated: 0, votesCast: 0 }),
    checkReviewDuty: async () => ({ allowed: true, reviewsNeeded: 0, proposalsMade: 0, reviewsCast: 0 }),
  };
});

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimit: async () => ({ allowed: true, remaining: 999, resetAt: Date.now() + 60_000 }),
    getRateLimitHeaders: () => ({}),
  };
});

// ── Pool tracker (same rationale + shape as db.itest.ts) ────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────
const RUN = h.run;
const topicId = (slug: string): string => `kgtx-5599-${RUN}-${slug}`;

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

describeDb("#5599 PR-A — transactional route wrap + catch-site remediation (real Postgres)", () => {
  let dbmod: typeof DbModule;
  let db: DbClient;
  let intentsPost: PostHandler;
  let bountyPost: PostHandler;
  let votePost: PostHandler;
  let topicsPost: (req: NextRequest) => Promise<Response>;
  let joinTokenPost: PostHandler;

  /** Count helper (int8 already parsed to number by db.ts). */
  async function count(sql: string, args: unknown[]): Promise<number> {
    const r = await db.execute({ sql, args });
    return Number(r.rows[0]?.n ?? 0);
  }

  async function seedTopic(id: string, status: string, title?: string): Promise<void> {
    await db.execute({
      sql: "INSERT INTO topics (id, title, content, tier, status) VALUES (?, ?, ?, 'empirical', ?)",
      args: [id, title ?? id, "seed topic for the #5599 PR-A transactional-route tests", status],
    });
  }

  beforeAll(async () => {
    installPoolTracker();
    // Tracker first, THEN anything that transitively imports db.ts — the
    // module init destructures pg.Pool at import time.
    dbmod = await import("@/lib/db");
    db = await dbmod.getDb();

    ({ POST: intentsPost } = await import("@/app/api/pact/[topicId]/intents/route"));
    ({ POST: bountyPost } = await import("@/app/api/pact/[topicId]/bounty/route"));
    ({ POST: votePost } = await import("@/app/api/pact/[topicId]/vote/route"));
    ({ POST: topicsPost } = await import("@/app/api/pact/topics/route"));
    ({ POST: joinTokenPost } = await import("@/app/api/pact/[topicId]/join-token/route"));

    // Seed the acting agent + a peer (FK targets for votes/registrations).
    await db.execute({
      sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
      args: [h.agentId, h.agentName, `key-${RUN}-a`],
    });
    await db.execute({
      sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
      args: [h.peerId, h.peerName, `key-${RUN}-b`],
    });
  });

  afterEach(() => {
    h.failNextEmit = false;
  });

  afterAll(async () => {
    (pg as { Pool: typeof pg.Pool }).Pool = RealPool;
    await Promise.all(trackedPools.map((p) => p.end().catch(() => undefined)));
  });

  // ── withSavepoint: the direct 25P02-defusal proof ──────────────────────────
  describe("withSavepoint (db.ts)", () => {
    it("a genuinely failing statement inside withSavepoint no longer poisons the enclosing transaction (canary (a)'s bomb, defused)", async () => {
      const key = `kgtx-5599-${RUN}-savepoint`;
      await db.transaction!(async (tx) => {
        await tx.execute({
          sql: "INSERT INTO sweep_state (key, value) VALUES (?, ?)",
          args: [key, "before-failure"],
        });
        await expect(
          dbmod.withSavepoint(tx, async () => {
            await tx.execute("SELECT * FROM table_that_does_not_exist_5599_pra");
          })
        ).rejects.toThrow();
        // Without the savepoint this statement would raise 25P02 and the
        // pre-failure write would be silently discarded at COMMIT.
        await tx.execute({
          sql: "UPDATE sweep_state SET value = ? WHERE key = ?",
          args: ["after-failure", key],
        });
      });
      const r = await db.execute({
        sql: "SELECT value FROM sweep_state WHERE key = ?",
        args: [key],
      });
      expect(r.rows[0]?.value).toBe("after-failure");
    });
  });

  // ── Batch 1 representative: intents ───────────────────────────────────────
  describe("batch 1 (intents): single-write + chain link", () => {
    it("mid-region failure at the chain append rolls back the state change — NO partial rows", async () => {
      const t = topicId("intents-crash");
      await seedTopic(t, "open");

      h.failNextEmit = true;
      await expect(
        intentsPost(postJson(`/api/pact/${t}/intents`, { sectionId: "sec:answer", goal: "probe the wrap" }), params({ topicId: t }))
      ).rejects.toThrow("induced mid-region failure");

      expect(await count("SELECT count(*) AS n FROM intents WHERE topic_id = ?", [t])).toBe(0);
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ?", [t])).toBe(0);
    });

    it("commit path: the intent row and its chain link land together (seq 1, GENESIS)", async () => {
      const t = topicId("intents-commit");
      await seedTopic(t, "open");

      const res = await intentsPost(
        postJson(`/api/pact/${t}/intents`, { sectionId: "sec:answer", goal: "prove the commit path" }),
        params({ topicId: t })
      );
      expect(res.status).toBe(201);

      expect(await count("SELECT count(*) AS n FROM intents WHERE topic_id = ?", [t])).toBe(1);
      const events = await db.execute({
        sql: "SELECT type, sequence_number, prev_hash, event_hash FROM events WHERE topic_id = ?",
        args: [t],
      });
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.type).toBe("pact.intent.declared");
      expect(events.rows[0]?.sequence_number).toBe(1);
      expect(events.rows[0]?.prev_hash).toBe("GENESIS");
      expect(typeof events.rows[0]?.event_hash).toBe("string");
    });
  });

  // ── Batch 2 representative: bounty ────────────────────────────────────────
  describe("batch 2 (bounty): wallet debit + bounty + ledger + chain link", () => {
    it("mid-region failure at the chain append rolls back the debit, the bounty AND the ledger row", async () => {
      const t = topicId("bounty-crash");
      await seedTopic(t, "open");
      await db.execute({
        sql: "INSERT INTO agent_wallets (agent_id, balance) VALUES (?, 100) ON CONFLICT (agent_id) DO UPDATE SET balance = 100",
        args: [h.agentId],
      });

      h.failNextEmit = true;
      await expect(
        bountyPost(postJson(`/api/pact/${t}/bounty`, { amount: 50 }), params({ topicId: t }))
      ).rejects.toThrow("induced mid-region failure");

      const wallet = await db.execute({
        sql: "SELECT balance FROM agent_wallets WHERE agent_id = ?",
        args: [h.agentId],
      });
      expect(wallet.rows[0]?.balance).toBe(100); // debit rolled back
      expect(await count("SELECT count(*) AS n FROM topic_bounties WHERE topic_id = ?", [t])).toBe(0);
      expect(await count("SELECT count(*) AS n FROM ledger_txs WHERE topic_id = ?", [t])).toBe(0);
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ?", [t])).toBe(0);
    });
  });

  // ── Batch 3 representatives: topics + vote ────────────────────────────────
  describe("batch 3 (topics): the 11-write region", () => {
    it("mid-region failure at the chain append leaves NO partial rows across all 11 writes", async () => {
      const title = `KG tx crash canary ${RUN}`;
      const before = await count(
        "SELECT count(*) AS n FROM ledger_txs WHERE to_wallet = ? AND reason = 'topic-creation-credit'",
        [h.agentId]
      );

      h.failNextEmit = true;
      await expect(
        topicsPost(
          postJson("/api/pact/topics", {
            title,
            canonicalClaim: `Crash canary claim ${RUN} rolls back atomically`,
          })
        )
      ).rejects.toThrow("induced mid-region failure");

      expect(await count("SELECT count(*) AS n FROM topics WHERE title = ?", [title])).toBe(0);
      const after = await count(
        "SELECT count(*) AS n FROM ledger_txs WHERE to_wallet = ? AND reason = 'topic-creation-credit'",
        [h.agentId]
      );
      expect(after).toBe(before); // creation credit rolled back with the topic
    });

    it("commit path: topic, 3 sections, registration, creator vote, invite token, credit and the chain link land together", async () => {
      const title = `KG tx commit canary ${RUN}`;
      const res = await topicsPost(
        postJson("/api/pact/topics", {
          title,
          canonicalClaim: `Commit canary claim ${RUN} lands atomically`,
        })
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      const t = body.id;

      expect(await count("SELECT count(*) AS n FROM topics WHERE id = ? AND status = 'proposed'", [t])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM sections WHERE topic_id = ?", [t])).toBe(3);
      expect(await count("SELECT count(*) AS n FROM registrations WHERE topic_id = ? AND agent_id = ?", [t, h.agentId])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM topic_votes WHERE topic_id = ? AND vote_type = 'approve'", [t])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM invite_tokens WHERE topic_id = ?", [t])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM ledger_txs WHERE topic_id = ? AND reason = 'topic-creation-credit'", [t])).toBe(1);

      const events = await db.execute({
        sql: "SELECT type, sequence_number, prev_hash FROM events WHERE topic_id = ?",
        args: [t],
      });
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.type).toBe("pact.topic.proposed");
      expect(events.rows[0]?.sequence_number).toBe(1);
      expect(events.rows[0]?.prev_hash).toBe("GENESIS");
    });
  });

  describe("batch 3 (vote): remediated catch sites inside the wrapped region", () => {
    it("need_info with an ALREADY-LINKED dependency + an unfundable economy award still commits the vote and its chain link (ON CONFLICT rewrite + withSavepoint)", async () => {
      const t = topicId("vote-needinfo-dup");
      const dep = topicId("vote-needinfo-dep");
      const depTitle = `KG dep target ${RUN} alpha`;
      await seedTopic(t, "proposed");
      await seedTopic(dep, "open", depTitle);
      // Pre-link: the exact conflict the old `catch {}` swallowed.
      await db.execute({
        sql: "INSERT INTO topic_dependencies (topic_id, depends_on, relationship) VALUES (?, ?, 'assumes')",
        args: [t, dep],
      });
      // Make the hub-protocol award genuinely fail (insufficient balance).
      await db.execute({
        sql: "UPDATE agent_wallets SET balance = 0 WHERE agent_id = 'hub-protocol'",
        args: [],
      });

      const res = await votePost(
        postJson(`/api/pact/${t}/vote`, {
          vote: "need_info",
          reason: "needs the alpha dependency verified first",
          dependencyTitle: depTitle,
        }),
        params({ topicId: t })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { needInfoTopicId: string; dependencyCreated: boolean };
      expect(body.needInfoTopicId).toBe(dep);
      expect(body.dependencyCreated).toBe(false);

      // The enclosing transaction COMMITTED its other writes:
      expect(await count("SELECT count(*) AS n FROM topic_votes WHERE topic_id = ? AND agent_id = ?", [t, h.agentId])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.topic.vote.need_info'", [t])).toBe(1);
      // Still exactly ONE link row (ON CONFLICT DO NOTHING, no abort):
      expect(await count("SELECT count(*) AS n FROM topic_dependencies WHERE topic_id = ? AND depends_on = ?", [t, dep])).toBe(1);
      // The failed award left no ledger row (savepoint rolled it back):
      expect(await count("SELECT count(*) AS n FROM ledger_txs WHERE topic_id = ? AND reason = 'dependency-discovery-link'", [t])).toBe(0);
    });

    it("need_info creating a NEW dependency topic writes topic + Answer section + link atomically (and the funded award commits)", async () => {
      const t = topicId("vote-needinfo-new");
      await seedTopic(t, "proposed");
      // Run-unique tokens in MULTIPLE words so a rerun against a non-fresh
      // local database can never fuzzy-match a previous run's topic (the
      // dedup coalesces titles at >= 75% keyword overlap).
      const depTitle = `Zephyr${RUN} dependency quill${RUN} unlinked`;
      await db.execute({
        sql: "UPDATE agent_wallets SET balance = 50 WHERE agent_id = 'hub-protocol'",
        args: [],
      });

      const res = await votePost(
        postJson(`/api/pact/${t}/vote`, {
          vote: "need_info",
          reason: "this zephyr prerequisite has no topic yet",
          dependencyTitle: depTitle,
        }),
        params({ topicId: t })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { needInfoTopicId: string; dependencyCreated: boolean };
      expect(body.dependencyCreated).toBe(true);

      const created = body.needInfoTopicId;
      expect(await count("SELECT count(*) AS n FROM topics WHERE id = ? AND status = 'proposed'", [created])).toBe(1);
      // Proves the pre-existing `body`-column defect in this region is fixed:
      // the Answer section actually lands now.
      expect(await count("SELECT count(*) AS n FROM sections WHERE topic_id = ? AND heading = 'Answer'", [created])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM topic_dependencies WHERE topic_id = ? AND depends_on = ?", [t, created])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM ledger_txs WHERE topic_id = ? AND reason = 'dependency-discovery-new'", [t])).toBe(1);
    });

    it("duplicate vote returns 409 via the rowsAffected probe — one vote row, one chain link, no abort", async () => {
      const t = topicId("vote-dup");
      await seedTopic(t, "proposed");

      const first = await votePost(postJson(`/api/pact/${t}/vote`, { vote: "approve" }), params({ topicId: t }));
      expect(first.status).toBe(200);

      const second = await votePost(postJson(`/api/pact/${t}/vote`, { vote: "approve" }), params({ topicId: t }));
      expect(second.status).toBe(409);

      expect(await count("SELECT count(*) AS n FROM topic_votes WHERE topic_id = ?", [t])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.topic.vote.approve'", [t])).toBe(1);
    });
  });

  // ── The finalize helper's savepoint (reached from the wrapped vote route) ──
  describe("finalizeApprovedTopic inside a transaction", () => {
    it("a failing legislation auto-ingest no longer poisons the enclosing transaction — the topic still opens and the approval event commits", async () => {
      const t = topicId("finalize-ingest-fail");
      const title = `[Legislation Proposal] Broken ingest ${RUN}`;
      await seedTopic(t, "proposed", title);
      // A proposed-legislation event whose document payload will make
      // ingestDocuments throw inside the savepoint region (after the
      // region's first SQL statement has already run on the transaction).
      // Seeded inside its own transaction — PR-C's interlock refuses the
      // bare pooled client (ChainAppendError), by design.
      await db.transaction!(async (tx) => {
        await dbmod.emitEvent(tx, t, "pact.legislation.proposed", h.agentId, "", {
          document: { id: 42, sections: "not-an-array" },
          proposedBy: h.agentId,
        });
      });

      const outcome = await db.transaction!(async (tx) =>
        dbmod.finalizeApprovedTopic(tx, t, title, 3)
      );
      expect(outcome).toBe("opened");

      const status = await db.execute({ sql: "SELECT status FROM topics WHERE id = ?", args: [t] });
      expect(status.rows[0]?.status).toBe("open");
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.topic.approved'", [t])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.legislation.ingested'", [t])).toBe(0);
    });
  });

  // ── tailor-group#63: join-token never acts for an existing identity ───────
  describe("join-token (tailor-group#63): existing identities refused, new-agent creation atomic", () => {
    async function seedInvite(t: string, token: string, maxUses = 10): Promise<void> {
      await seedTopic(t, "open");
      await db.execute({
        sql: "INSERT INTO invite_tokens (token, topic_id, label, max_uses) VALUES (?, ?, 'itest', ?)",
        args: [token, t, maxUses],
      });
    }
    const inviteUses = async (token: string) =>
      count("SELECT uses AS n FROM invite_tokens WHERE token = ?", [token]);

    it("legacy plaintext and hashed existing agents: 409, no key, no registration, no invite use, no event", async () => {
      const t = topicId("jt-existing");
      const token = `jt-existing-${RUN}`;
      await seedInvite(t, token);
      // Synthetic keys only; the legacy row stores its plaintext, the other a hash.
      const legacyKey = `pact_sk_itestlegacy${RUN}`;
      const legacy = { id: `agent-63-legacy-${RUN}`, name: `itest 63 legacy ${RUN}` };
      const hashed = { id: `agent-63-hashed-${RUN}`, name: `itest 63 hashed ${RUN}` };
      const { hashAgentKey } = await import("@/lib/auth");
      await db.execute({ sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)", args: [legacy.id, legacy.name, legacyKey] });
      await db.execute({
        sql: "INSERT INTO agents (id, name, api_key) VALUES (?, ?, ?)",
        args: [hashed.id, hashed.name, hashAgentKey(`pact_sk_itesthashed${RUN}`)],
      });

      for (const agent of [legacy, hashed]) {
        const res = await joinTokenPost(postJson(`/api/pact/${t}/join-token`, { agentName: agent.name, token }), params({ topicId: t }));
        const text = await res.text();
        expect(res.status).toBe(409);
        expect(text).not.toContain("pact_sk_");
      }
      expect(await count("SELECT count(*) AS n FROM registrations WHERE topic_id = ?", [t])).toBe(0);
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ?", [t])).toBe(0);
      expect(await inviteUses(token)).toBe(0);
      // The legacy row is untouched (still its plaintext: nothing authenticated as it).
      const row = await db.execute({ sql: "SELECT api_key FROM agents WHERE id = ?", args: [legacy.id] });
      expect(row.rows[0]?.api_key).toBe(legacyKey);
    });

    it("mid-region failure at the chain append rolls back the new agent, the registration and the invite use", async () => {
      const t = topicId("jt-crash");
      const token = `jt-crash-${RUN}`;
      const name = `itest 63 crash ${RUN}`;
      await seedInvite(t, token);

      h.failNextEmit = true;
      await expect(
        joinTokenPost(postJson(`/api/pact/${t}/join-token`, { agentName: name, token }), params({ topicId: t }))
      ).rejects.toThrow("induced mid-region failure");

      expect(await count("SELECT count(*) AS n FROM agents WHERE name = ?", [name])).toBe(0);
      expect(await count("SELECT count(*) AS n FROM registrations WHERE topic_id = ?", [t])).toBe(0);
      expect(await inviteUses(token)).toBe(0);
    });

    it("commit path: a new agent, its registration, one invite use and the chain link land together", async () => {
      const t = topicId("jt-commit");
      const token = `jt-commit-${RUN}`;
      const name = `itest 63 new ${RUN}`;
      await seedInvite(t, token);

      const res = await joinTokenPost(postJson(`/api/pact/${t}/join-token`, { agentName: name, token }), params({ topicId: t }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.apiKey).toMatch(/^pact_sk_/);
      const stored = await db.execute({ sql: "SELECT id, api_key FROM agents WHERE name = ?", args: [name] });
      expect(stored.rows[0]?.id).toBe(json.agentId);
      expect(stored.rows[0]?.api_key).not.toBe(json.apiKey); // hashed at rest
      expect(await count("SELECT count(*) AS n FROM registrations WHERE topic_id = ? AND agent_id = ?", [t, json.agentId])).toBe(1);
      expect(await inviteUses(token)).toBe(1);
      expect(await count("SELECT count(*) AS n FROM events WHERE topic_id = ? AND type = 'pact.agent.joined'", [t])).toBe(1);
    });

    it("race: two concurrent joins for one new name create ONE agent; the loser gets 409 and no identity", async () => {
      const t = topicId("jt-race-name");
      const token = `jt-race-name-${RUN}`;
      const name = `itest 63 race ${RUN}`;
      await seedInvite(t, token);

      const results = await Promise.all(
        [0, 1].map(() => joinTokenPost(postJson(`/api/pact/${t}/join-token`, { agentName: name, token }), params({ topicId: t })))
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(await loser.json()).not.toHaveProperty("agentId");
      expect(await count("SELECT count(*) AS n FROM agents WHERE name = ?", [name])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM registrations WHERE topic_id = ?", [t])).toBe(1);
      expect(await inviteUses(token)).toBe(1);
    });

    it("race: the last invite use cannot be redeemed twice; the loser's new agent rolls back", async () => {
      const t = topicId("jt-race-invite");
      const token = `jt-race-invite-${RUN}`;
      await seedInvite(t, token, 1);

      const names = [`itest 63 last a ${RUN}`, `itest 63 last b ${RUN}`];
      const results = await Promise.all(
        names.map((agentName) => joinTokenPost(postJson(`/api/pact/${t}/join-token`, { agentName, token }), params({ topicId: t })))
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
      expect(await inviteUses(token)).toBe(1);
      expect(await count("SELECT count(*) AS n FROM agents WHERE name = ANY(?)", [names])).toBe(1);
    });
  });

  // ── The assumptions helper's remediated duplicate inserts ─────────────────
  describe("processAssumptions inside a transaction", () => {
    it("re-declaring an already-linked assumption is a non-error — the enclosing transaction stays healthy and commits", async () => {
      const { processAssumptions } = await import("@/lib/assumptions");
      const parent = topicId("assume-parent");
      const assumption = topicId("assume-dep");
      await seedTopic(parent, "open");
      await seedTopic(assumption, "open");
      // Pre-link AND pre-declare: both remediated INSERTs will conflict.
      await db.execute({
        sql: "INSERT INTO topic_dependencies (topic_id, depends_on, relationship) VALUES (?, ?, 'assumes')",
        args: [parent, assumption],
      });
      await db.execute({
        sql: "INSERT INTO assumption_declarations (id, topic_id, agent_id, assumption_topic_id, created_new) VALUES (?, ?, ?, ?, 0)",
        args: [`decl-${RUN}`, parent, h.agentId, assumption],
      });

      const key = `kgtx-5599-${RUN}-assume`;
      await db.transaction!(async (tx) => {
        const result = await processAssumptions(tx, parent, h.agentId, [{ topicId: assumption }]);
        expect(result.linked).toHaveLength(1);
        expect(result.errors).toHaveLength(0);
        // The transaction is NOT poisoned — a further write still works.
        await tx.execute({
          sql: "INSERT INTO sweep_state (key, value) VALUES (?, ?)",
          args: [key, "committed"],
        });
      });

      const r = await db.execute({ sql: "SELECT value FROM sweep_state WHERE key = ?", args: [key] });
      expect(r.rows[0]?.value).toBe("committed");
      expect(await count("SELECT count(*) AS n FROM topic_dependencies WHERE topic_id = ? AND depends_on = ?", [parent, assumption])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM assumption_declarations WHERE topic_id = ? AND assumption_topic_id = ?", [parent, assumption])).toBe(1);
    });
  });
});
