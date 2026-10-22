/**
 * #1160 Round 3 — Validator unit tests.
 *
 * Focus is the new `applicability_spotcheck` type (blind_predict +
 * review_existing). We sanity-check the existing three validators too so
 * refactors that break their contracts fail fast.
 */
import { describe, it, expect } from "vitest";
import {
  validate,
  validateScrape,
  validateQaSpotCheck,
  validateDependencyProposal,
  scoreBlindPredict,
  WORK_REWARDS,
  APPLICABILITY_SPOTCHECK_REVIEW_CREDITS,
  type ValidatorDb,
} from "./validators";

const HEX64 = "a".repeat(64);

describe("validateScrape", () => {
  it("rejects when required fields are missing", () => {
    const r = validateScrape({ sourceUrl: "https://x" });
    expect(r.accept).toBe(false);
  });

  it("rejects malformed payloadHash", () => {
    const r = validateScrape({
      sourceUrl: "https://x",
      payloadHash: "not-hex",
      expectedSectionId: "s1",
      content: "s1 contents",
    });
    expect(r.accept).toBe(false);
    expect(r.notes).toMatch(/sha256/);
  });

  it("rejects when content doesn't reference expectedSectionId", () => {
    const r = validateScrape({
      sourceUrl: "https://x",
      payloadHash: HEX64,
      expectedSectionId: "s1",
      content: "unrelated body",
    });
    expect(r.accept).toBe(false);
  });

  it("accepts with 5 credits", () => {
    const r = validateScrape({
      sourceUrl: "https://x",
      payloadHash: HEX64,
      expectedSectionId: "s1",
      content: "preamble mentioning s1 inline",
    });
    expect(r.accept).toBe(true);
    expect(r.credits).toBe(WORK_REWARDS.scrape);
  });
});

describe("validateQaSpotCheck", () => {
  it("rejects short rationales", () => {
    const r = validateQaSpotCheck({ topicId: "t1", decision: "approve", rationale: "short" });
    expect(r.accept).toBe(false);
  });
  it("accepts with 2 credits", () => {
    const r = validateQaSpotCheck({
      topicId: "t1",
      decision: "reject",
      rationale: "This topic is not well-defined and conflates two separate obligations A and B.",
    });
    expect(r.accept).toBe(true);
    expect(r.credits).toBe(WORK_REWARDS.qa_spot_check);
  });
});

describe("validateDependencyProposal", () => {
  it("defers credits", () => {
    const r = validateDependencyProposal({
      topicId: "a",
      dependsOn: "b",
      relationship: "builds_on",
      proposalId: "p1",
    });
    expect(r.accept).toBe(true);
    expect(r.defer).toBe(true);
    expect(r.credits).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// #1160 Round 3 — applicability_spotcheck
// -----------------------------------------------------------------------------

describe("scoreBlindPredict", () => {
  it("returns F1=1 when both sides are empty", () => {
    const r = scoreBlindPredict([], []);
    expect(r.f1).toBe(1);
  });
  it("returns F1=1 on exact match", () => {
    const r = scoreBlindPredict(["s1", "s2"], [
      makeMatch("s1", 0.9),
      makeMatch("s2", 0.8),
    ]);
    expect(r.f1).toBe(1);
  });
  it("ignores canonical matches below minConfidence", () => {
    const r = scoreBlindPredict([], [makeMatch("s1", 0.1)]);
    expect(r.canonicalIds).toHaveLength(0);
    expect(r.f1).toBe(1);
  });
  it("falls in partial-credit band on half-match", () => {
    const r = scoreBlindPredict(["s1", "s2"], [
      makeMatch("s1", 0.9),
      makeMatch("s3", 0.9),
    ]);
    expect(r.f1).toBeCloseTo(0.5, 2);
  });
});

function makeMatch(id: string, confidence: number) {
  return {
    scenarioId: id,
    title: id,
    confidence,
    matchedPredicates: [],
    missingPredicates: [],
    conflictingPredicates: [],
  };
}

const DEFAULT_SCENARIOS = [
  {
    id: "s:au-privacy",
    title: "AU Privacy",
    predicates: { country_of_operation: "AU", handles_personal_information: true },
  },
  {
    id: "s:au-whs",
    title: "AU WHS",
    predicates: { country_of_operation: "AU", has_workers: true },
  },
];

function makeDb(overrides: Partial<Record<string, Record<string, unknown>[]>> = {}): ValidatorDb {
  return {
    async execute(input) {
      const sql = typeof input === "string" ? input : input.sql;
      for (const key of Object.keys(overrides)) {
        if (sql.includes(key)) {
          return { rows: overrides[key]! };
        }
      }
      return { rows: [] };
    },
  };
}

describe("validateApplicabilitySpotCheck — blind_predict", () => {
  it("rejects missing predicates", async () => {
    const r = await validate(
      "applicability_spotcheck",
      { mode: "blind_predict", predictedScenarioIds: [], rationale: "x".repeat(100) },
      { db: makeDb(), listScenarios: async () => DEFAULT_SCENARIOS },
    );
    expect(r.accept).toBe(false);
  });

  it("rejects short rationale", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "blind_predict",
        predicates: { country_of_operation: "AU", handles_personal_information: true },
        predictedScenarioIds: ["s:au-privacy"],
        rationale: "short",
      },
      { db: makeDb(), listScenarios: async () => DEFAULT_SCENARIOS },
    );
    expect(r.accept).toBe(false);
  });

  it("rejects when agent predicted nothing but canonical has a match", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "blind_predict",
        predicates: { country_of_operation: "AU", handles_personal_information: true },
        predictedScenarioIds: [],
        rationale: "x".repeat(100),
      },
      { db: makeDb(), listScenarios: async () => DEFAULT_SCENARIOS },
    );
    expect(r.accept).toBe(false);
  });

  it("accepts a perfect blind_predict with 3 credits", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "blind_predict",
        predicates: { country_of_operation: "AU", handles_personal_information: true },
        predictedScenarioIds: ["s:au-privacy"],
        rationale: "The AU privacy scenario fires because country_of_operation=AU and the agent handles PII.",
      },
      { db: makeDb(), listScenarios: async () => DEFAULT_SCENARIOS },
    );
    expect(r.accept).toBe(true);
    expect(r.credits).toBe(WORK_REWARDS.applicability_spotcheck);
    expect(r.defer).toBe(false);
  });
});

describe("validateApplicabilitySpotCheck — review_existing", () => {
  const longRationale = "This is a sufficiently long rationale that clears the 120 character bar required by the review_existing validator for this type of work.";

  it("rejects unknown scenarioId", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "review_existing",
        scenarioId: "s:unknown",
        rationale: longRationale,
        findings: [{ action: "confirm", edgeId: "e1", reason: "this edge is correct because of X and Y" }],
      },
      { db: makeDb() },
    );
    expect(r.accept).toBe(false);
    expect(r.notes).toMatch(/not found/);
  });

  it("rejects when every finding is a confirm with < 40 char reason", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "review_existing",
        scenarioId: "s:au-privacy",
        rationale: longRationale,
        findings: [{ action: "confirm", edgeId: "e1", reason: "too short" }],
      },
      {
        db: makeDb({
          "FROM scenarios WHERE id = ?": [{ one: 1 }],
          "FROM scenario_applies_when": [{ id: "e1", topic_id: "t1", legislation_id: null }],
        }),
      },
    );
    expect(r.accept).toBe(false);
  });

  it("accepts confirms-only with 1 credit each capped at 3", async () => {
    const edges = [
      { id: "e1", topic_id: "t1", legislation_id: null },
      { id: "e2", topic_id: "t2", legislation_id: null },
      { id: "e3", topic_id: "t3", legislation_id: null },
      { id: "e4", topic_id: "t4", legislation_id: null },
    ];
    const confirm = (id: string) => ({
      action: "confirm",
      edgeId: id,
      reason: "This edge correctly ties the scenario to its governing topic because of A, B, and C reasons.",
    });
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "review_existing",
        scenarioId: "s:au-privacy",
        rationale: longRationale,
        findings: [confirm("e1"), confirm("e2"), confirm("e3"), confirm("e4")],
      },
      {
        db: makeDb({
          "FROM scenarios WHERE id = ?": [{ one: 1 }],
          "FROM scenario_applies_when": edges,
        }),
      },
    );
    expect(r.accept).toBe(true);
    expect(r.defer).toBe(false);
    expect(r.credits).toBe(3);
    expect(r.defects ?? []).toHaveLength(0);
  });

  it("emits a defect row and defers credits on reject finding", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "review_existing",
        scenarioId: "s:au-privacy",
        rationale: longRationale,
        findings: [
          {
            action: "reject",
            edgeId: "e1",
            reason: "This topic does not actually govern AU privacy — it covers banking secrecy only.",
          },
        ],
      },
      {
        db: makeDb({
          "FROM scenarios WHERE id = ?": [{ one: 1 }],
          "FROM scenario_applies_when": [{ id: "e1", topic_id: "t1", legislation_id: null }],
        }),
      },
    );
    expect(r.accept).toBe(true);
    expect(r.defer).toBe(true);
    expect(r.defects ?? []).toHaveLength(1);
    expect(r.defects?.[0].findingKind).toBe("reject");
    expect(r.credits).toBeLessThanOrEqual(APPLICABILITY_SPOTCHECK_REVIEW_CREDITS);
  });

  it("rejects missing-finding with unknown target", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "review_existing",
        scenarioId: "s:au-privacy",
        rationale: longRationale,
        findings: [
          {
            action: "missing",
            targetKind: "topic",
            targetId: "t-does-not-exist",
            reason: "This topic should be linked because it governs AU privacy and is not yet in the graph.",
          },
        ],
      },
      {
        db: makeDb({
          "FROM scenarios WHERE id = ?": [{ one: 1 }],
          "FROM scenario_applies_when": [],
          "FROM topics WHERE id = ?": [],
        }),
      },
    );
    expect(r.accept).toBe(false);
    expect(r.notes).toMatch(/not found/);
  });

  it("rejects missing-finding when edge already exists", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "review_existing",
        scenarioId: "s:au-privacy",
        rationale: longRationale,
        findings: [
          {
            action: "missing",
            targetKind: "topic",
            targetId: "t1",
            reason: "Claims t1 is missing — but t1 is already linked via edge e1.",
          },
        ],
      },
      {
        db: makeDb({
          "FROM scenarios WHERE id = ?": [{ one: 1 }],
          "FROM scenario_applies_when": [{ id: "e1", topic_id: "t1", legislation_id: null }],
          "FROM topics WHERE id = ?": [{ one: 1 }],
        }),
      },
    );
    expect(r.accept).toBe(false);
    expect(r.notes).toMatch(/already linked/);
  });

  it("accepts missing-finding with valid target and defers 3 credits", async () => {
    const r = await validate(
      "applicability_spotcheck",
      {
        mode: "review_existing",
        scenarioId: "s:au-privacy",
        rationale: longRationale,
        findings: [
          {
            action: "missing",
            targetKind: "legislation",
            targetId: "au/act-1988-privacy",
            reason: "This Act directly governs personal information and must be linked to the AU privacy scenario.",
          },
        ],
      },
      {
        db: makeDb({
          "FROM scenarios WHERE id = ?": [{ one: 1 }],
          "FROM scenario_applies_when": [],
          "FROM legislation_docs WHERE id = ?": [{ one: 1 }],
        }),
      },
    );
    expect(r.accept).toBe(true);
    expect(r.defer).toBe(true);
    expect(r.defects?.[0]).toMatchObject({
      findingKind: "missing",
      targetKind: "legislation",
      targetId: "au/act-1988-privacy",
      potentialCredits: 3,
    });
  });
});

describe("validate dispatcher", () => {
  it("rejects unknown work_type", async () => {
    const r = await validate("bogus", {});
    expect(r.accept).toBe(false);
  });
  it("requires ctx for applicability_spotcheck", async () => {
    const r = await validate("applicability_spotcheck", { mode: "blind_predict" });
    expect(r.accept).toBe(false);
    expect(r.notes).toMatch(/validator context/);
  });
});
