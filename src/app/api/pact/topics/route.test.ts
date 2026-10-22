/**
 * #5564 — grandfathering + additive-shape tests for GET /api/pact/topics.
 *
 * The epistemics wire fields (tier, warrantKind, state, credence,
 * conventionStop) must DERIVE for rows written before the epistemics wave —
 * credence NULL, legacy tier spellings, mid-lifecycle statuses — without a
 * backfill and without a 500. And the pre-existing response shape is pinned
 * additively: a rename or removal of a served field fails here; an added
 * field does not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getTopicsListMock = vi.fn<() => Promise<unknown[]>>();

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  return {
    ...actual,
    getTopicsList: (...args: unknown[]) =>
      (getTopicsListMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
  };
});

import { GET } from "./route";

/**
 * A topic row shaped the way rows written BEFORE the epistemics wave look:
 * no stored credence, a pre-canonicalizeTier legacy tier spelling, an
 * in-flight challenged status, and a null consensus ratio.
 */
function preChangeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "topic:legacy:0001",
    title: "Legacy pre-epistemics topic",
    content: "",
    tier: "frontier", // legacy spelling — canonicalizes to conjecture, reads as conjectural
    status: "challenged",
    created_at: "2026-01-01T00:00:00Z",
    consensus_ratio: null,
    consensus_since: null,
    canonical_claim: null,
    claim_support: null,
    claim_atomicity_status: null,
    convention_stop: 0,
    credence: null, // written before the sweep stored effective credence
    jurisdiction: null,
    authority: null,
    source_ref: null,
    effective_date: null,
    expiry_date: null,
    last_verified_at: null,
    blockingAssumptions: 0,
    participantCount: 2,
    proposalCount: 1,
    mergedCount: 1,
    pendingCount: 0,
    topicApprovals: 3,
    topicRejections: 0,
    alignedCount: 2,
    dissentingCount: 1,
    totalVotes: 3,
    ...overrides,
  };
}

function callGet() {
  return GET(new NextRequest("http://localhost:4000/api/pact/topics"));
}

beforeEach(() => {
  getTopicsListMock.mockReset();
});

describe("GET /api/pact/topics — pre-change rows derive the epistemics fields (#5564)", () => {
  it("derives warrantKind/state/credence for a credence-NULL, legacy-tier, challenged row without 500", async () => {
    getTopicsListMock.mockResolvedValueOnce([preChangeRow()]);

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    const t = body[0];

    // The SOURCE column stays on the wire (the extension's 8-value tier
    // vocabulary) — warrantKind is the product's lossy 4-value collapse
    // riding alongside, never replacing it.
    expect(t.tier).toBe("frontier");
    expect(t.warrantKind).toBe("conjectural");
    // Internal status → §2 protocol vocabulary, verbatim per the mapping.
    expect(t.state).toBe("contested");
    // No stored credence + null ratio derives 0 — no backfill, no 500.
    expect(t.credence).toBe(0);
    expect(t.conventionStop).toBe(false);
  });

  it("prefers the stored effective credence once the sweep has written it", async () => {
    getTopicsListMock.mockResolvedValueOnce([
      preChangeRow({ credence: 0.42, consensus_ratio: 0.95 }),
    ]);

    const res = await callGet();
    const body = await res.json();
    expect(body[0].credence).toBe(0.42);
  });

  it("reads every legacy tier spelling the column can still hold", async () => {
    const legacy: Array<[string, string]> = [
      ["axiom", "institutional"],
      ["convention", "empirical"],
      ["practice", "empirical"],
      ["policy", "institutional"],
      ["frontier", "conjectural"],
    ];
    getTopicsListMock.mockResolvedValueOnce(
      legacy.map(([tier], i) => preChangeRow({ id: `topic:legacy:${i}`, tier }))
    );

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    body.forEach((t: Record<string, unknown>, i: number) => {
      expect(t.tier).toBe(legacy[i][0]);
      expect(t.warrantKind).toBe(legacy[i][1]);
    });
  });

  it("pins the pre-existing response shape additively — a rename or removal fails", async () => {
    getTopicsListMock.mockResolvedValueOnce([preChangeRow()]);

    const res = await callGet();
    const body = await res.json();
    // Every field a pre-#5564 consumer could already read. Additions are
    // allowed (that is what additive means); renaming or removing any of
    // these turns this red.
    expect(Object.keys(body[0])).toEqual(
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
        "convention_stop",
        "credence",
        "jurisdiction",
        "participantCount",
        "proposalCount",
        "mergedCount",
        "warrantKind",
        "conventionStop",
        "state",
        "url",
        "apiUrl",
      ])
    );
  });
});
