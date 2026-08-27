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
};

/**
 * Stateful mock: tracks per-topic status so the conditional
 * `UPDATE ... WHERE id = ? AND status = 'proposed'` transitions report an
 * honest rowsAffected, and the finalizeApprovedTopic guard SELECT sees the
 * live status.
 */
function makeDb(opts: { proposed?: ProposedRow[]; statusById: Record<string, string> }) {
  const statements: Stmt[] = [];
  const statusById = { ...opts.statusById };
  const db: DbClient = {
    async execute(stmtOrSql): Promise<DbResult> {
      const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
      const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
      statements.push({ sql, args });

      if (sql.includes("WHERE t.status = 'proposed'")) {
        return { rows: (opts.proposed ?? []).map((p) => ({ ...p })) };
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
      // INSERT INTO events (emitEvent), counters, etc.
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
