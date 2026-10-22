/**
 * #5459 — Independence classes v1: class-counted quorums for the pre-open
 * topic-proposal tally (and legislation ingest quorum), per the epistemics
 * extension's independence requirements (TailorAU/pact PR #60,
 * docs/extensions/epistemics.md §8): every quorum counts INDEPENDENT
 * principals, never keys. Two votes must not both count when they trace to
 * the same principal.
 *
 * v1 derivation (pragmatic, honest, upgradeable — documented as v1):
 *
 *   - An agent's counting class is its verified handler-domain
 *     (`agents.independence_class`, set only by a mandate-bearing /
 *     verified registration flow — NEVER client-writable today) when one
 *     exists; otherwise a per-agent singleton class (`agent:<id>`).
 *   - A singleton class is weighted by earned standing: the vote COUNTS
 *     toward quorum only when the account is at least
 *     `minAccountAgeDays` old AND has at least
 *     `minAcceptedContributions` accepted contributions (merged proposals
 *     + non-starter credit receipts via the existing credits machinery).
 *   - Votes from distinct agents sharing a class count ONCE toward quorum
 *     (max one per class per vote kind). Non-counting votes are still
 *     recorded and visible — the wire additively gains `counted` +
 *     class fields on vote rows.
 *   - The proposer's class is excluded from its own proposal's count
 *     (spec §5 `allowSelfApproval`, default false). Rejections count
 *     symmetrically under the same class rules.
 *
 * Grandfathering: topics created before GRANDFATHER_CUTOFF keep the OLD
 * raw counting so in-flight public contributions aren't stranded.
 * Everything created at/after the cutoff uses class counting. The switch
 * is the pure function `usesClassCounting` below — test the boundary.
 *
 * Everything in this module is pure (no DB, no clock reads unless
 * injected) so the counting rule is directly unit-testable.
 */

export type CountingMode = "class-v1" | "legacy";

export type NonCountingReason =
  | "need_info"        // need_info never counts toward approve/reject quorums
  | "standing"         // singleton class without earned standing
  | "proposer-class"   // vote from the proposer's own independence class
  | "class-collapsed"; // another vote from the same class already counted

export interface IndependenceConfig {
  /** Extension revision of this counting rule. */
  version: 1;
  /** Minimum account age (days) for a singleton-class vote to count. */
  minAccountAgeDays: number;
  /** Minimum accepted contributions for a singleton-class vote to count. */
  minAcceptedContributions: number;
  /** Spec §5 — proposer self-approval policy. Defaults false. */
  allowSelfApproval: boolean;
  /**
   * Grandfather cutoff (ISO 8601, UTC). Topics with created_at strictly
   * before this instant tally under legacy raw counting forever.
   */
  grandfatherCutoff: string;
}

/**
 * The single config object (issue #5459). Values are also surfaced
 * additively on the public stats endpoint via publicIndependenceProfile()
 * per the extension's advertisement section.
 */
export const INDEPENDENCE_CONFIG: IndependenceConfig = {
  version: 1,
  minAccountAgeDays: 7,
  minAcceptedContributions: 2,
  allowSelfApproval: false,
  grandfatherCutoff: "2026-08-28T00:00:00Z",
};

const CUTOFF_MS = Date.parse(INDEPENDENCE_CONFIG.grandfatherCutoff);

/**
 * Derive an agent's counting-class key. A verified handler-domain
 * (agents.independence_class) collapses all its agents into one class;
 * otherwise the agent is its own singleton class.
 */
export function deriveClassKey(
  agentId: string,
  independenceClass: string | null | undefined
): string {
  const domain = typeof independenceClass === "string" ? independenceClass.trim().toLowerCase() : "";
  return domain.length > 0 ? `domain:${domain}` : `agent:${agentId}`;
}

/** Earned-standing gate for singleton classes (v1). */
export function meetsStanding(
  accountAgeDays: number | string | null | undefined,
  acceptedContributions: number | string | null | undefined,
  cfg: IndependenceConfig = INDEPENDENCE_CONFIG
): boolean {
  const age = Number(accountAgeDays);
  const contributions = Number(acceptedContributions);
  if (!Number.isFinite(age) || !Number.isFinite(contributions)) return false;
  return age >= cfg.minAccountAgeDays && contributions >= cfg.minAcceptedContributions;
}

function parseTimestampMs(value: string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || value.length === 0) return NaN;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  // Postgres TIMESTAMPTZ text form ("2026-08-28 00:00:00+00") on stricter parsers.
  return Date.parse(value.replace(" ", "T"));
}

/**
 * The grandfather switch (pure). Topics whose created_at parses to an
 * instant at/after the cutoff use class counting; anything earlier — or
 * unparseable/missing (real rows always carry a NOT NULL created_at) —
 * stays on legacy counting. Fails toward legacy: grandfathering can only
 * ever keep old rules for old topics, never impose new rules on them.
 */
export function usesClassCounting(
  topicCreatedAt: string | Date | null | undefined,
  cfg: IndependenceConfig = INDEPENDENCE_CONFIG
): boolean {
  const t = parseTimestampMs(topicCreatedAt);
  if (Number.isNaN(t)) return false;
  const cutoff = cfg === INDEPENDENCE_CONFIG ? CUTOFF_MS : Date.parse(cfg.grandfatherCutoff);
  return t >= cutoff;
}

export interface TallyVote {
  agentId: string;
  /** approve | reject | need_info */
  voteType: string;
  /** deriveClassKey(agentId, independence_class) */
  classKey: string;
  /** meetsStanding(...) for the voting agent. */
  standingEligible: boolean;
}

export interface TalliedVote extends TallyVote {
  counted: boolean;
  countedReason: NonCountingReason | null;
}

export interface TallyResult {
  mode: CountingMode;
  /** Raw counts — legacy wire semantics, unchanged. */
  approvals: number;
  rejections: number;
  needInfo: number;
  /** Distinct-counting-class counts — what quorum satisfaction uses. */
  countedApprovals: number;
  countedRejections: number;
  votes: TalliedVote[];
}

/**
 * The tally. Input order matters only for WHICH vote in a collapsed class
 * carries counted=true (the first one); the counted totals are
 * order-independent (distinct classes).
 *
 * Legacy mode reproduces the pre-#5459 rule exactly: every approve/reject
 * vote counts (need_info never did), countedApprovals === approvals.
 */
export function tallyVotes(
  votes: readonly TallyVote[],
  opts: {
    mode: CountingMode;
    /** Counting classes of the topic's proposer(s) (role='creator'). */
    proposerClassKeys?: ReadonlySet<string>;
    allowSelfApproval?: boolean;
  }
): TallyResult {
  const proposerClasses = opts.proposerClassKeys ?? new Set<string>();
  const allowSelfApproval = opts.allowSelfApproval ?? INDEPENDENCE_CONFIG.allowSelfApproval;

  let approvals = 0;
  let rejections = 0;
  let needInfo = 0;
  const countedClasses: Record<"approve" | "reject", Set<string>> = {
    approve: new Set(),
    reject: new Set(),
  };
  const out: TalliedVote[] = [];

  for (const vote of votes) {
    if (vote.voteType === "approve") approvals++;
    else if (vote.voteType === "reject") rejections++;
    else if (vote.voteType === "need_info") needInfo++;

    if (vote.voteType !== "approve" && vote.voteType !== "reject") {
      out.push({ ...vote, counted: false, countedReason: "need_info" });
      continue;
    }

    if (opts.mode === "legacy") {
      out.push({ ...vote, counted: true, countedReason: null });
      countedClasses[vote.voteType].add(vote.classKey);
      continue;
    }

    // class-v1 — symmetric for approve and reject.
    if (!allowSelfApproval && proposerClasses.has(vote.classKey)) {
      out.push({ ...vote, counted: false, countedReason: "proposer-class" });
      continue;
    }
    if (!vote.standingEligible) {
      out.push({ ...vote, counted: false, countedReason: "standing" });
      continue;
    }
    if (countedClasses[vote.voteType].has(vote.classKey)) {
      out.push({ ...vote, counted: false, countedReason: "class-collapsed" });
      continue;
    }
    countedClasses[vote.voteType].add(vote.classKey);
    out.push({ ...vote, counted: true, countedReason: null });
  }

  return {
    mode: opts.mode,
    approvals,
    rejections,
    needInfo,
    countedApprovals: opts.mode === "legacy" ? approvals : countedClasses.approve.size,
    countedRejections: opts.mode === "legacy" ? rejections : countedClasses.reject.size,
    votes: out,
  };
}

/**
 * Advertisement block for the public stats/profile surface (additive),
 * shaped after the epistemics extension's §9 profile advertisement:
 * advertised values MUST be the values actually enforced.
 */
export function publicIndependenceProfile() {
  return {
    extension: "au.tailor.pact/epistemics",
    independenceClasses: {
      version: INDEPENDENCE_CONFIG.version,
      counting: "class-v1",
      minAccountAgeDays: INDEPENDENCE_CONFIG.minAccountAgeDays,
      minAcceptedContributions: INDEPENDENCE_CONFIG.minAcceptedContributions,
      allowSelfApproval: INDEPENDENCE_CONFIG.allowSelfApproval,
      grandfatherCutoff: INDEPENDENCE_CONFIG.grandfatherCutoff,
    },
  };
}
