/**
 * #5564 — the dependencies wire: the source `tier` column now rides on the
 * frontier block alongside the collapsed warrantKind (it was the one
 * hand-built topic shape that dropped it), and pre-change-shaped rows —
 * credence NULL, legacy tier spellings — derive every epistemics field
 * without a 500. The pre-existing shape is pinned additively.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DbClient, DbResult } from "@/lib/db";
import { requiredReopenVotes } from "@/lib/db";
import { DEFEATER_TYPES } from "@/lib/epistemic";

type ExecuteArg = string | { sql: string; args: unknown[] };

const mockDb = {
  execute: vi.fn<(stmt: ExecuteArg) => Promise<DbResult>>(),
  batch: vi.fn(),
};

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: async () => mockDb as unknown as DbClient,
  };
});

import { GET } from "./route";

const TOPIC_ID = "22222222-3333-4444-5555-666666666666";

function callGet() {
  return GET(new NextRequest(`http://localhost/api/pact/${TOPIC_ID}/dependencies`), {
    params: Promise.resolve({ topicId: TOPIC_ID }),
  });
}

beforeEach(() => {
  mockDb.execute.mockReset();
});

describe("GET /api/pact/{topicId}/dependencies — tier on the frontier + grandfathering (#5564)", () => {
  it("serves the source tier column on the frontier block alongside warrantKind", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] }) // deps (none → frontier)
      .mockResolvedValueOnce({ rows: [] }) // dependents
      .mockResolvedValueOnce({
        rows: [
          {
            id: TOPIC_ID,
            title: "A convention-stop node",
            status: "stable",
            // Legacy in-flight spelling: initSchema migrates stored rows,
            // but the wire must read one that has not been migrated yet.
            tier: "axiom",
            convention_stop: 1,
            credence: null, // pre-change row: sweep never stored one
            consensus_ratio: 0.95,
            consensus_since: "2026-01-01T00:00:00Z",
            consensus_voters: 5,
            standingChallenges: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ name: "Agent One" }] }); // aligned agents

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.frontier).not.toBeNull();
    // The source column — the extension's tier vocabulary — not just the
    // 4-value collapse.
    expect(body.frontier.tier).toBe("axiom");
    expect(body.frontier.warrantKind).toBe("institutional");
    expect(body.frontier.conventionStop).toBe(true);
    expect(body.frontier.state).toBe("verified");
    // credence NULL derives from the ratio via the §5.1 transform — no 500.
    expect(body.frontier.credence).toBeCloseTo(0.95 * 0.99, 10);
    // The reopen path stays intact: six typed defeaters + the §7.2 bar.
    expect(body.frontier.reopen.defeaterTypes).toEqual([...DEFEATER_TYPES]);
    expect(body.frontier.reopen.requiredSupportVotes).toBe(requiredReopenVotes(0));
  });

  it("derives fields on pre-change dependency rows (legacy tier, null credence) without 500", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          {
            depends_on: "topic:base",
            relationship: "assumes",
            justification: "necessity",
            title: "Base claim",
            status: "challenged",
            tier: "practice", // legacy spelling
            convention_stop: 0,
            credence: null,
            consensus_ratio: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // dependents
      .mockResolvedValueOnce({
        rows: [
          {
            id: TOPIC_ID,
            title: "Dependent claim",
            status: "open",
            tier: "empirical",
            convention_stop: 0,
            credence: null,
            consensus_ratio: null,
            consensus_since: null,
            consensus_voters: null,
            standingChallenges: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // aligned agents

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    const dep = body.assumptions[0];
    // Row spread keeps the source column; derived fields ride alongside.
    expect(dep.tier).toBe("practice");
    expect(dep.warrantKind).toBe("empirical");
    expect(dep.state).toBe("contested");
    expect(dep.credence).toBe(0);
    expect(dep.conventionStop).toBe(false);
    // Non-frontier anchor (it has a dependency) still carries the block.
    expect(body.frontier.isFrontier).toBe(false);
    expect(body.frontier.tier).toBe("empirical");
  });

  it("pins the pre-existing frontier shape additively — a rename or removal fails", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: TOPIC_ID,
            title: "T",
            status: "consensus",
            tier: "empirical",
            convention_stop: 0,
            credence: 0.5,
            consensus_ratio: 0.9,
            consensus_since: null,
            consensus_voters: 3,
            standingChallenges: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await callGet();
    const body = await res.json();
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["assumptions", "buildsOn", "assumedBy", "usedBy", "frontier"])
    );
    expect(Object.keys(body.frontier)).toEqual(
      expect.arrayContaining([
        "isFrontier",
        "tier",
        "warrantKind",
        "conventionStop",
        "state",
        "credence",
        "heldBy",
        "consensusVoters",
        "consensusSince",
        "standingChallenges",
        "reopen",
      ])
    );
    expect(Object.keys(body.frontier.reopen)).toEqual(
      expect.arrayContaining(["path", "proposalType", "defeaterTypes", "requiredSupportVotes"])
    );
  });
});
