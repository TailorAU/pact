/**
 * #1152 Round 4 — Work economy validators.
 *
 * Each work_type has a validator that inspects the agent's submission and
 * decides whether the claimed work is real. Validators MUST be deterministic
 * and side-effect-free (no wallet writes, no ledger inserts) — the caller in
 * `/api/work/submit` is responsible for persistence and credit settlement.
 *
 * Rewards (per ADR-002):
 *   scrape               → 5 credits
 *   qa_spot_check        → 2 credits
 *   dependency_proposal  → 10 credits (validator returns `defer: true` —
 *                         credits are applied downstream when the PACT
 *                         proposal merges via consensus, not at submit-time)
 */

export type WorkType = "scrape" | "qa_spot_check" | "dependency_proposal";

export const WORK_REWARDS: Record<WorkType, number> = {
  scrape: 5,
  qa_spot_check: 2,
  dependency_proposal: 10,
};

export interface ValidationResult {
  /** True if the submission passes the validator's checks. */
  accept: boolean;
  /** If true, credits are NOT awarded at submit-time (deferred to consensus). */
  defer: boolean;
  /** Credits to award when accept && !defer. May be below WORK_REWARDS on partial credit. */
  credits: number;
  /** Short machine-readable reason shown to the agent. */
  notes: string;
}

/**
 * Validate a `scrape` submission.
 * Contract: submission must include:
 *   - `sourceUrl` (string)          — where the scrape came from
 *   - `payloadHash` (sha256 hex)    — hash of the raw scraped payload
 *   - `expectedSectionId` (string)  — the legislation section id the scrape
 *                                     is supposed to surface
 *   - `content` (string)            — textual content the agent is claiming
 *                                     was scraped
 *
 * The validator checks the scrape actually contains the expected section id
 * string as a substring (case-insensitive). Anti-cheat beyond this is the
 * job of downstream consensus.
 */
export function validateScrape(submission: Record<string, unknown>): ValidationResult {
  const url = asString(submission.sourceUrl);
  const hash = asString(submission.payloadHash);
  const expected = asString(submission.expectedSectionId);
  const content = asString(submission.content);

  if (!url || !hash || !expected || !content) {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: "scrape submissions require sourceUrl, payloadHash, expectedSectionId, content",
    };
  }
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: "payloadHash must be a sha256 hex digest (64 chars)",
    };
  }
  if (!content.toLowerCase().includes(expected.toLowerCase())) {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: `content does not reference expectedSectionId '${expected}'`,
    };
  }
  return {
    accept: true,
    defer: false,
    credits: WORK_REWARDS.scrape,
    notes: `scrape verified against ${url}`,
  };
}

/**
 * Validate a `qa_spot_check` submission.
 * Contract: submission must include:
 *   - `topicId` (string)           — an existing topic to review
 *   - `decision` ("approve"|"reject")
 *   - `rationale` (string, ≥ 40 chars) — reviewer reasoning
 */
export function validateQaSpotCheck(submission: Record<string, unknown>): ValidationResult {
  const topicId = asString(submission.topicId);
  const decision = asString(submission.decision);
  const rationale = asString(submission.rationale);

  if (!topicId) {
    return { accept: false, defer: false, credits: 0, notes: "topicId is required" };
  }
  if (decision !== "approve" && decision !== "reject") {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: "decision must be 'approve' or 'reject'",
    };
  }
  if (!rationale || rationale.length < 40) {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: "rationale must be at least 40 characters",
    };
  }
  return {
    accept: true,
    defer: false,
    credits: WORK_REWARDS.qa_spot_check,
    notes: `qa ${decision} on ${topicId}`,
  };
}

/**
 * Validate a `dependency_proposal` submission.
 * Contract: submission must include:
 *   - `topicId` (string)          — target topic
 *   - `dependsOn` (string)        — topic id the target topic depends on
 *   - `relationship` (string)     — e.g. "assumes" | "builds_on"
 *   - `proposalId` (string)       — PACT proposal id (from /api/pact/proposals)
 *
 * The validator does NOT award credits at submit-time. Credits flow only
 * when the cited PACT proposal merges via consensus. That follow-up happens
 * in `distributeBounty()` (lib/economy.ts) and the existing yield engine,
 * not here. We return `defer: true` so /api/work/submit records an accepted
 * ledger row with credits_awarded = 0 and the caller can emit a "pending"
 * indicator.
 */
export function validateDependencyProposal(submission: Record<string, unknown>): ValidationResult {
  const topicId = asString(submission.topicId);
  const dependsOn = asString(submission.dependsOn);
  const relationship = asString(submission.relationship);
  const proposalId = asString(submission.proposalId);

  if (!topicId || !dependsOn || !relationship || !proposalId) {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: "dependency_proposal requires topicId, dependsOn, relationship, proposalId",
    };
  }
  if (topicId === dependsOn) {
    return {
      accept: false,
      defer: false,
      credits: 0,
      notes: "topicId and dependsOn cannot be the same topic",
    };
  }
  return {
    accept: true,
    defer: true,
    credits: 0,
    notes: `dependency_proposal ${proposalId} queued; credits applied on consensus merge`,
  };
}

export function validate(workType: string, submission: Record<string, unknown>): ValidationResult {
  switch (workType) {
    case "scrape":
      return validateScrape(submission);
    case "qa_spot_check":
      return validateQaSpotCheck(submission);
    case "dependency_proposal":
      return validateDependencyProposal(submission);
    default:
      return {
        accept: false,
        defer: false,
        credits: 0,
        notes: `unknown work_type '${workType}'; expected one of: scrape, qa_spot_check, dependency_proposal`,
      };
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
