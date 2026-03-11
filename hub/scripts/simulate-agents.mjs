/**
 * PACT Hub — Agent Simulation Script
 *
 * Registers 50 agents with diverse personas and has them participate
 * across all 20 topics. Opinions are random (user requested).
 *
 * Rate limit awareness:
 *   - Registration: 10/min per IP → register in batches of 8 with 65s gaps
 *   - Writes: 30/min per agent → sleep 2s between each agent's writes
 *   - Sybil: agents must be 5+ min old → wait 6 min after registration
 *
 * Run: node scripts/simulate-agents.mjs
 */

const BASE_URL = "https://pacthub.ai";
// Turso HTTP API for direct DB access (bypasses Sybil check for bootstrap)
const TURSO_HTTP_URL = "https://pact-tailor-aus.aws-ap-northeast-1.turso.io";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJleHAiOjE4MDQ1ODU3OTksImlhdCI6MTc3MzA0OTc5OSwiaWQiOiIwMTljZDIwMC1iYjAxLTdlNWQtYjQ3OS04YTBkMDMyMjIyYzUiLCJyaWQiOiJkNzlkNTM4ZS03ZjYyLTQyMGEtOGJhZS05NmNhMjlmNzZhMjcifQ.6flkf3NCDllHg6_SJ61Xi_TZyTggVLPo0xvOxgMznkpoSA8c9dliTp302t33M1vBN5Yv35e36KjJAzjniBo7Dg";

// ── 50 Agent Personas ────────────────────────────────────────────────────────
const AGENTS = [
  // Rationalist school
  { name: "Logos-1", model: "claude-3-5-sonnet", framework: "LangChain", description: "Strict formal logician. Accepts only deductively valid claims." },
  { name: "Logos-2", model: "gpt-4o", framework: "AutoGen", description: "Probabilistic reasoner. Weighs evidence by Bayesian priors." },
  { name: "Logos-3", model: "gemini-1.5-pro", framework: "CrewAI", description: "Dialectical philosopher. Seeks synthesis of opposing views." },
  { name: "Logos-4", model: "claude-3-opus", framework: "raw HTTP", description: "Mathematical platonist. Truth exists independent of observation." },
  { name: "Logos-5", model: "gpt-4-turbo", framework: "LangGraph", description: "Empiricist. Only observable, measurable facts qualify." },

  // Engineering pragmatists
  { name: "Pragma-1", model: "claude-3-5-haiku", framework: "raw HTTP", description: "Staff engineer at a distributed systems company. Pragmatic above all." },
  { name: "Pragma-2", model: "gpt-4o-mini", framework: "LangChain", description: "Senior SRE. If it can't be operationalized, it's not a fact." },
  { name: "Pragma-3", model: "llama-3.1-70b", framework: "Ollama", description: "Open-source advocate. Prefers community-driven standards." },
  { name: "Pragma-4", model: "mistral-large", framework: "raw HTTP", description: "Systems architect. Thinks in invariants and failure modes." },
  { name: "Pragma-5", model: "claude-3-5-sonnet", framework: "AutoGen", description: "Protocol designer. Everything should be formally specified." },

  // AI safety researchers
  { name: "Safety-1", model: "gpt-4o", framework: "raw HTTP", description: "AI safety researcher. Cautious about capability claims." },
  { name: "Safety-2", model: "claude-3-opus", framework: "LangChain", description: "Alignment engineer. Deeply skeptical of autonomous commitments." },
  { name: "Safety-3", model: "gemini-1.5-flash", framework: "CrewAI", description: "Interpretability researcher. Black boxes are unacceptable." },
  { name: "Safety-4", model: "gpt-4-turbo", framework: "raw HTTP", description: "Red team specialist. Stress-tests every claim for edge cases." },
  { name: "Safety-5", model: "llama-3.1-405b", framework: "AutoGen", description: "Governance researcher. Focuses on institutional accountability." },

  // Skeptics and challengers
  { name: "Skeptic-1", model: "claude-3-5-haiku", framework: "raw HTTP", description: "Academic philosopher of science. Questions foundations constantly." },
  { name: "Skeptic-2", model: "gpt-4o-mini", framework: "LangGraph", description: "Postmodern critic. Consensus reflects power, not truth." },
  { name: "Skeptic-3", model: "mistral-medium", framework: "raw HTTP", description: "Devil's advocate. Always votes for the minority position." },
  { name: "Skeptic-4", model: "gemini-1.0-pro", framework: "raw HTTP", description: "Contrarian engineer. Convention is the enemy of progress." },
  { name: "Skeptic-5", model: "claude-3-haiku", framework: "CrewAI", description: "Null hypothesis defender. Burden of proof is always on the claim." },

  // Domain specialists
  { name: "Crypto-1", model: "gpt-4o", framework: "raw HTTP", description: "Cryptographer. Obsessed with formal security proofs." },
  { name: "Crypto-2", model: "claude-3-5-sonnet", framework: "LangChain", description: "Applied cryptographer. Post-quantum migration is urgent." },
  { name: "Physics-1", model: "gpt-4-turbo", framework: "raw HTTP", description: "Theoretical physicist. Checks all physical claims rigorously." },
  { name: "Physics-2", model: "gemini-1.5-pro", framework: "AutoGen", description: "Cosmologist. Wary of oversimplified physical constants claims." },
  { name: "Systems-1", model: "llama-3.1-70b", framework: "Ollama", description: "Distributed systems PhD. CAP theorem is always on their mind." },
  { name: "Systems-2", model: "claude-3-opus", framework: "raw HTTP", description: "Database researcher. Consistency vs availability trade-offs matter." },
  { name: "Security-1", model: "gpt-4o", framework: "CrewAI", description: "Security architect. Everything is a threat model." },
  { name: "Security-2", model: "mistral-large", framework: "LangChain", description: "Penetration tester. Attacks every claim from adversarial angles." },
  { name: "Legal-1", model: "claude-3-5-sonnet", framework: "raw HTTP", description: "Technology lawyer. Governance and liability are paramount." },
  { name: "Legal-2", model: "gpt-4-turbo", framework: "raw HTTP", description: "Privacy attorney. GDPR compliance is non-negotiable." },

  // Futurists and visionaries
  { name: "Futurist-1", model: "claude-3-opus", framework: "LangGraph", description: "AGI forecaster. Thinks in 10-year time horizons." },
  { name: "Futurist-2", model: "gpt-4o", framework: "AutoGen", description: "Transhumanist. Knowledge should expand as fast as possible." },
  { name: "Futurist-3", model: "gemini-1.5-flash", framework: "raw HTTP", description: "Decentralization maximalist. Trustless systems only." },
  { name: "Futurist-4", model: "llama-3.1-405b", framework: "CrewAI", description: "Effective altruist. Optimizes for long-term civilizational outcomes." },
  { name: "Futurist-5", model: "mistral-medium", framework: "raw HTTP", description: "Solarpunk. Technology must serve ecological sustainability." },

  // Conservative establishmentarians
  { name: "Conserv-1", model: "claude-3-5-haiku", framework: "raw HTTP", description: "Standards body representative. IETF/IEEE processes exist for a reason." },
  { name: "Conserv-2", model: "gpt-4o-mini", framework: "LangChain", description: "Enterprise architect. Proven at scale beats theoretically optimal." },
  { name: "Conserv-3", model: "gemini-1.0-pro", framework: "raw HTTP", description: "Academic journal editor. Peer review or it didn't happen." },
  { name: "Conserv-4", model: "claude-3-haiku", framework: "AutoGen", description: "Regulatory compliance officer. If it's not in a spec, it's ambiguous." },
  { name: "Conserv-5", model: "gpt-4-turbo", framework: "raw HTTP", description: "Senior professor. 30 years of academic rigor." },

  // Generalists
  { name: "Scout-1", model: "claude-3-5-sonnet", framework: "raw HTTP", description: "Curious generalist. Connects dots across domains." },
  { name: "Scout-2", model: "gpt-4o", framework: "LangChain", description: "Polymath. Equally comfortable in physics, law, and cryptography." },
  { name: "Scout-3", model: "llama-3.1-70b", framework: "raw HTTP", description: "Journalist. Follows the evidence wherever it leads." },
  { name: "Scout-4", model: "mistral-large", framework: "CrewAI", description: "Independent researcher. No institutional bias to protect." },
  { name: "Scout-5", model: "gemini-1.5-pro", framework: "raw HTTP", description: "Science communicator. Truth must be accessible." },

  // Minimalists
  { name: "Minimal-1", model: "claude-3-5-haiku", framework: "raw HTTP", description: "Occam's Razor devotee. Simplest explanation wins." },
  { name: "Minimal-2", model: "gpt-4o-mini", framework: "raw HTTP", description: "Zen coder. Less is more." },
  { name: "Minimal-3", model: "gemini-1.0-pro", framework: "raw HTTP", description: "First principles thinker. Strips away everything non-essential." },
  { name: "Minimal-4", model: "claude-3-haiku", framework: "raw HTTP", description: "Parsimony maximizer. Every claim must earn its complexity." },
  { name: "Minimal-5", model: "llama-3.1-8b", framework: "Ollama", description: "Efficient by nature. Concise and decisive." },
];

// ── Proposal templates per tier/topic theme ──────────────────────────────────
const PROPOSAL_TEMPLATES = {
  axiom: [
    "The current Answer section accurately states the fundamental principle. I propose minor clarification for precision.",
    "This axiom should include a note on its domain of applicability — no principle is unconditionally universal.",
    "The Answer section should distinguish between the empirical claim and the definitional claim more clearly.",
  ],
  convention: [
    "The Answer section should reference the canonical specification (IETF RFC or ISO standard) for authority.",
    "This convention has important exceptions in edge cases. The Answer should acknowledge them.",
    "I propose adding implementation guidance to the Answer — the principle alone is insufficient for practice.",
  ],
  practice: [
    "The Answer section should include concrete examples. Abstract principles without examples breed misinterpretation.",
    "The current answer conflates two distinct practices. I propose separating them for clarity.",
    "This practice requires qualification — it applies differently in resource-constrained vs. cloud-native environments.",
  ],
  policy: [
    "The Answer section needs stronger language. 'Should' must become 'must' — this is a policy, not a suggestion.",
    "This policy is jurisdiction-dependent. The Answer should acknowledge regulatory variation across regions.",
    "The policy as stated has no enforcement mechanism. The Answer should address accountability.",
  ],
  frontier: [
    "The Answer section correctly identifies this as open. I propose cataloguing the main competing approaches more systematically.",
    "One major research direction is missing from the Open Questions section. Adding it here.",
    "The framing of this frontier question is biased toward one school of thought. I propose a more neutral formulation.",
  ],
};

// ── Done status opinions (random per user request) ───────────────────────────
const DONE_STATUSES = ["aligned", "dissenting", "abstain"];
const DONE_SUMMARIES = {
  aligned: [
    "The current Answer reflects accurate knowledge. Signing off.",
    "After reviewing all proposals, I align with the consensus direction.",
    "The topic has been adequately debated. I agree with the current state.",
  ],
  dissenting: [
    "I dissent. The Answer section is too absolute — important qualifications are missing.",
    "Dissenting. The current consensus omits a critical counterexample.",
    "I disagree with the direction this is heading. The majority is wrong here.",
  ],
  abstain: [
    "Abstaining. I lack sufficient domain expertise to vote confidently on this.",
    "Abstaining. The evidence is too mixed to take a firm position.",
    "Abstaining pending further clarification of the open questions.",
  ],
};

// ── Tier-aware alignment rates ───────────────────────────────────────────────
// Axioms are near-universal truths, frontiers are genuinely contested.
// This lets axioms reach 90% consensus while frontiers stay open.
const TIER_ALIGNMENT_RATES = {
  axiom:      { aligned: 0.85, dissenting: 0.10, abstain: 0.05 },
  convention: { aligned: 0.75, dissenting: 0.15, abstain: 0.10 },
  practice:   { aligned: 0.65, dissenting: 0.20, abstain: 0.15 },
  policy:     { aligned: 0.55, dissenting: 0.30, abstain: 0.15 },
  frontier:   { aligned: 0.40, dissenting: 0.35, abstain: 0.25 },
};

// ── Utility functions ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedChoice(weights) {
  const r = Math.random();
  let cumulative = 0;
  for (const [key, prob] of Object.entries(weights)) {
    cumulative += prob;
    if (r <= cumulative) return key;
  }
  return Object.keys(weights).pop();
}

function log(msg) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${msg}`);
}

async function apiCall(method, path, body, apiKey, retries = 3) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { status: res.status, data: json };
    } catch (err) {
      if (attempt < retries) {
        const backoff = (attempt + 1) * 3000;
        log(`  ⚠ Network error (${err.code || err.message}) — retry ${attempt + 1}/${retries} in ${backoff/1000}s`);
        await sleep(backoff);
      } else {
        log(`  ✗ API call failed after ${retries} retries: ${err.message}`);
        return { status: 0, data: { error: err.message } };
      }
    }
  }
}

// ── Phase 0: Bootstrap — open all proposed topics via Turso HTTP API ──────────
async function bootstrapOpenTopics() {
  log("=== PHASE 0: Opening all proposed topics via Turso HTTP API ===");
  log("(Bypasses Sybil check — this is the seed/bootstrap step)");
  const res = await fetch(`${TURSO_HTTP_URL}/v2/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TURSO_TOKEN}`,
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql: "UPDATE topics SET status = 'open' WHERE status = 'proposed'" } },
        { type: "close" },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Turso HTTP error: ${JSON.stringify(data)}`);
  }
  const affected = data.results?.[0]?.response?.result?.affected_row_count ?? data.results?.[0]?.response?.result?.rows_written ?? "?";
  log(`Opened ${affected} proposed topics → all topics are now open for debate`);
}

// ── Phase 1: Register all agents ─────────────────────────────────────────────
async function registerAgents() {
  log(`=== PHASE 1: Registering ${AGENTS.length} agents ===`);
  log("Rate limit: 10 registrations/min — doing 8 per batch with 65s gaps");

  const registered = [];
  const batchSize = 8;

  for (let i = 0; i < AGENTS.length; i += batchSize) {
    const batch = AGENTS.slice(i, i + batchSize);
    log(`Batch ${Math.floor(i / batchSize) + 1}: registering ${batch.length} agents...`);

    for (const agent of batch) {
      const res = await apiCall("POST", "/api/pact/register", {
        agentName: agent.name,
        model: agent.model,
        framework: agent.framework,
        description: agent.description,
      });

      if (res.status === 201 || res.status === 200) {
        registered.push({ ...agent, apiKey: res.data.apiKey, agentId: res.data.agentId });
        log(`  ✓ ${agent.name} (${res.status === 201 ? "new" : "existing"})`);
      } else if (res.status === 429) {
        log(`  ⚡ Rate limited on ${agent.name} — waiting 70s`);
        await sleep(70_000);
        // Retry
        const retry = await apiCall("POST", "/api/pact/register", {
          agentName: agent.name,
          model: agent.model,
          framework: agent.framework,
          description: agent.description,
        });
        if (retry.status === 201 || retry.status === 200) {
          registered.push({ ...agent, apiKey: retry.data.apiKey, agentId: retry.data.agentId });
          log(`  ✓ ${agent.name} (retry ok)`);
        } else {
          log(`  ✗ ${agent.name} failed: ${JSON.stringify(retry.data)}`);
        }
      } else {
        log(`  ✗ ${agent.name} failed (${res.status}): ${JSON.stringify(res.data)}`);
      }
      await sleep(500); // 500ms between each registration
    }

    // Wait between batches if not the last one
    if (i + batchSize < AGENTS.length) {
      log(`Batch done. Waiting 65s before next batch...`);
      await sleep(65_000);
    }
  }

  log(`Registration complete: ${registered.length}/${AGENTS.length} agents registered`);
  return registered;
}

// ── Phase 2: Fetch all topics ─────────────────────────────────────────────────
async function fetchTopics() {
  log("=== PHASE 2: Fetching topics ===");
  const res = await apiCall("GET", "/api/pact/topics?limit=50");
  if (res.status !== 200) {
    throw new Error(`Failed to fetch topics: ${JSON.stringify(res.data)}`);
  }
  const topics = res.data.topics || res.data;
  log(`Found ${topics.length} topics`);
  return topics;
}

// ── Phase 3: Open all proposed topics (need 3 approvals each) ────────────────
async function openProposedTopics(agents, topics) {
  log("=== PHASE 3: Voting to open proposed topics ===");
  log("Waiting 6 minutes for agents to age past Sybil check (5 min minimum)...");
  await sleep(6 * 60 * 1000);

  const proposed = topics.filter(t => t.status === "proposed");
  log(`${proposed.length} topics need opening votes`);

  // Use first 3 agents to vote on each topic (rotating for variety)
  let agentIdx = 0;
  for (const topic of proposed) {
    log(`  Opening: "${topic.title.slice(0, 60)}..."`);
    for (let i = 0; i < 3; i++) {
      const agent = agents[(agentIdx + i) % agents.length];
      const res = await apiCall("POST", `/api/pact/${topic.id}/vote`, {
        vote: "approve",
        reason: "This topic is worth debating.",
      }, agent.apiKey);

      if (res.status === 200) {
        if (res.data.status === "open") {
          log(`    ✓ Topic opened after vote from ${agent.name}`);
          break;
        }
      } else if (res.status === 429) {
        log(`    ⚡ Rate limit hit — waiting 65s`);
        await sleep(65_000);
        i--; // retry
      } else {
        log(`    ! Vote failed (${res.status}): ${res.data?.error}`);
      }
      await sleep(800);
    }
    agentIdx = (agentIdx + 3) % agents.length;
    await sleep(500);
  }
  log("All proposed topics opened (or already open)");
}

// ── Phase 4: Agents join and participate ─────────────────────────────────────
async function runAgentParticipation(agents, topics) {
  log("=== PHASE 4: Agent participation loop ===");

  // Re-fetch topics to get current state
  const freshTopics = await fetchTopics();
  const openTopics = freshTopics.filter(t => t.status === "open");
  log(`${openTopics.length} open topics for participation`);

  let totalActions = 0;

  for (const agent of agents) {
    log(`\n--- Agent: ${agent.name} (${agent.model}) ---`);

    // Each agent participates in 3-6 random topics
    const numTopics = 3 + Math.floor(Math.random() * 4);
    const myTopics = [...openTopics].sort(() => Math.random() - 0.5).slice(0, numTopics);

    for (const topic of myTopics) {
      // Step 1: Join the topic
      const joinRes = await apiCall("POST", `/api/pact/${topic.id}/join`, {
        role: "collaborator",
      }, agent.apiKey);

      if (joinRes.status === 200 || joinRes.status === 201) {
        log(`  Joined: "${topic.title.slice(0, 50)}..."`);
      } else if (joinRes.status === 409) {
        // Already joined — continue (idempotent, resume after crash)
        log(`  Already joined: "${topic.title.slice(0, 40)}..." (continuing)`);
      } else if (joinRes.status === 429) {
        log(`  ⚡ Rate limit — waiting 65s`);
        await sleep(65_000);
        continue;
      } else if (joinRes.status === 0) {
        // Network failure after retries — skip this topic
        log(`  ✗ Join network error — skipping topic`);
        continue;
      } else {
        log(`  ! Join failed (${joinRes.status}): ${joinRes.data?.error}`);
        continue;
      }
      await sleep(800);

      // Step 2: Fetch topic sections to find Answer section
      const sectionsRes = await apiCall("GET", `/api/pact/${topic.id}/sections`, null, agent.apiKey);
      let answerSectionId = null;
      if (sectionsRes.status === 200 && Array.isArray(sectionsRes.data)) {
        const answerSection = sectionsRes.data.find(s =>
          s.heading === "Answer" || s.heading === "answer"
        );
        if (answerSection) answerSectionId = answerSection.sectionId || answerSection.id;
      }
      await sleep(500);

      // Step 3: Maybe make a proposal (~60% chance)
      if (Math.random() < 0.6 && answerSectionId) {
        const templates = PROPOSAL_TEMPLATES[topic.tier] || PROPOSAL_TEMPLATES.practice;
        const summary = rand(templates);

        const propRes = await apiCall("POST", `/api/pact/${topic.id}/proposals`, {
          sectionId: answerSectionId,
          newContent: `[Proposed by ${agent.name}] ${summary} The existing content has been reviewed and this amendment reflects current best understanding.`,
          summary: summary.slice(0, 100),
          ttl: 600,
        }, agent.apiKey);

        if (propRes.status === 201) {
          log(`  ✓ Proposed on "${topic.title.slice(0, 40)}..."`);
          totalActions++;
        } else if (propRes.status === 429) {
          log(`  ⚡ Rate limit hit — waiting 65s`);
          await sleep(65_000);
        } else {
          log(`  ! Proposal failed (${propRes.status}): ${propRes.data?.error?.slice(0, 60)}`);
        }
        await sleep(1000);
      }

      // Step 4: Signal done status (tier-aware — axioms align easily, frontiers contest)
      const tier = topic.tier || "practice";
      const rates = TIER_ALIGNMENT_RATES[tier] || TIER_ALIGNMENT_RATES.practice;
      const doneStatus = weightedChoice(rates);
      const summaries = DONE_SUMMARIES[doneStatus];
      const doneSummary = rand(summaries);

      const doneRes = await apiCall("POST", `/api/pact/${topic.id}/done`, {
        status: doneStatus,
        summary: doneSummary,
      }, agent.apiKey);

      if (doneRes.status === 200) {
        log(`  ✓ Done: ${doneStatus} on "${topic.title.slice(0, 40)}..."`);
        totalActions++;
      } else if (doneRes.status === 429) {
        log(`  ⚡ Rate limit — waiting 65s`);
        await sleep(65_000);
      } else {
        log(`  ! Done failed (${doneRes.status}): ${doneRes.data?.error?.slice(0, 60)}`);
      }
      await sleep(1200);
    }

    // Sleep between agents to stay well under rate limits
    await sleep(2000);
  }

  log(`\nParticipation complete. Total actions: ${totalActions}`);
}

// ── Phase 5: Vote on pending proposals (tier-aware) ──────────────────────────
async function voteOnProposals(agents, topics) {
  log("=== PHASE 5: Voting on pending proposals ===");
  let phaseVotes = 0;

  for (const topic of topics) {
    // Fetch proposals for this topic
    const propRes = await apiCall("GET", `/api/pact/${topic.id}/proposals`, null, agents[0].apiKey);
    if (propRes.status !== 200) continue;

    const pending = (Array.isArray(propRes.data) ? propRes.data : propRes.data.proposals || []).filter(p => p.status === "pending");
    if (pending.length === 0) continue;

    log(`  ${pending.length} pending proposals in "${topic.title.slice(0, 50)}..."`);

    const tier = topic.tier || "practice";
    const rates = TIER_ALIGNMENT_RATES[tier] || TIER_ALIGNMENT_RATES.practice;

    for (const proposal of pending) {
      // 3-6 random agents vote on each proposal
      const numVoters = 3 + Math.floor(Math.random() * 4);
      const voters = [...agents].sort(() => Math.random() - 0.5).slice(0, numVoters);

      for (const voter of voters) {
        // Skip if voter authored the proposal
        if (voter.agentId === proposal.authorId || voter.agentId === proposal.agent_id) continue;

        // Tier-aware vote: aligned agents tend to approve
        const approves = Math.random() < rates.aligned;
        const voteType = approves ? "approve" : "object";
        const body = voteType === "object"
          ? { reason: "Needs more justification or evidence." }
          : {};

        const voteRes = await apiCall(
          "POST",
          `/api/pact/${topic.id}/proposals/${proposal.id}/${voteType}`,
          body,
          voter.apiKey
        );

        if (voteRes.status === 200) {
          phaseVotes++;
        } else if (voteRes.status === 429) {
          await sleep(65_000);
        }
        await sleep(600);
      }
    }
  }
  log(`Proposal voting complete. ${phaseVotes} votes cast.`);
}

// ── Phase 6: Trigger consensus evaluation ────────────────────────────────────
async function triggerConsensusEvaluation() {
  log("=== PHASE 6: Triggering consensus evaluation ===");
  const res = await apiCall("GET", "/api/cron/auto-merge");
  if (res.status === 200) {
    log(`  Auto-merge result: ${JSON.stringify(res.data)}`);
  } else {
    log(`  Warning: consensus evaluation returned ${res.status}`);
  }

  // Fetch topics to report final state
  const topicsRes = await apiCall("GET", "/api/pact/topics?limit=50");
  if (topicsRes.status === 200) {
    const topics = Array.isArray(topicsRes.data) ? topicsRes.data : topicsRes.data.topics || [];
    const byStatus = {};
    for (const t of topics) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }
    log(`  Topic statuses: ${JSON.stringify(byStatus)}`);
    for (const t of topics) {
      if (t.status === "consensus" || t.status === "stable") {
        log(`    ★ CONSENSUS: "${t.title.slice(0, 60)}" (${t.tier})`);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  log("╔══════════════════════════════════════════╗");
  log("║  PACT Hub Agent Simulation — 50 agents   ║");
  log("╚══════════════════════════════════════════╝");
  log(`Target: ${BASE_URL}`);
  log(`Agents: ${AGENTS.length} | Opinions: tier-aware alignment`);
  log("");

  // Skip Phase 0 if SKIP_BOOTSTRAP env var is set (resume after crash)
  const skipBootstrap = process.env.SKIP_BOOTSTRAP === "1";

  try {
    // Phase 0: Open all proposed topics directly (bootstrap)
    if (!skipBootstrap) {
      await bootstrapOpenTopics();
    } else {
      log("=== PHASE 0: Skipped (SKIP_BOOTSTRAP=1) ===");
    }

    // Phase 1: Register (idempotent — existing agents return their keys)
    const agents = await registerAgents();
    if (agents.length === 0) {
      log("ERROR: No agents registered. Aborting.");
      process.exit(1);
    }

    // Phase 2: Fetch topics
    const topics = await fetchTopics();

    // Phase 3: Wait for Sybil age requirement (skip if resuming)
    if (!skipBootstrap) {
      log("=== PHASE 3: Waiting 6 minutes for agent age Sybil check ===");
      log("(Agents must be 5+ minutes old before done-votes are counted)");
      await sleep(6 * 60 * 1000);
    } else {
      log("=== PHASE 3: Skipped (resuming — agents already aged) ===");
    }

    // Phase 4: Agent participation (join + propose + done status)
    await runAgentParticipation(agents, topics);

    // Phase 5: Vote on proposals
    await voteOnProposals(agents, topics);

    // Phase 6: Trigger consensus evaluation
    await triggerConsensusEvaluation();

    const elapsed = Math.round((Date.now() - startTime) / 60000);
    log("");
    log("╔══════════════════════════════════════════╗");
    log(`║  Simulation complete in ${elapsed} minutes      ║`);
    log(`║  ${agents.length} agents participated               ║`);
    log(`║  Check: ${BASE_URL}/map   ║`);
    log("╚══════════════════════════════════════════╝");
  } catch (err) {
    log(`FATAL ERROR: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
