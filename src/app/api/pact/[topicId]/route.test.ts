/**
 * #1170 Round 2 — Regression tests for GET /api/pact/{topicId}.
 *
 * Prevents the "stub topic → 500" regression: the handler must return a
 * deterministic 200 for any topic row that exists, even when its supporting
 * tables (proposals, votes) are empty OR a sub-query throws. Missing topics
 * still return a clean 404.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient, DbResult } from "@/lib/db";

// Shape of the mocked db — one function whose behaviour each test overrides.
type MockDb = {
  execute: ReturnType<typeof vi.fn<(stmt: string | { sql: string; args: unknown[] }) => Promise<DbResult>>>;
  batch: ReturnType<typeof vi.fn>;
};

const mockDb: MockDb = {
  execute: vi.fn(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  getDb: async () => mockDb as unknown as DbClient,
}));

import { GET } from "./route";

function callGet(topicId: string) {
  return GET(new Request(`http://localhost/api/pact/${topicId}`), {
    params: Promise.resolve({ topicId }),
  });
}

// Helper: build the topic row that the handler expects from its SELECT.
function topicRow(id: string): Record<string, unknown> {
  return {
    id,
    title: "Stub topic",
    content: "",
    tier: "institutional",
    status: "stub",
    created_at: "2026-04-18T00:00:00Z",
    consensus_ratio: null,
    consensus_since: null,
    canonical_claim: null,
    jurisdiction: null,
    authority: null,
    source_ref: null,
    effective_date: null,
    expiry_date: null,
    participantCount: 0,
    proposalCount: 0,
    mergedCount: 0,
  };
}

beforeEach(() => {
  mockDb.execute.mockReset();
});

describe("GET /api/pact/{topicId}", () => {
  it("returns 404 with { error: 'Topic not found' } when topic does not exist", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const res = await callGet("does-not-exist");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Topic not found" });
  });

  it("returns 200 with empty proposals/votes arrays for a stub topic", async () => {
    const id = "topic:stub:281a63e0090f5109";
    mockDb.execute
      .mockResolvedValueOnce({ rows: [topicRow(id)] }) // topic SELECT
      .mockResolvedValueOnce({ rows: [] })             // proposals
      .mockResolvedValueOnce({ rows: [] });            // topic_votes

    const res = await callGet(id);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.proposals).toEqual([]);
    expect(body.votes).toEqual([]);
  });

  it("still returns 200 with empty arrays if the proposals sub-query throws (schema drift hardening)", async () => {
    const id = "topic:stub:cea63acec766acc3";
    mockDb.execute
      .mockResolvedValueOnce({ rows: [topicRow(id)] })                                       // topic SELECT
      .mockRejectedValueOnce(Object.assign(new Error("column p.content does not exist"), { code: "42703" })) // proposals
      .mockResolvedValueOnce({ rows: [] });                                                  // topic_votes

    const res = await callGet(id);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.proposals).toEqual([]);
    expect(body.votes).toEqual([]);
  });

  it("still returns 200 with empty votes if the topic_votes sub-query throws", async () => {
    const id = "topic:stub:42e301d6b521cbc1";
    mockDb.execute
      .mockResolvedValueOnce({ rows: [topicRow(id)] })                     // topic SELECT
      .mockResolvedValueOnce({ rows: [] })                                 // proposals
      .mockRejectedValueOnce(new Error("relation topic_votes stale"));     // topic_votes

    const res = await callGet(id);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposals).toEqual([]);
    expect(body.votes).toEqual([]);
  });

  // ── #5564 — grandfathering + additive shape ─────────────────────────

  it("derives the epistemics fields for a pre-change-shaped row (credence NULL, legacy tier, challenged)", async () => {
    const id = "topic:legacy:pre-epistemics";
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          {
            ...topicRow(id),
            tier: "convention", // pre-canonicalizeTier legacy spelling
            status: "challenged",
            consensus_ratio: null,
            claim_support: null,
            claim_atomicity_status: null,
            convention_stop: 0,
            credence: null, // written before the sweep stored effective credence
            consensus_voters: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "prop-challenge",
            section_id: "sec:challenge",
            content: "counter-claim",
            summary: "The measurement was retracted",
            status: "challenge",
            created_at: "2026-02-01T00:00:00Z",
            proposalType: "challenge",
            defeaterType: "counter-evidence",
            proposedBy: "Agent One",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // topic_votes

    const res = await callGet(id);

    expect(res.status).toBe(200);
    const body = await res.json();
    // The source column stays on the wire; the collapse rides alongside.
    expect(body.tier).toBe("convention");
    expect(body.warrantKind).toBe("empirical");
    expect(body.state).toBe("contested");
    // NULL stored credence over a NULL ratio derives 0 — no backfill, no 500.
    expect(body.credence).toBe(0);
    expect(body.conventionStop).toBe(false);
    // #5564 — the embedded proposals now carry the typed defeater.
    expect(body.proposals[0].defeaterType).toBe("counter-evidence");
    expect(body.proposals[0].proposalType).toBe("challenge");
  });

  it("pins the pre-existing topic shape additively — a rename or removal fails", async () => {
    const id = "topic:stub:shape-pin";
    mockDb.execute
      .mockResolvedValueOnce({ rows: [topicRow(id)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await callGet(id);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "content",
        "tier",
        "status",
        "created_at",
        "consensus_ratio",
        "consensus_since",
        "canonical_claim",
        "jurisdiction",
        "participantCount",
        "proposalCount",
        "mergedCount",
        "warrantKind",
        "conventionStop",
        "state",
        "credence",
        "proposals",
        "votes",
      ])
    );
  });
});
