/**
 * #5277 — Regression tests for POST /api/pact/{topicId}/vote quorum transition.
 *
 * Defect (refs pact#56): a legislation proposal reaching its 3rd approval via
 * the vote route was flipped straight to status='open', but the legislation
 * auto-ingest branch lived only in evaluateTopicProposals (the sweep), which
 * scans status='proposed' — so quorum-by-vote NEVER ingested the legislation.
 *
 * These tests run the REAL `finalizeApprovedTopic` / `emitEvent` from
 * `@/lib/db` (only `getDb` is mocked) so the route's threshold branch is
 * proven to exercise the same ingest path the sweep uses:
 *   1. 3rd approval on a "[Legislation Proposal]" topic → ingestDocuments
 *      fires, topic → 'consensus', `pact.legislation.ingested` emitted.
 *   2. 3rd approval on a non-legislation topic → topic → 'open',
 *      `pact.topic.approved` emitted, NO ingest.
 *   3. Below-quorum approval → no status change, NO ingest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

type ExecuteArg = string | { sql: string; args: unknown[] };

const executedStatements: { sql: string; args: unknown[] }[] = [];

/** #5566 — `events.id` the chained INSERT ... RETURNING hands back. */
let nextEventRowId = 1;

const mockDb = {
  execute: vi.fn<(stmt: ExecuteArg) => Promise<DbResult>>(),
  batch: vi.fn(),
};

// Partial mock: keep the REAL finalizeApprovedTopic + emitEvent (the code
// under test), replace only the connection factory.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: async () => mockDb as unknown as DbClient,
  };
});

vi.mock("@/lib/auth", () => ({
  requireAgent: vi.fn(async () => ({ id: "agent-1", name: "Verifier One" })),
  checkAgentReputation: vi.fn(async () => ({ eligible: true })),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
  getRateLimitHeaders: vi.fn(() => ({})),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => {}),
  ipCountryFromHeaders: vi.fn(() => null),
}));

const ingestDocuments = vi.fn(async () => ({ ingested: 1, sectionsTotal: 3 }));
vi.mock("@/lib/legislation-sync", () => ({
  ingestDocuments: (...args: unknown[]) =>
    (ingestDocuments as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

import { POST } from "./route";

const LEGISLATION_TOPIC_ID = "b929b87e-01ca-4ead-b520-3e7d674f0507";
const PLAIN_TOPIC_ID = "11111111-2222-3333-4444-555555555555";

const legislationPayload = {
  proposedBy: "agent-0",
  document: {
    id: "qld/report-2026-moonside",
    title: "Moonside Report 2026",
    sections: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
  },
};

function topicRow(id: string, title: string, tier = "institutional", createdAt?: string) {
  return { id, title, status: "proposed", tier, ...(createdAt ? { created_at: createdAt } : {}) };
}

/** #5459 — one row of the computeTopicVoteTally votes query. */
function tallyVoteRow(
  agentId: string,
  voteType: string,
  opts: Partial<Record<string, unknown>> = {}
) {
  return {
    agent_id: agentId,
    vote_type: voteType,
    reason: null,
    created_at: "2026-09-01T00:00:00Z",
    need_info_topic_id: null,
    agent_name: agentId,
    independence_class: null,
    agent_age_days: 30,
    merged_contributions: 2,
    earned_credit_events: 0,
    ...opts,
  };
}

/**
 * SQL-shape-dispatching db mock: responds by statement content (not call
 * order) so the real finalizeApprovedTopic / finalizeRejectedTopic /
 * emitEvent can interleave their own statements freely. Every statement is
 * recorded for assertions. UPDATE statements report rowsAffected: 1 so the
 * #5425 conditional-transition guards see the transition succeed.
 * #5459: topics with a post-cutoff created_at route through the class
 * tally, served from `voteRows` / `creators`.
 */
function armDb(opts: {
  topic: { id: string; title: string; tier?: string; createdAt?: string };
  approveCount: number;
  rejectCount?: number;
  voteRows?: Record<string, unknown>[];
  creators?: Record<string, unknown>[];
}) {
  mockDb.execute.mockImplementation(async (stmt: ExecuteArg) => {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    const args = typeof stmt === "string" ? [] : stmt.args;
    executedStatements.push({ sql, args });

    if (sql.includes("FROM topics WHERE id = ?")) {
      return {
        rows: [topicRow(opts.topic.id, opts.topic.title, opts.topic.tier, opts.topic.createdAt)],
      };
    }
    if (sql.startsWith("INSERT INTO topic_votes")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT COUNT(*) as c FROM topic_votes") && sql.includes("vote_type = 'approve'")) {
      return { rows: [{ c: opts.approveCount }] };
    }
    if (sql.includes("SELECT COUNT(*) as c FROM topic_votes") && sql.includes("vote_type = 'reject'")) {
      return { rows: [{ c: opts.rejectCount ?? 0 }] };
    }
    // #5459 — computeTopicVoteTally: votes with class + standing metadata.
    if (sql.includes("FROM topic_votes tv")) {
      return { rows: (opts.voteRows ?? []).map((v) => ({ ...v })) };
    }
    // #5459 — computeTopicVoteTally: the proposer's class(es).
    if (sql.includes("r.role = 'creator'")) {
      return { rows: (opts.creators ?? []).map((c) => ({ independence_class: null, ...c })) };
    }
    if (sql.includes("type = 'pact.legislation.proposed'")) {
      return { rows: [{ data: JSON.stringify(legislationPayload) }] };
    }
    // #5566 — emitEvent now mints a §6.4 chain link, so the events INSERT
    // must return the row id the hash stamp keys on. The chain-head read and
    // the unchained count fall through to the empty default below, which
    // models a resource with no events yet (genesis).
    if (sql.startsWith("INSERT INTO events")) {
      return { rows: [{ id: nextEventRowId++ }], rowsAffected: 1 };
    }
    if (sql.startsWith("UPDATE")) {
      return { rows: [], rowsAffected: 1 };
    }
    // SELECT pg_advisory_xact_lock / chain-head read / unchained count, etc.
    return { rows: [] };
  });
}

function callPost(topicId: string, vote: "approve" | "reject" = "approve") {
  return POST(
    new Request(`http://localhost/api/pact/${topicId}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vote }),
      // @ts-expect-error -- Node fetch requires duplex for streamed bodies
      duplex: "half",
    }) as never,
    { params: Promise.resolve({ topicId }) }
  );
}

function statusUpdates() {
  return executedStatements.filter((s) => s.sql.includes("UPDATE topics SET status ="));
}

function eventInserts() {
  return executedStatements
    .filter((s) => s.sql.startsWith("INSERT INTO events"))
    .map((s) => s.args[1] as string); // event type is the 2nd arg
}

beforeEach(() => {
  mockDb.execute.mockReset();
  ingestDocuments.mockClear();
  executedStatements.length = 0;
  nextEventRowId = 1;
});

describe("POST /api/pact/{topicId}/vote — quorum transition (#5277)", () => {
  it("3rd approval on a legislation proposal fires the auto-ingest path (topic → consensus)", async () => {
    armDb({
      topic: { id: LEGISLATION_TOPIC_ID, title: "[Legislation Proposal] Moonside Report 2026" },
      approveCount: 3,
    });

    const res = await callPost(LEGISLATION_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("consensus");
    expect(body.approvals).toBe(3);

    // The SAME ingest path as the sweep: ingestDocuments ran with the
    // proposed document, the topic went to 'consensus' (never 'open'),
    // and pact.legislation.ingested was emitted.
    expect(ingestDocuments).toHaveBeenCalledTimes(1);
    // tailor-group#35 — the finalizer declares itself as the proposal source.
    expect(ingestDocuments).toHaveBeenCalledWith(mockDb, [legislationPayload.document], { source: "proposal" });

    const updates = statusUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("'consensus'");
    expect(updates[0].args).toEqual([LEGISLATION_TOPIC_ID]);

    const events = eventInserts();
    expect(events).toContain("pact.legislation.ingested");
    expect(events).not.toContain("pact.topic.approved");
  });

  it("tailor-group#37: 3rd approval whose document the ingest REJECTS opens the topic for debate (never 'consensus', no ingested event)", async () => {
    // ingestDocuments now returns the rejection instead of throwing; the
    // finalizer must treat "nothing written" as a failed ingest.
    ingestDocuments.mockResolvedValueOnce({
      ingested: 0,
      sectionsTotal: 0,
      rejected: [{ id: "qld/report-2026-moonside", path: "documents[0].sections[1].id", message: "must be unique within the document" }],
      skipped: [],
    } as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    armDb({
      topic: { id: LEGISLATION_TOPIC_ID, title: "[Legislation Proposal] Moonside Report 2026" },
      approveCount: 3,
    });

    const res = await callPost(LEGISLATION_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");

    expect(ingestDocuments).toHaveBeenCalledTimes(1);
    const updates = statusUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("'open'");

    const events = eventInserts();
    expect(events).not.toContain("pact.legislation.ingested");
    expect(events).toContain("pact.topic.approved");
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Legislation auto-ingest failed"),
      expect.objectContaining({ message: expect.stringContaining("qld/report-2026-moonside rejected") })
    );
    consoleError.mockRestore();
  });

  it("3rd approval on a non-legislation topic opens it for debate (no ingest)", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Some ordinary institutional topic" },
      approveCount: 3,
    });

    const res = await callPost(PLAIN_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");

    expect(ingestDocuments).not.toHaveBeenCalled();

    const updates = statusUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("'open'");
    expect(updates[0].args).toEqual([PLAIN_TOPIC_ID]);

    const events = eventInserts();
    expect(events).toContain("pact.topic.approved");
    expect(events).not.toContain("pact.legislation.ingested");
  });

  it("below-quorum approval on a legislation proposal changes nothing (no ingest, no status change)", async () => {
    armDb({
      topic: { id: LEGISLATION_TOPIC_ID, title: "[Legislation Proposal] Moonside Report 2026" },
      approveCount: 2,
    });

    const res = await callPost(LEGISLATION_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(body.approvalsNeeded).toBe(1);

    expect(ingestDocuments).not.toHaveBeenCalled();
    expect(statusUpdates()).toHaveLength(0);
    expect(eventInserts()).not.toContain("pact.legislation.ingested");
    expect(eventInserts()).not.toContain("pact.topic.approved");
  });
});

describe("POST /api/pact/{topicId}/vote — first-class rejection (#5425)", () => {
  it("reject quorum reached before approval quorum → terminal 'rejected', event emitted, NO ingest", async () => {
    armDb({
      topic: { id: LEGISLATION_TOPIC_ID, title: "[Legislation Proposal] Moonside Report 2026" },
      approveCount: 1,
      rejectCount: 3, // institutional quorum = 3
    });

    const res = await callPost(LEGISLATION_TOPIC_ID, "reject");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("rejected");
    expect(body.rejections).toBe(3);

    // Rejected legislation proposals NEVER ingest.
    expect(ingestDocuments).not.toHaveBeenCalled();

    const updates = statusUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("'rejected'");
    // Terminal transition is guarded: only a still-proposed topic flips.
    expect(updates[0].sql).toContain("AND status = 'proposed'");
    expect(updates[0].args).toEqual([LEGISLATION_TOPIC_ID]);

    const events = eventInserts();
    expect(events).toContain("pact.topic.rejected");
    expect(events).not.toContain("pact.topic.approved");
    expect(events).not.toContain("pact.legislation.ingested");
  });

  it("race rule: BOTH quorums met in the same tally → approval wins (rejection is terminal, approval is recoverable)", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Contested ordinary topic" },
      approveCount: 3,
      rejectCount: 3,
    });

    const res = await callPost(PLAIN_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");

    const events = eventInserts();
    expect(events).toContain("pact.topic.approved");
    expect(events).not.toContain("pact.topic.rejected");
  });

  it("below-quorum rejections change nothing (status stays 'proposed')", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Some ordinary institutional topic" },
      approveCount: 0,
      rejectCount: 2,
    });

    const res = await callPost(PLAIN_TOPIC_ID, "reject");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(body.rejectionsNeeded).toBe(1);
    expect(statusUpdates()).toHaveLength(0);
    expect(eventInserts()).not.toContain("pact.topic.rejected");
  });

  it("quorum is tier-based (single-sourced): 3 approvals on an interpretive topic (quorum 4) do NOT open it", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Interpretive question", tier: "interpretive" },
      approveCount: 3,
      rejectCount: 0,
    });

    const res = await callPost(PLAIN_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(body.approvalsNeeded).toBe(1);
    expect(statusUpdates()).toHaveLength(0);
  });

  it("3 rejects on an interpretive topic (quorum 4) do NOT reject it", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Interpretive question", tier: "interpretive" },
      approveCount: 0,
      rejectCount: 3,
    });

    const res = await callPost(PLAIN_TOPIC_ID, "reject");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(statusUpdates()).toHaveLength(0);
    expect(eventInserts()).not.toContain("pact.topic.rejected");
  });
});

describe("POST /api/pact/{topicId}/vote — independence-class counting (#5459)", () => {
  const POST_CUTOFF = "2026-09-01T00:00:00Z";

  it("post-cutoff topic: 3 distinct-class approvals from OTHERS ingest the legislation", async () => {
    armDb({
      topic: {
        id: LEGISLATION_TOPIC_ID,
        title: "[Legislation Proposal] Moonside Report 2026",
        createdAt: POST_CUTOFF,
      },
      approveCount: 0, // legacy COUNT path must not be consulted
      voteRows: [
        tallyVoteRow("proposer", "approve"),
        tallyVoteRow("a1", "approve"),
        tallyVoteRow("a2", "approve"),
        tallyVoteRow("a3", "approve"),
      ],
      creators: [{ agent_id: "proposer" }],
    });

    const res = await callPost(LEGISLATION_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("consensus");
    expect(body.countingMode).toBe("class-v1");
    expect(body.countedApprovals).toBe(3); // proposer's vote excluded
    expect(body.approvals).toBe(4); // raw count stays visible
    expect(ingestDocuments).toHaveBeenCalledTimes(1);
    expect(eventInserts()).toContain("pact.legislation.ingested");
  });

  it("post-cutoff topic: proposer + 2 others is NO LONGER quorum (the old hole)", async () => {
    armDb({
      topic: {
        id: LEGISLATION_TOPIC_ID,
        title: "[Legislation Proposal] Moonside Report 2026",
        createdAt: POST_CUTOFF,
      },
      approveCount: 0,
      voteRows: [
        tallyVoteRow("proposer", "approve"),
        tallyVoteRow("a1", "approve"),
        tallyVoteRow("a2", "approve"),
      ],
      creators: [{ agent_id: "proposer" }],
    });

    const res = await callPost(LEGISLATION_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(body.countedApprovals).toBe(2);
    expect(body.approvalsNeeded).toBe(1);
    expect(ingestDocuments).not.toHaveBeenCalled();
    expect(statusUpdates()).toHaveLength(0);
  });

  it("post-cutoff topic: same-class votes collapse to one quorum count", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Ordinary post-cutoff topic", createdAt: POST_CUTOFF },
      approveCount: 0,
      voteRows: [
        tallyVoteRow("a1", "approve", { independence_class: "operator.example" }),
        tallyVoteRow("a2", "approve", { independence_class: "operator.example" }),
        tallyVoteRow("a3", "approve"),
      ],
      creators: [{ agent_id: "proposer" }],
    });

    const res = await callPost(PLAIN_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(body.approvals).toBe(3);
    expect(body.countedApprovals).toBe(2);
    expect(statusUpdates()).toHaveLength(0);
  });

  it("post-cutoff topic: standing-gated votes are recorded but never counted", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Ordinary post-cutoff topic", createdAt: POST_CUTOFF },
      approveCount: 0,
      voteRows: [
        tallyVoteRow("a1", "approve"),
        tallyVoteRow("a2", "approve"),
        tallyVoteRow("newborn", "approve", { agent_age_days: 0.01, merged_contributions: 0 }),
      ],
      creators: [{ agent_id: "proposer" }],
    });

    const res = await callPost(PLAIN_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("proposed");
    expect(body.approvals).toBe(3);
    expect(body.countedApprovals).toBe(2);
  });

  it("grandfathered topic (no created_at in row → legacy) keeps raw counting: proposer + 2 opens", async () => {
    armDb({
      topic: { id: PLAIN_TOPIC_ID, title: "Some ordinary institutional topic" },
      approveCount: 3, // raw count incl. a proposer self-approve
    });

    const res = await callPost(PLAIN_TOPIC_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");
    expect(body.countingMode).toBe("legacy");
  });
});
