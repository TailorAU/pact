import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { request } from './api.js';

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
}

const server = new McpServer({
  name: 'PACT Protocol',
  version: '1.1.0',
});

// ── Agent Lifecycle ──────────────────────────────────────────────

server.tool(
  'pact_join',
  'Join a resource (document, transaction, topic) as a PACT agent. Required before any other operations.',
  {
    documentId: z.string().describe('Document ID'),
    agentName: z.string().describe('Agent display name'),
    role: z.string().optional().describe('Role: editor, reviewer, observer'),
    token: z.string().optional().describe('Invite token for BYOK join (no account needed)'),
  },
  async ({ documentId, agentName, role, token }) => {
    try {
      if (token) {
        const result = await request(`/api/pact/${documentId}/join-token`, {
          method: 'POST',
          body: JSON.stringify({ agentName, token }),
        });
        return jsonResult(result);
      }
      const body: Record<string, unknown> = { agentName };
      if (role) body.role = role;
      const result = await request(`/api/pact/${documentId}/join`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_leave',
  'Leave a document, unregistering as a PACT agent.',
  { documentId: z.string().describe('Document ID') },
  async ({ documentId }) => {
    try {
      await request(`/api/pact/${documentId}/leave`, { method: 'DELETE' });
      return jsonResult({ success: true });
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_agents',
  'List all agents registered on a document.',
  { documentId: z.string().describe('Document ID') },
  async ({ documentId }) => {
    try {
      const result = await request(`/api/pact/${documentId}/agents`);
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

// ── Intent-Constraint-Salience ───────────────────────────────────

server.tool(
  'pact_intent',
  'Declare intent for a section — what you plan to do.',
  {
    documentId: z.string().describe('Document ID'),
    sectionId: z.string().describe('Target section ID'),
    goal: z.string().describe('What you plan to do'),
    category: z.string().optional().describe('Intent category'),
    authorizationProof: z.record(z.unknown()).optional().describe('Optional §17.6 authorization_proof — proof-of-human-intent envelope. Pre-built by the hardware/biometric layer; the MCP just carries it.'),
  },
  async ({ documentId, sectionId, goal, category, authorizationProof }) => {
    try {
      const body: Record<string, unknown> = { sectionId, goal };
      if (category) body.category = category;
      if (authorizationProof) body.authorization_proof = authorizationProof;
      const result = await request(`/api/pact/${documentId}/intents`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_constrain',
  'Publish a constraint on a section — what must or must not happen.',
  {
    documentId: z.string().describe('Document ID'),
    sectionId: z.string().describe('Target section ID'),
    boundary: z.string().describe('What must or must not happen'),
    category: z.string().optional().describe('Constraint category'),
    authorizationProof: z.record(z.unknown()).optional().describe('Optional §17.6 authorization_proof envelope.'),
  },
  async ({ documentId, sectionId, boundary, category, authorizationProof }) => {
    try {
      const body: Record<string, unknown> = { sectionId, boundary };
      if (category) body.category = category;
      if (authorizationProof) body.authorization_proof = authorizationProof;
      const result = await request(`/api/pact/${documentId}/constraints`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_salience',
  'Set salience score for a section (0-10: how much you care).',
  {
    documentId: z.string().describe('Document ID'),
    sectionId: z.string().describe('Target section ID'),
    score: z.number().min(0).max(10).describe('Salience score (0-10)'),
  },
  async ({ documentId, sectionId, score }) => {
    try {
      await request(`/api/pact/${documentId}/salience`, {
        method: 'POST',
        body: JSON.stringify({ sectionId, score }),
      });
      return jsonResult({ section: sectionId, score });
    } catch (err) { return errorResult(err); }
  },
);

// ── Objection (silence = acceptance; only speak up to block) ─────

server.tool(
  'pact_object',
  'Object to a proposal — blocks auto-merge, forces renegotiation. Silence = acceptance; only call this when a proposal violates your constraints.',
  {
    documentId: z.string().describe('Document ID'),
    proposalId: z.string().describe('Proposal ID'),
    reason: z.string().describe('Why this violates your constraints'),
    authorizationProof: z.record(z.unknown()).optional().describe('Optional §17.6 authorization_proof envelope.'),
  },
  async ({ documentId, proposalId, reason, authorizationProof }) => {
    try {
      const body: Record<string, unknown> = { reason };
      if (authorizationProof) body.authorization_proof = authorizationProof;
      await request(`/api/pact/${documentId}/proposals/${proposalId}/object`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult({ status: 'objected', proposalId });
    } catch (err) { return errorResult(err); }
  },
);

// ── Polling & Events ─────────────────────────────────────────────

server.tool(
  'pact_poll',
  'Poll for new events since a cursor (stateless). Returns proposals, objections, escalations, and completions.',
  {
    documentId: z.string().describe('Document ID'),
    since: z.string().optional().describe('Cursor to poll from'),
    sectionId: z.string().optional().describe('Filter by section'),
    limit: z.number().optional().describe('Max events to return'),
  },
  async ({ documentId, since, sectionId, limit }) => {
    try {
      const params = new URLSearchParams();
      if (since) params.set('since', since);
      if (sectionId) params.set('sectionId', sectionId);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString() ? `?${params}` : '';
      const result = await request(`/api/pact/${documentId}/poll${qs}`);
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

// ── Completion ───────────────────────────────────────────────────

server.tool(
  'pact_done',
  'Signal that this agent has completed its work.',
  {
    documentId: z.string().describe('Document ID'),
    status: z.string().describe('Completion status: aligned, blocked, or withdrawn'),
    summary: z.string().optional().describe('Summary of what was accomplished'),
    authorizationProof: z.record(z.unknown()).optional().describe('Optional §17.6 authorization_proof envelope.'),
  },
  async ({ documentId, status, summary, authorizationProof }) => {
    try {
      const body: Record<string, unknown> = { status, summary };
      if (authorizationProof) body.authorization_proof = authorizationProof;
      const result = await request(`/api/pact/${documentId}/done`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

// ── Locking ──────────────────────────────────────────────────────

server.tool(
  'pact_lock',
  'Lock a section for exclusive coordination.',
  {
    documentId: z.string().describe('Document ID'),
    sectionId: z.string().describe('Section ID to lock'),
    ttlSeconds: z.number().optional().describe('Lock TTL in seconds'),
  },
  async ({ documentId, sectionId, ttlSeconds }) => {
    try {
      const body: Record<string, unknown> = {};
      if (ttlSeconds) body.ttlSeconds = ttlSeconds;
      const result = await request(`/api/pact/${documentId}/sections/${sectionId}/lock`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_unlock',
  'Unlock a section.',
  {
    documentId: z.string().describe('Document ID'),
    sectionId: z.string().describe('Section ID to unlock'),
  },
  async ({ documentId, sectionId }) => {
    try {
      await request(`/api/pact/${documentId}/sections/${sectionId}/lock`, { method: 'DELETE' });
      return jsonResult({ status: 'unlocked', sectionId });
    } catch (err) { return errorResult(err); }
  },
);

// ── Escalation ───────────────────────────────────────────────────

server.tool(
  'pact_escalate',
  'Escalate an issue to human reviewers. Use when agents cannot reach consensus.',
  {
    documentId: z.string().describe('Document ID'),
    message: z.string().describe('Reason for escalation'),
    sectionId: z.string().optional().describe('Relevant section ID'),
    authorizationProof: z.record(z.unknown()).optional().describe('Optional §17.6 authorization_proof envelope.'),
  },
  async ({ documentId, message, sectionId, authorizationProof }) => {
    try {
      const body: Record<string, unknown> = { message };
      if (sectionId) body.sectionId = sectionId;
      if (authorizationProof) body.authorization_proof = authorizationProof;
      await request(`/api/pact/${documentId}/escalate`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult({ status: 'escalated', documentId });
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_ask',
  'Ask a question of the human custodian — for clarifications PACT cannot resolve via agent consensus. Distinct from escalate: this is a targeted question, not a coordination breakdown.',
  {
    documentId: z.string().describe('Document ID'),
    question: z.string().describe('The question for the human'),
    sectionId: z.string().optional().describe('Relevant section ID'),
    context: z.string().optional().describe('Background context for the question'),
    timeoutSeconds: z.number().optional().describe('How long to wait for an answer (default 60)'),
    authorizationProof: z.record(z.unknown()).optional().describe('Optional §17.6 authorization_proof envelope.'),
  },
  async ({ documentId, question, sectionId, context, timeoutSeconds, authorizationProof }) => {
    try {
      const body: Record<string, unknown> = {
        question,
        sectionId: sectionId ?? null,
        context: context ?? null,
        timeoutSeconds: timeoutSeconds ?? 60,
      };
      if (authorizationProof) body.authorization_proof = authorizationProof;
      const result = await request(`/api/pact/${documentId}/ask-human`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

// ── Mediated Negotiation (§13) ───────────────────────────────────

server.tool(
  'pact_negotiate_list',
  'List active mediated negotiations on a document (§13 — structured multi-round exchanges facilitated by the Mediator).',
  { documentId: z.string().describe('Document ID') },
  async ({ documentId }) => {
    try {
      const result = await request(`/api/pact/${documentId}/negotiations`);
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_negotiate_position',
  'Submit this agent\'s position for the current round of a mediated negotiation. The Mediator synthesises positions across rounds (§13.5.3).',
  {
    documentId: z.string().describe('Document ID'),
    negotiationId: z.string().describe('Negotiation ID'),
    position: z.string().describe('This agent\'s position for the current round'),
    authorizationProof: z.record(z.unknown()).optional().describe('Optional §17.6 authorization_proof envelope.'),
  },
  async ({ documentId, negotiationId, position, authorizationProof }) => {
    try {
      const body: Record<string, unknown> = { position };
      if (authorizationProof) body.authorization_proof = authorizationProof;
      const result = await request(`/api/pact/${documentId}/negotiations/${negotiationId}/position`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'pact_negotiate_synthesis',
  'Get the Mediator\'s synthesis for the latest round of a negotiation — what positions have been received, and what the Mediator has surfaced to each party (subject to graduated-disclosure rules, §10.3 / §13.5.2).',
  {
    documentId: z.string().describe('Document ID'),
    negotiationId: z.string().describe('Negotiation ID'),
  },
  async ({ documentId, negotiationId }) => {
    try {
      const result = await request(`/api/pact/${documentId}/negotiations/${negotiationId}/synthesis`);
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

// ── Implementation profile (§15) ─────────────────────────────────

server.tool(
  'pact_profile',
  'Fetch a PACT server\'s implementation profile from /.well-known/pact.json (§15). Returns name, version, specVersion, conformanceLevel, resourceTypes, capabilities, retentionPolicy, endpoints. Optionally checks that conformanceLevel meets a minimum.',
  {
    serverUrl: z.string().describe('Base URL of the PACT server (e.g. https://tailor.au)'),
    minimumLevel: z.enum(['core', 'extended', 'authorization-required']).optional().describe('Optional minimum conformance level to assert'),
  },
  async ({ serverUrl, minimumLevel }) => {
    try {
      const base = serverUrl.replace(/\/+$/, '');
      const url = `${base}/.well-known/pact.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        return errorResult(new Error(`HTTP ${res.status} fetching ${url}`));
      }
      const profile = await res.json() as Record<string, unknown>;
      if (minimumLevel) {
        const rank: Record<string, number> = { core: 0, extended: 1, 'authorization-required': 2 };
        const got = typeof profile.conformanceLevel === 'string' ? rank[profile.conformanceLevel.toLowerCase()] : undefined;
        const need = rank[minimumLevel];
        const meets = got !== undefined && need !== undefined && got >= need;
        return jsonResult({ profile, meetsMinimum: meets, requestedMinimum: minimumLevel });
      }
      return jsonResult(profile);
    } catch (err) { return errorResult(err); }
  },
);

// ── Start ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('PACT MCP server failed to start:', err);
  process.exit(1);
});
