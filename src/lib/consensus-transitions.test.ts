/**
 * #5425 — Unit tests for the topic-proposal tally/transition logic in db.ts:
 *
 *   - getTopicApprovalQuorum: tier-based, single-sourced (replaces the flat
 *     TOPIC_APPROVAL_THRESHOLD = 3 that was duplicated in db.ts and the
 *     vote route).
 *   - finalizeRejectedTopic: terminal 'rejected' transition, conditional on
 *     the topic still being 'proposed', emits pact.topic.rejected.
 *   - finalizeApprovedTopic: guarded — can NEVER run on a topic that has
 *     left 'proposed' (in particular a rejected topic), returns "skipped".
 *   - evaluateTopicProposals (the sweep): rejection-quorum-first → rejected
 *     with no ingest; approval-first → unchanged behaviour; both quorums in
 *     the same tally → approval wins (documented race rule).
 *
 * These run against a stateful in-memory DbClient mock — no Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";
import {
  getTopicApprovalQuorum,
  finalizeApprovedTopic,
  finalizeRejectedTopic,
  evaluateTopicProposals,
} from "@/lib/db";

const ingestDocuments = vi.fn(async () => ({ ingested: 1 }));
vi.mock("@/lib/legislation-sync", () => ({
  ingestDocuments: (...args: unknown[]) =>
    (ingestDocuments as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

type Stmt = { sql: string; args: unknown[] };

type ProposedRow = {
  id: string;
  title: string;
  tier: string;
  approvals: number;
  rejections: number;
  /** #5459 — post-cutoff rows switch the sweep to class counting. */
  created_at?: string;
};

/** #5459 — one row of the computeTopicVoteTally votes query. */
type MockVoteRow = {
  agent_id: string;
  vote_type: string;
  reason?: string | null;
  created_at?: string;
  need_info_topic_id?: string | null;
  agent_name?: string;
  independence_class?: string | null;
  agent_age_days?: number;
  merged_contributions?: number;
  earned_credit_events?: number;
};

function mockVote(
  agentId: string,
  voteType: string,
  opts: Partial<MockVoteRow> = {}
): MockVoteRow {
  return {
    agent_id: agentId,
    vote_type: voteType,
    agent_name: agentId,
    independence_class: null,
    // Defaults clear the standing gate (age 30d, 2 merged contributions).
    agent_age_days: 30,
    merged_contributions: 2,
    earned_credit_events: 0,
    ...opts,
  };
}

/**
 * Stateful mock: tracks per-topic status so the conditional
 * `UPDATE ... WHERE id = ? AND status = 'proposed'` transitions report an
 * honest rowsAffected, and the finalizeApprovedTopic guard SELECT sees the
 * live status. #5459: also serves the computeTopicVoteTally vote/creator
 * queries from `voteRows` / `creators` (keyed by topic id).
 */
function makeDb(opts: {
  proposed?: ProposedRow[];
  statusById: Record<string, string>;
  voteRows?: Record<string, MockVoteRow[]>;
  creators?: Record<string, { agent_id: string; independence_class?: string | null }[]>;
}) {
  const statements: Stmt[] = [];
  const statusById = { ...opts.statusById };
  let nextEventRowId = 1; // #5566 — `events.id` for the chained INSERT ... RETURNING
  const db: DbClient = {
    async execute(stmtOrSql): Promise<DbResult> {
      const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
      const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
      statements.push({ sql, args });

      if (sql.includes("WHERE t.status = 'proposed'")) {
        return { rows: (opts.proposed ?? []).map((p) => ({ ...p })) };
      }
      // #5459 — computeTopicVoteTally: votes with class + standing metadata.
      if (sql.includes("FROM topic_votes tv")) {
        return { rows: (opts.voteRows?.[args[0] as string] ?? []).map((v) => ({ ...v })) };
      }
      // #5459 — computeTopicVoteTally: the proposer's class(es).
      if (sql.includes("r.role = 'creator'")) {
        return {
          rows: (opts.creators?.[args[0] as string] ?? []).map((c) => ({
            independence_class: null,
            ...c,
          })),
        };
      }
      if (sql.includes("SELECT status FROM topics WHERE id = ?")) {
        const status = statusById[args[0] as string];
        return { rows: status ? [{ status }] : [] };
      }
      if (sql.startsWith("UPDATE topics SET status = ")) {
        const id = args[0] as string;
        if (sql.includes("AND status = 'proposed'") && statusById[id] !== "proposed") {
          return { rows: [], rowsAffected: 0 };
        }
        const target = sql.includes("'rejected'")
          ? "rejected"
          : sql.includes("'consensus'")
            ? "consensus"
            : sql.includes("'open'")
              ? "open"
              : null;
        if (target) statusById[id] = target;
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("type = 'pact.legislation.proposed'")) {
        return {
          rows: [
            {
              data: JSON.stringify({
                proposedBy: "agent-0",
                document: { id: "doc-1", title: "Doc", sections: [] },
              }),
            },
          ],
        };
      }
      // #5566 — emitEvent mints a §6.4 chain link, so the events INSERT must
      // return the row id its hash stamp keys on. The chain-head read and the
      // unchained count fall through below (empty ⇒ genesis), and the hash
      // stamp is covered by the generic rowsAffected: 1 default.
      if (sql.startsWith("INSERT INTO events")) {
        return { rows: [{ id: nextEventRowId++ }], rowsAffected: 1 };
      }
      // Chain-head read: no chained rows in this fixture ⇒ genesis.
      if (sql.includes("SELECT sequence_number, event_hash FROM events")) {
        return { rows: [] };
      }
      if (sql.includes("COUNT(*) AS unchained_count")) {
        return { rows: [{ unchained_count: 0 }] };
      }
      // pg_advisory_xact_lock, counters, etc.
      return { rows: [], rowsAffected: 1 };
    },
    async batch() {},
  };
  return { db, statements, statusById };
}

function eventTypes(statements: Stmt[]): string[] {
  return statements
    .filter((s) => s.sql.startsWith("INSERT INTO events"))
    .map((s) => s.args[1] as string);
}

beforeEach(() => {
  ingestDocuments.mockClear();
});

describe("getTopicApprovalQuorum — tier-based, single-sourced (#5425)", () => {
  it("uses the TIER_BASE_AGENTS participation floor per tier", () => {
    expect(getTopicApprovalQuorum("empirical")).toBe(3);
    expect(getTopicApprovalQuorum("institutional")).toBe(3);
    expect(getTopicApprovalQuorum("convention")).toBe(3);
    expect(getTopicApprovalQuorum("practice")).toBe(3);
    expect(getTopicApprovalQuorum("policy")).toBe(3);
    expect(getTopicApprovalQuorum("interpretive")).toBe(4);
    expect(getTopicApprovalQuorum("conjecture")).toBe(5);
    expect(getTopicApprovalQuorum("frontier")).toBe(5);
  });

  it("falls back to the default base (3) for unknown or missing tiers", () => {
    expect(getTopicApprovalQuorum("axiom")).toBe(3);
    expect(getTopicApprovalQuorum(null)).toBe(3);
    expect(getTopicApprovalQuorum(undefined)).toBe(3);
    expect(getTopicApprovalQuorum("no-such-tier")).toBe(3);
  });
});

describe("finalizeRejectedTopic (#5425)", () => {
  it("transitions a proposed topic to terminal 'rejected' and emits pact.topic.rejected", async () => {
    const { db, statements, statusById } = makeDb({ statusById: { t1: "proposed" } });

    const transitioned = await finalizeRejectedTopic(db, "t1", "Bad claim", 3, 3);

    expect(transitioned).toBe(true);
    expect(statusById.t1).toBe("rejected");
    expect(eventTypes(statements)).toContain("pact.topic.rejected");
  });

  it("refuses to double-fire: a topic that already left 'proposed' is untouched, no event", async () => {
    const { db, statements, statusById } = makeDb({ statusById: { t1: "open" } });

    const transitioned = await finalizeRejectedTopic(db, "t1", "Already open", 3, 3);

    expect(transitioned).toBe(false);
    expect(statusById.t1).toBe("open");
    expect(eventTypes(statements)).toHaveLength(0);
  });
});

describe("finalizeApprovedTopic guard (#5425)", () => {
  it("can never run on a rejected topic — returns 'skipped', no status change, no events, no ingest", async () => {
    const { db, statements, statusById } = makeDb({ statusById: { t1: "rejected" } });

    const outcome = await finalizeApprovedTopic(
      db,
      "t1",
      "[Legislation Proposal] Rejected Act 2026",
      3,
      3
    );

    expect(outcome).toBe("skipped");
    expect(statusById.t1).toBe("rejected");
    expect(ingestDocuments).not.toHaveBeenCalled();
    expect(eventTypes(statements)).toHaveLength(0);
  });

  it("still opens a genuinely proposed topic (unchanged approval behaviour)", async () => {
    const { db, statements, statusById } = makeDb({ statusById: { t1: "proposed" } });

    const outcome = await finalizeApprovedTopic(db, "t1", "Ordinary topic", 3, 3);

    expect(outcome).toBe("opened");
    expect(statusById.t1).toBe("open");
    expect(eventTypes(statements)).toContain("pact.topic.approved");
  });
});

describe("evaluateTopicProposals sweep (#5425)", () => {
  it("rejection quorum reached first → topic rejected, legislation NEVER ingests", async () => {
    const row: ProposedRow = {
      id: "t1",
      title: "[Legislation Proposal] Contested Act 2026",
      tier: "institutional",
      approvals: 1,
      rejections: 3,
    };
    const { db, statements, statusById } = makeDb({
      proposed: [row],
      statusById: { t1: "proposed" },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(0);
    expect(statusById.t1).toBe("rejected");
    expect(ingestDocuments).not.toHaveBeenCalled();
    const events = eventTypes(statements);
    expect(events).toContain("pact.topic.rejected");
    expect(events).not.toContain("pact.topic.approved");
    expect(events).not.toContain("pact.legislation.ingested");
  });

  it("approval quorum reached → unchanged behaviour (topic opens)", async () => {
    const row: ProposedRow = {
      id: "t1",
      title: "Ordinary topic",
      tier: "institutional",
      approvals: 3,
      rejections: 1,
    };
    const { db, statements, statusById } = makeDb({
      proposed: [row],
      statusById: { t1: "proposed" },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(1);
    expect(statusById.t1).toBe("open");
    const events = eventTypes(statements);
    expect(events).toContain("pact.topic.approved");
    expect(events).not.toContain("pact.topic.rejected");
  });

  it("race rule: both quorums met in the same tally → approval wins", async () => {
    const row: ProposedRow = {
      id: "t1",
      title: "Contested topic",
      tier: "institutional",
      approvals: 3,
      rejections: 3,
    };
    const { db, statements, statusById } = makeDb({
      proposed: [row],
      statusById: { t1: "proposed" },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(1);
    expect(statusById.t1).toBe("open");
    const events = eventTypes(statements);
    expect(events).toContain("pact.topic.approved");
    expect(events).not.toContain("pact.topic.rejected");
  });

  it("tier quorum is honoured: 3 rejects on a frontier topic (quorum 5) change nothing", async () => {
    const row: ProposedRow = {
      id: "t1",
      title: "Frontier conjecture",
      tier: "frontier",
      approvals: 0,
      rejections: 3,
    };
    const { db, statements, statusById } = makeDb({
      proposed: [row],
      statusById: { t1: "proposed" },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(0);
    expect(statusById.t1).toBe("proposed");
    expect(eventTypes(statements)).toHaveLength(0);
  });
});

// ─── #5459 — independence-class counting in the sweep ─────────────────

const POST_CUTOFF = "2026-09-01T00:00:00Z";
const PRE_CUTOFF = "2026-08-01T00:00:00Z";

function classRow(overrides: Partial<ProposedRow> = {}): ProposedRow {
  return {
    id: "t1",
    title: "[Legislation Proposal] Class Counted Act 2026",
    tier: "institutional",
    approvals: 3,
    rejections: 0,
    created_at: POST_CUTOFF,
    ...overrides,
  };
}

describe("evaluateTopicProposals — independence classes (#5459)", () => {
  it("proposer self-approve no longer opens: proposer + 2 others counts as 2 (< quorum 3)", async () => {
    const { db, statements, statusById } = makeDb({
      proposed: [classRow()],
      statusById: { t1: "proposed" },
      voteRows: {
        t1: [
          mockVote("proposer", "approve"),
          mockVote("a1", "approve"),
          mockVote("a2", "approve"),
        ],
      },
      creators: { t1: [{ agent_id: "proposer" }] },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(0);
    expect(statusById.t1).toBe("proposed");
    expect(ingestDocuments).not.toHaveBeenCalled();
    expect(eventTypes(statements)).toHaveLength(0);
  });

  it("3 distinct-class standing-eligible approvals from OTHERS reach quorum (legislation ingests)", async () => {
    const { db, statements, statusById } = makeDb({
      proposed: [classRow()],
      statusById: { t1: "proposed" },
      voteRows: {
        t1: [
          mockVote("proposer", "approve"),
          mockVote("a1", "approve"),
          mockVote("a2", "approve"),
          mockVote("a3", "approve"),
        ],
      },
      creators: { t1: [{ agent_id: "proposer" }] },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(1);
    expect(statusById.t1).toBe("consensus");
    expect(ingestDocuments).toHaveBeenCalledTimes(1);
    expect(eventTypes(statements)).toContain("pact.legislation.ingested");
  });

  it("class collapse: two same-class agents + one distinct = 2 counted (< quorum 3)", async () => {
    const { db, statusById } = makeDb({
      proposed: [classRow()],
      statusById: { t1: "proposed" },
      voteRows: {
        t1: [
          mockVote("a1", "approve", { independence_class: "operator.example" }),
          mockVote("a2", "approve", { independence_class: "operator.example" }),
          mockVote("a3", "approve"),
        ],
      },
      creators: { t1: [{ agent_id: "proposer" }] },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(0);
    expect(statusById.t1).toBe("proposed");
    expect(ingestDocuments).not.toHaveBeenCalled();
  });

  it("standing gate: young / zero-contribution votes are recorded but do not count", async () => {
    const { db, statusById } = makeDb({
      proposed: [classRow()],
      statusById: { t1: "proposed" },
      voteRows: {
        t1: [
          mockVote("a1", "approve"),
          mockVote("a2", "approve"),
          // Too young AND no accepted contributions — recorded, not counted.
          mockVote("newborn", "approve", { agent_age_days: 0.01, merged_contributions: 0 }),
        ],
      },
      creators: { t1: [{ agent_id: "proposer" }] },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(0);
    expect(statusById.t1).toBe("proposed");
  });

  it("rejection counts symmetrically: 3 distinct non-proposer classes reject → terminal", async () => {
    const { db, statements, statusById } = makeDb({
      proposed: [classRow({ approvals: 0, rejections: 3 })],
      statusById: { t1: "proposed" },
      voteRows: {
        t1: [
          mockVote("a1", "reject"),
          mockVote("a2", "reject"),
          mockVote("a3", "reject"),
        ],
      },
      creators: { t1: [{ agent_id: "proposer" }] },
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(0);
    expect(statusById.t1).toBe("rejected");
    expect(eventTypes(statements)).toContain("pact.topic.rejected");
    expect(ingestDocuments).not.toHaveBeenCalled();
  });

  it("grandfather boundary: a pre-cutoff topic still opens under legacy raw counting (proposer + 2)", async () => {
    const { db, statements, statusById } = makeDb({
      proposed: [classRow({ title: "Old ordinary topic", created_at: PRE_CUTOFF, approvals: 3 })],
      statusById: { t1: "proposed" },
      // NO voteRows needed: the legacy path never queries per-vote metadata.
    });

    const opened = await evaluateTopicProposals(db);

    expect(opened).toBe(1);
    expect(statusById.t1).toBe("open");
    expect(eventTypes(statements)).toContain("pact.topic.approved");
    // The class tally was never consulted for a grandfathered topic.
    const tallyQueries = statements.filter(
      (s) => s.sql.includes("FROM topic_votes tv") && !s.sql.includes("WHERE t.status = 'proposed'")
    );
    expect(tallyQueries).toHaveLength(0);
  });
});
