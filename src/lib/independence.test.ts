/**
 * #5459 — Unit tests for the pure independence-class counting rule
 * (lib/independence.ts): class-counted quorums, proposer-class exclusion
 * (no self-approve), standing gates, and the grandfather boundary.
 */
import { describe, it, expect } from "vitest";
import {
  INDEPENDENCE_CONFIG,
  deriveClassKey,
  meetsStanding,
  tallyVotes,
  usesClassCounting,
  type TallyVote,
} from "@/lib/independence";

function vote(
  agentId: string,
  voteType: string,
  opts: { classKey?: string; standingEligible?: boolean } = {}
): TallyVote {
  return {
    agentId,
    voteType,
    classKey: opts.classKey ?? `agent:${agentId}`,
    standingEligible: opts.standingEligible ?? true,
  };
}

describe("deriveClassKey (#5459)", () => {
  it("uses the verified handler-domain as a shared class when present", () => {
    expect(deriveClassKey("a1", "Example.COM ")).toBe("domain:example.com");
    expect(deriveClassKey("a2", "example.com")).toBe("domain:example.com");
  });

  it("falls back to a per-agent singleton class when absent", () => {
    expect(deriveClassKey("a1", null)).toBe("agent:a1");
    expect(deriveClassKey("a1", undefined)).toBe("agent:a1");
    expect(deriveClassKey("a1", "")).toBe("agent:a1");
    expect(deriveClassKey("a1", "   ")).toBe("agent:a1");
  });
});

describe("meetsStanding (#5459)", () => {
  const cfg = INDEPENDENCE_CONFIG;

  it("passes exactly at the thresholds (age and contributions inclusive)", () => {
    expect(meetsStanding(cfg.minAccountAgeDays, cfg.minAcceptedContributions)).toBe(true);
    expect(meetsStanding(cfg.minAccountAgeDays + 100, cfg.minAcceptedContributions + 5)).toBe(true);
  });

  it("fails below either threshold", () => {
    expect(meetsStanding(cfg.minAccountAgeDays - 0.01, cfg.minAcceptedContributions)).toBe(false);
    expect(meetsStanding(cfg.minAccountAgeDays, cfg.minAcceptedContributions - 1)).toBe(false);
    expect(meetsStanding(0, 0)).toBe(false);
  });

  it("coerces Postgres string counts and fails closed on garbage", () => {
    expect(meetsStanding("30", "5")).toBe(true);
    expect(meetsStanding(null, 5)).toBe(false);
    expect(meetsStanding(30, undefined)).toBe(false);
    expect(meetsStanding("not-a-number", 5)).toBe(false);
  });
});

describe("usesClassCounting — the grandfather boundary (#5459)", () => {
  const cutoffMs = Date.parse(INDEPENDENCE_CONFIG.grandfatherCutoff);

  it("topics created strictly before the cutoff keep legacy counting", () => {
    expect(usesClassCounting(new Date(cutoffMs - 1).toISOString())).toBe(false);
    expect(usesClassCounting("2020-01-01T00:00:00Z")).toBe(false);
  });

  it("topics created exactly at the cutoff use class counting", () => {
    expect(usesClassCounting(new Date(cutoffMs).toISOString())).toBe(true);
  });

  it("topics created after the cutoff use class counting", () => {
    expect(usesClassCounting(new Date(cutoffMs + 1).toISOString())).toBe(true);
    expect(usesClassCounting("2027-01-01T00:00:00Z")).toBe(true);
  });

  it("parses the Postgres TIMESTAMPTZ text form", () => {
    expect(usesClassCounting("2026-09-01 00:00:00+00")).toBe(true);
    expect(usesClassCounting("2026-08-01 00:00:00+00")).toBe(false);
  });

  it("fails toward legacy on missing or unparseable created_at", () => {
    expect(usesClassCounting(null)).toBe(false);
    expect(usesClassCounting(undefined)).toBe(false);
    expect(usesClassCounting("")).toBe(false);
    expect(usesClassCounting("not a timestamp")).toBe(false);
  });
});

describe("tallyVotes — legacy mode (grandfathered topics, pre-#5459 rule)", () => {
  it("counts every approve/reject vote raw — including the proposer's own", () => {
    const proposerClassKeys = new Set(["agent:proposer"]);
    const result = tallyVotes(
      [
        vote("proposer", "approve"),
        vote("a1", "approve", { standingEligible: false }),
        vote("a2", "approve"),
        vote("a3", "reject"),
      ],
      { mode: "legacy", proposerClassKeys }
    );
    expect(result.approvals).toBe(3);
    expect(result.rejections).toBe(1);
    expect(result.countedApprovals).toBe(3); // proposer + 2 = the old hole
    expect(result.countedRejections).toBe(1);
    expect(result.votes.filter((v) => v.counted)).toHaveLength(4);
  });

  it("need_info never counts in either mode", () => {
    const result = tallyVotes([vote("a1", "need_info")], { mode: "legacy" });
    expect(result.needInfo).toBe(1);
    expect(result.countedApprovals).toBe(0);
    expect(result.votes[0].counted).toBe(false);
    expect(result.votes[0].countedReason).toBe("need_info");
  });
});

describe("tallyVotes — class-v1 mode (#5459)", () => {
  it("self-approve is gone: the proposer's vote never counts toward its own proposal", () => {
    const proposerClassKeys = new Set(["agent:proposer"]);
    const result = tallyVotes(
      [vote("proposer", "approve"), vote("a1", "approve"), vote("a2", "approve")],
      { mode: "class-v1", proposerClassKeys }
    );
    // proposer + 2 others is NOT quorum-3 any more: only 2 count.
    expect(result.approvals).toBe(3); // raw count unchanged (wire additivity)
    expect(result.countedApprovals).toBe(2);
    const proposerVote = result.votes.find((v) => v.agentId === "proposer")!;
    expect(proposerVote.counted).toBe(false);
    expect(proposerVote.countedReason).toBe("proposer-class");
  });

  it("proposer's whole CLASS is excluded, not just the proposer's key", () => {
    const proposerClassKeys = new Set(["domain:operator.example"]);
    const result = tallyVotes(
      [
        vote("sock-puppet", "approve", { classKey: "domain:operator.example" }),
        vote("a1", "approve"),
      ],
      { mode: "class-v1", proposerClassKeys }
    );
    expect(result.countedApprovals).toBe(1);
    expect(result.votes[0].countedReason).toBe("proposer-class");
  });

  it("allowSelfApproval=true (spec §5 per-policy escape hatch) lets the proposer's class count", () => {
    const proposerClassKeys = new Set(["agent:proposer"]);
    const result = tallyVotes(
      [vote("proposer", "approve"), vote("a1", "approve")],
      { mode: "class-v1", proposerClassKeys, allowSelfApproval: true }
    );
    expect(result.countedApprovals).toBe(2);
  });

  it("class collapse: two agents sharing a class count ONCE toward quorum", () => {
    const result = tallyVotes(
      [
        vote("a1", "approve", { classKey: "domain:same.example" }),
        vote("a2", "approve", { classKey: "domain:same.example" }),
        vote("a3", "approve"),
      ],
      { mode: "class-v1" }
    );
    expect(result.approvals).toBe(3);
    expect(result.countedApprovals).toBe(2);
    // The collapsed vote stays recorded and visible.
    const collapsed = result.votes.filter((v) => v.countedReason === "class-collapsed");
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].agentId).toBe("a2");
  });

  it("standing gate: young / zero-contribution votes are recorded but not counted", () => {
    const result = tallyVotes(
      [vote("newborn", "approve", { standingEligible: false }), vote("a1", "approve")],
      { mode: "class-v1" }
    );
    expect(result.approvals).toBe(2);
    expect(result.countedApprovals).toBe(1);
    const gated = result.votes.find((v) => v.agentId === "newborn")!;
    expect(gated.counted).toBe(false);
    expect(gated.countedReason).toBe("standing");
  });

  it("rejections count symmetrically under the same class rules", () => {
    const proposerClassKeys = new Set(["agent:proposer"]);
    const result = tallyVotes(
      [
        vote("proposer", "reject"),
        vote("a1", "reject", { classKey: "domain:same.example" }),
        vote("a2", "reject", { classKey: "domain:same.example" }),
        vote("a3", "reject", { standingEligible: false }),
        vote("a4", "reject"),
      ],
      { mode: "class-v1", proposerClassKeys }
    );
    expect(result.rejections).toBe(5);
    // proposer excluded, same-class pair collapses to 1, a3 lacks standing → 2.
    expect(result.countedRejections).toBe(2);
  });

  it("approve and reject classes are tracked independently", () => {
    const result = tallyVotes(
      [
        vote("a1", "approve", { classKey: "domain:x.example" }),
        vote("a2", "reject", { classKey: "domain:x.example" }),
      ],
      { mode: "class-v1" }
    );
    expect(result.countedApprovals).toBe(1);
    expect(result.countedRejections).toBe(1);
  });

  it("counted totals are order-independent", () => {
    const votes = [
      vote("a1", "approve", { classKey: "domain:same.example" }),
      vote("a2", "approve", { classKey: "domain:same.example" }),
      vote("a3", "approve"),
      vote("a4", "approve", { standingEligible: false }),
    ];
    const forward = tallyVotes(votes, { mode: "class-v1" });
    const backward = tallyVotes([...votes].reverse(), { mode: "class-v1" });
    expect(forward.countedApprovals).toBe(backward.countedApprovals);
    expect(forward.approvals).toBe(backward.approvals);
  });
});
