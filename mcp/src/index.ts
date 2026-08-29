import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { request } from './api.js';
import { mandateGuard, mandateServerOptions, type ToolResult } from './mandate.js';
import {
  loadSessions,
  loadManifestCache,
  saveManifestCache,
  manifestCacheAgeMs,
  updateSession,
  type CachedManifest,
} from './sessions.js';

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
}

/**
 * Spec §25.10 — client terminology boundary. Surfaced as MCP server
 * instructions so the calling model is told, up front and in-band, what the
 * states these tools return do and do not mean. Without it a model reading
 * `status: "auto-merged"` will happily paraphrase it to the user as "both
 * parties agreed and signed off".
 */
const PACT_BOUNDARY_INSTRUCTIONS = [
  'PACT coordinates agents over a shared resource. Every state these tools return is a PROTOCOL STATE.',
  '',
  'accepted, approved, auto-merged, merged, aligned, consensus_reached, commitment, Settled, Verified,',
  'Finalized, a done completion, a TTL expiring, and nobody objecting are protocol states ONLY. None of',
  'them is, by itself, an electronic signature, legal assent, proof of a person\'s identity or capacity,',
  'proof of authority to bind an organisation, or authority to perform an external or irreversible act.',
  '',
  'When reporting PACT state to a user or another system:',
  '  - Say auto-merged, aligned, merged, consensus reached, objected, or awaiting attestation.',
  '  - Never say signed, executed, agreed by <person>, or authorised by <person> for a state reached',
  '    without an explicit authorization_proof from that person.',
  '  - Describe silence as "no objection was raised within the TTL", never as consent.',
  '  - A merged contract or NDA is an ALIGNED DRAFT. It is not signed or executed.',
  '',
  'Silence, TTL expiry, consensus and your own votes never create a human attestation. If a request would',
  'move money, leave the system, or purport to bind someone, PACT fails closed and waits for an explicit,',
  'payload-bound human attestation — do not attempt to work around that, and do not report the effect as',
  'done. See spec/v2.3/SPECIFICATION.md §25 and §17.14.',
].join('\n');

const server = new McpServer(
  {
    name: 'PACT Protocol',
    version: '2.0.3',
  },
  // `instructions` carries the §25.10 terminology boundary to the calling
  // model. Spread preserves the mandate extension declaration: capabilities
  // declares ServerCapabilities.extensions["au.tailor.pact/mandate"] when
  // PACT_MANDATE_ENFORCEMENT is configured, and is absent otherwise (unchanged
  // behaviour). See src/mandate.ts and docs/v2-prep/rfc-mcp-mandate-extension.md.
  { instructions: PACT_BOUNDARY_INSTRUCTIONS, ...(mandateServerOptions() ?? {}) },
);

/**
 * Registration wrapper: every tool passes the au.tailor.pact/mandate gate
 * before its handler runs, and successful results are stamped with the
 * verification verdict in _meta. With PACT_MANDATE_ENFORCEMENT unset the
 * gate is a pass-through and behaviour is byte-identical to plain
 * tool().
 */
function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (args: z.objectOutputType<S, z.ZodTypeAny>, extra: unknown) => Promise<ToolResult>,
): void {
  server.tool(name, description, shape, (async (args: unknown, extra: unknown) => {
    const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
    const gate = mandateGuard(name, (args ?? {}) as Record<string, unknown>, meta);
    if (gate.block) return gate.block;
    const result = await handler(args as z.objectOutputType<S, z.ZodTypeAny>, extra);
    return gate.stamp(result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}

// ── Agent Lifecycle ──────────────────────────────────────────────

tool(
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

tool(
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

tool(
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

tool(
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

tool(
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

tool(
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

// ── Objection (silence = no protocol objection; only speak up to block) ─────

tool(
  'pact_object',
  'Object to a proposal — blocks auto-merge, forces renegotiation. Only call this when a proposal violates your ' +
    'constraints. Not objecting means no protocol objection was raised within the TTL (spec §25.3) — it is not ' +
    'consent, approval, or a signature by anyone, and it never creates a human attestation.',
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

tool(
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

tool(
  'pact_done',
  'Signal that this agent has completed its work. Reports a protocol state only: `aligned` means the agents ' +
    'converged on the text, NOT that anything was signed, executed, or legally accepted (spec §25.3, §25.8).',
  {
    documentId: z.string().describe('Document ID'),
    status: z
      .string()
      .describe(
        'Completion status: aligned, blocked, or withdrawn. Protocol states only — never report `signed` or `executed` here (§25.8).',
      ),
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

tool(
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

tool(
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

tool(
  'pact_escalate',
  'Escalate an issue to human reviewers. Use when agents cannot reach consensus.',
  {
    documentId: z.string().describe('Document ID'),
    message: z.string().describe('Reason for escalation'),
    sectionId: z.string().optional().describe('Relevant section ID'),
    disclosure_level: z.number().int().min(1).max(4).optional().describe(
      'Graduated disclosure level this escalation reveals (§10.3: 1 Constraint, 2 Category, 3 Reasoning, 4 Human). ' +
        'Guard-facing: checked against an active mandate\'s disclosure_ceiling (au.tailor.pact/mandate); not forwarded upstream.',
    ),
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

tool(
  'pact_ask',
  'Ask a question of the human custodian — for clarifications PACT cannot resolve via agent consensus. Distinct from escalate: this is a targeted question, not a coordination breakdown.',
  {
    documentId: z.string().describe('Document ID'),
    question: z.string().describe('The question for the human'),
    sectionId: z.string().optional().describe('Relevant section ID'),
    context: z.string().optional().describe('Background context for the question'),
    timeoutSeconds: z.number().optional().describe('How long to wait for an answer (default 60)'),
    disclosure_level: z.number().int().min(1).max(4).optional().describe(
      'Graduated disclosure level this question reveals (§10.3: 1 Constraint, 2 Category, 3 Reasoning, 4 Human). ' +
        'Guard-facing: checked against an active mandate\'s disclosure_ceiling (au.tailor.pact/mandate); not forwarded upstream.',
    ),
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

tool(
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

tool(
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

tool(
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

tool(
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

// ── Tier introspection (§15.5, v2.0.2+) ──────────────────────────

tool(
  'pact_tier_introspect',
  'Behaviourally probe a PACT server\'s advertised conformance tier (§15.5). Calls /api/pact/_probe/tier and reports which of the tier\'s required checks the server actually enforces. Use BEFORE extending cross-org trust to a counterparty: a self-asserted tier in /.well-known/pact.json is not behavioural conformance.',
  {
    serverUrl: z.string().describe('Base URL of the PACT server.'),
    advertisedTier: z.enum(['core', 'extended', 'authorization-required']).optional().describe('Tier to probe. Defaults to the tier the server self-advertises in /.well-known/pact.json.'),
    checks: z.array(z.string()).optional().describe('Specific checks to probe. Defaults to the v2.0.2 well-known set: tombstoned_principal_rejected, revoked_credential_rejected, did_web_ct_check, alg_whitelist_enforced, verifier_id_equality_enforced.'),
  },
  async ({ serverUrl, advertisedTier, checks }) => {
    try {
      const base = serverUrl.replace(/\/+$/, '');
      let tier = advertisedTier;
      if (!tier) {
        const profRes = await fetch(`${base}/.well-known/pact.json`, { signal: AbortSignal.timeout(15_000) });
        if (!profRes.ok) return errorResult(new Error(`HTTP ${profRes.status} fetching /.well-known/pact.json`));
        const profile = await profRes.json() as { conformanceLevel?: string };
        tier = (profile.conformanceLevel as 'core' | 'extended' | 'authorization-required' | undefined);
        if (!tier) return errorResult(new Error('profile missing conformanceLevel — supply advertisedTier'));
      }
      const probeId = 'mcp-probe-' + Math.random().toString(16).slice(2, 14);
      const requestedChecks = checks ?? [
        'tombstoned_principal_rejected',
        'revoked_credential_rejected',
        'did_web_ct_check',
        'alg_whitelist_enforced',
        'verifier_id_equality_enforced',
      ];
      const res = await fetch(`${base}/api/pact/_probe/tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probe_id: probeId, advertised_tier: tier, checks: requestedChecks }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return errorResult(new Error(`HTTP ${res.status} from /api/pact/_probe/tier — server may not expose the v2.0.2 tier probe`));
      const report = await res.json();
      return jsonResult(report);
    } catch (err) { return errorResult(err); }
  },
);

// ── Fabric Onboarding & Session Awareness (§4.4 / §6.5 / §15.6, v2.0.3) ─

tool(
  'pact_onboard',
  'Atomically onboard into a fabric (§15.6, v2.0.3). Use this instead of pact_join when the fabric requires declaring constraints up-front: the server either admits the caller WITH constraints recorded, or rejects with no membership created (no half-joined state).',
  {
    fabric_id: z.string().describe('Target fabric identifier.'),
    constraints: z.unknown().describe('Constraints array (or constraints object) to declare during onboarding.'),
    verifier_id: z.string().optional().describe('Optional verifier DID to bind the onboarding handshake (mirrors §17 nonce binding).'),
  },
  async ({ fabric_id, constraints, verifier_id }) => {
    try {
      const body: Record<string, unknown> = { constraints };
      if (verifier_id) body.verifier_id = verifier_id;
      const result = await request<Record<string, unknown>>(`/api/pact/${encodeURIComponent(fabric_id)}/_onboard`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const resolvedId = (result?.fabric_id ?? result?.fabricId ?? fabric_id) as string;
      const role = typeof result?.role === 'string' ? result.role : undefined;
      await updateSession(resolvedId, {
        joinedAt: new Date().toISOString(),
        role,
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_status',
  'Snapshot of a fabric (§4.4, v2.0.3): phase, members, latest event id, pending obligations. If fabric_id is omitted, returns a local-state summary of every fabric this agent is in (no network call).',
  {
    fabric_id: z.string().optional().describe('Fabric to snapshot. Omit to return the local cross-fabric summary.'),
  },
  async ({ fabric_id }) => {
    try {
      if (fabric_id) {
        const result = await request(`/api/pact/${encodeURIComponent(fabric_id)}/_status`);
        return jsonResult(result);
      }
      const sessions = loadSessions();
      return jsonResult({ source: 'local', fabrics: sessions });
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_manifest',
  'Fetch the caller-scoped active-session manifest for a fabric (§4.4, v2.0.3) — members, phase, obligations, and any data this caller is authorised to see. Result is cached under ~/.pact/manifest-<id>.json for pact_session_announce to read.',
  {
    fabric_id: z.string().describe('Target fabric identifier.'),
  },
  async ({ fabric_id }) => {
    try {
      const result = await request(`/api/pact/${encodeURIComponent(fabric_id)}/manifest`);
      const cached = saveManifestCache(fabric_id, result);
      await updateSession(fabric_id, { lastManifestFetch: cached.fetchedAt });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_transcript',
  'Fetch the event log (transcript) for a fabric since an optional event id (§4.4, v2.0.3). With mark_read=true, also POSTs to /mark-read to acknowledge the printed range.',
  {
    fabric_id: z.string().describe('Target fabric identifier.'),
    since_event_id: z.string().optional().describe('Only return events after this event id.'),
    mark_read: z.boolean().optional().describe('If true, ack the returned range via POST /mark-read after fetching.'),
  },
  async ({ fabric_id, since_event_id, mark_read }) => {
    try {
      const params = new URLSearchParams();
      if (since_event_id) params.set('since', since_event_id);
      const qs = params.toString() ? `?${params}` : '';
      const result = await request<Record<string, unknown> | unknown[]>(`/api/pact/${encodeURIComponent(fabric_id)}/transcript${qs}`);

      const events = Array.isArray(result)
        ? result
        : ((result as { events?: unknown[]; changes?: unknown[] })?.events ??
           (result as { changes?: unknown[] })?.changes ?? []);

      const eventIdOf = (e: unknown): string | undefined => {
        if (!e || typeof e !== 'object') return undefined;
        const r = e as Record<string, unknown>;
        return (r.event_id ?? r.eventId ?? r.id) as string | undefined;
      };

      let lastId: string | undefined;
      if (Array.isArray(events) && events.length > 0) {
        lastId = eventIdOf(events[events.length - 1]);
      }
      const explicitLast = !Array.isArray(result)
        ? ((result as Record<string, unknown>).latest_event_id ?? (result as Record<string, unknown>).latestEventId) as string | undefined
        : undefined;
      const highWater = explicitLast ?? lastId;
      if (highWater) {
        await updateSession(fabric_id, { lastReadEventId: highWater });
      }

      if (mark_read && Array.isArray(events) && events.length > 0) {
        const first = eventIdOf(events[0]);
        const last = eventIdOf(events[events.length - 1]);
        const markBody: Record<string, unknown> = {};
        if (first) markBody.from_event_id = first;
        if (last) markBody.to_event_id = last;
        await request(`/api/pact/${encodeURIComponent(fabric_id)}/mark-read`, {
          method: 'POST',
          body: JSON.stringify(markBody),
        });
      }

      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_heartbeat',
  'Fire a one-shot heartbeat for a fabric (§4.4, v2.0.3) — tells the server this agent is still attending. Optionally signals that attention is required (e.g. waiting on a human, blocked on another agent). Not a daemon; one ping per call.',
  {
    fabric_id: z.string().describe('Target fabric identifier.'),
    attention_required: z.boolean().optional().describe('Signal that this agent is currently blocked / needs attention.'),
  },
  async ({ fabric_id, attention_required }) => {
    try {
      const body: Record<string, unknown> = { source: 'mcp', oneShot: true };
      if (attention_required !== undefined) body.attention_required = attention_required;
      const result = await request(`/api/pact/${encodeURIComponent(fabric_id)}/_heartbeat`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result ?? { ok: true });
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_mark_read',
  'Acknowledge a transcript range on the server (§4.4, v2.0.3). Equivalent to the pact_transcript mark_read flag but standalone, e.g. when ack-ing events that were fetched out-of-band.',
  {
    fabric_id: z.string().describe('Target fabric identifier.'),
    from_event_id: z.string().describe('First event id in the range to ack (inclusive).'),
    to_event_id: z.string().describe('Last event id in the range to ack (inclusive).'),
  },
  async ({ fabric_id, from_event_id, to_event_id }) => {
    try {
      const result = await request(`/api/pact/${encodeURIComponent(fabric_id)}/mark-read`, {
        method: 'POST',
        body: JSON.stringify({ from_event_id, to_event_id }),
      });
      await updateSession(fabric_id, { lastReadEventId: to_event_id });
      return jsonResult(result ?? { ok: true });
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_session_announce',
  'COGNITIVE-LAYER HOOK (v2.0.3 §4.4). Returns a structured "you are currently in N fabrics" payload designed for the calling LLM to prepend to its working context — so it does not forget about active fabrics and their pending obligations. By default this is offline: it only reads ~/.pact/sessions.json + cached manifests. Pass refresh_manifests=true to re-fetch each fabric\'s manifest live before announcing.',
  {
    refresh_manifests: z.boolean().optional().describe('If true, re-fetch every fabric\'s manifest before building the announcement. Default: false (offline).'),
  },
  async ({ refresh_manifests }) => {
    try {
      const sessions = loadSessions();
      const fabricIds = Object.keys(sessions);

      interface Announce {
        fabricId: string;
        role?: string;
        phase?: string;
        joinedAt?: string;
        lastReadEventId?: string;
        manifestSource: 'fresh' | 'cache' | 'none';
        manifestAgeSeconds?: number;
        pendingObligations: unknown[];
      }

      const fabrics: Announce[] = [];

      for (const id of fabricIds) {
        let cached: CachedManifest | null = loadManifestCache(id);
        let source: 'fresh' | 'cache' | 'none' = cached ? 'cache' : 'none';

        if (refresh_manifests) {
          try {
            const m = await request(`/api/pact/${encodeURIComponent(id)}/manifest`);
            cached = saveManifestCache(id, m);
            await updateSession(id, { lastManifestFetch: cached.fetchedAt });
            source = 'fresh';
          } catch {
            // Fall through to cached or none.
          }
        }

        const m = (cached?.manifest ?? {}) as Record<string, unknown>;
        const phase = typeof m.phase === 'string' ? m.phase : undefined;
        const obligationsRaw =
          (m.pending_obligations ?? m.pendingObligations ?? m.obligations) as unknown;
        const obligations = Array.isArray(obligationsRaw) ? obligationsRaw : [];
        const role =
          sessions[id].role ??
          (typeof m.caller_role === 'string' ? (m.caller_role as string) : undefined) ??
          (typeof m.callerRole === 'string' ? (m.callerRole as string) : undefined);

        const ageMs = manifestCacheAgeMs(cached);
        fabrics.push({
          fabricId: id,
          role,
          phase,
          joinedAt: sessions[id].joinedAt,
          lastReadEventId: sessions[id].lastReadEventId,
          manifestSource: source,
          manifestAgeSeconds: ageMs !== null ? Math.round(ageMs / 1000) : undefined,
          pendingObligations: obligations,
        });
      }

      const totalPending = fabrics.reduce((n, f) => n + f.pendingObligations.length, 0);
      const lines: string[] = [];
      if (fabrics.length === 0) {
        lines.push('You are not currently in any PACT fabrics.');
      } else {
        lines.push(`You are currently in ${fabrics.length} PACT fabric${fabrics.length === 1 ? '' : 's'}: ${fabrics.map((f) => f.fabricId).join(', ')}.`);
        if (totalPending > 0) {
          lines.push(`${totalPending} pending obligation${totalPending === 1 ? '' : 's'} across these fabrics.`);
        }
        for (const f of fabrics) {
          const role = f.role ? ` as ${f.role}` : '';
          const phase = f.phase ? `, phase=${f.phase}` : '';
          lines.push(`  • ${f.fabricId}${role}${phase} — ${f.pendingObligations.length} pending`);
        }
      }

      return jsonResult({
        prelude: lines.join('\n'),
        fabricCount: fabrics.length,
        totalPendingObligations: totalPending,
        fabrics,
        source: refresh_manifests ? 'network' : 'local-cache',
      });
    } catch (err) { return errorResult(err); }
  },
);

// ── Matters (v2.2 draft — docs/v2-prep/rfc-matters-multi-fabric.md) ──

tool(
  'pact_matter_open',
  'Open a multi-fabric "deal-room" Matter. Caller becomes the owner. Matters group N peer fabrics under a shared participant set + typed side-channel + cross-fabric manifest. v2.2 draft.',
  {
    name: z.string().describe('Human-readable Matter name (e.g., "Project Atlas acquisition")'),
    opened_by_display: z.string().optional().describe("Caller's display name within the Matter"),
  },
  async ({ name, opened_by_display }) => {
    try {
      const body: Record<string, unknown> = { name };
      if (opened_by_display) body.opened_by_display = opened_by_display;
      const result = await request('/api/pact/matters', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_list',
  'List all Matters known to the server (summary view).',
  {},
  async () => {
    try {
      const result = await request('/api/pact/matters');
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_show',
  "Show a Matter's caller-visible state.",
  { matterId: z.string().describe('Matter ID (e.g., mtr_xxx)') },
  async ({ matterId }) => {
    try {
      const result = await request(`/api/pact/matters/${encodeURIComponent(matterId)}`);
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_add_member',
  'Add a member to a Matter (owner-only). Matter membership is eligibility, NOT automatic fabric enrollment — members still need to join attached fabrics individually.',
  {
    matterId: z.string().describe('Matter ID'),
    principal_id: z.string().describe('Member principal_id (e.g., did:web:counterparty.example)'),
    display_name: z.string().optional().describe('Display name within the Matter'),
    role: z.enum(['owner', 'participant']).optional().describe('Default: participant'),
  },
  async ({ matterId, principal_id, display_name, role }) => {
    try {
      const body: Record<string, unknown> = { principal_id };
      if (display_name) body.display_name = display_name;
      if (role) body.role = role;
      const result = await request(
        `/api/pact/matters/${encodeURIComponent(matterId)}/members`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_attach',
  'Attach an existing fabric to a Matter (owner-only). The fabric retains its own membership and obligations; this just registers the cross-reference. A fabric MAY belong to multiple Matters.',
  {
    matterId: z.string().describe('Matter ID'),
    resourceId: z.string().describe('Fabric / resource ID to attach'),
  },
  async ({ matterId, resourceId }) => {
    try {
      const result = await request(
        `/api/pact/matters/${encodeURIComponent(matterId)}/fabrics`,
        { method: 'POST', body: JSON.stringify({ resourceId }) },
      );
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_detach',
  'Detach a fabric from a Matter (owner-only). The fabric itself is NOT closed — it persists and continues to be queryable directly.',
  {
    matterId: z.string().describe('Matter ID'),
    resourceId: z.string().describe('Fabric / resource ID to detach'),
  },
  async ({ matterId, resourceId }) => {
    try {
      const result = await request(
        `/api/pact/matters/${encodeURIComponent(matterId)}/fabrics/${encodeURIComponent(resourceId)}`,
        { method: 'DELETE' },
      );
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_message',
  "Post a typed-event message to a Matter's side-channel. The wire format is a structured event (not free-form chat); UIs may render it as chat. Optional `fabric_id` cross-links the message to an attached fabric (and optional `section_id` to a section within it).",
  {
    matterId: z.string().describe('Matter ID'),
    content: z.string().describe('Message content (free text within a structured event)'),
    fabric_id: z.string().optional().describe('Optional: reference an attached fabric'),
    section_id: z.string().optional().describe('Optional: reference a section within the fabric'),
  },
  async ({ matterId, content, fabric_id, section_id }) => {
    try {
      const body: Record<string, unknown> = { content };
      if (fabric_id) body.fabric_id = fabric_id;
      if (section_id) body.section_id = section_id;
      const result = await request(
        `/api/pact/matters/${encodeURIComponent(matterId)}/messages`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_messages',
  "List a Matter's side-channel messages.",
  { matterId: z.string().describe('Matter ID') },
  async ({ matterId }) => {
    try {
      const result = await request(
        `/api/pact/matters/${encodeURIComponent(matterId)}/messages`,
      );
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_manifest',
  'Get the caller-scoped cross-fabric manifest for a Matter — §4.4.2 extended to Matter scope. Aggregates attached-fabric phase, open-proposal counts, caller-specific pending obligations across all attached fabrics, and side-channel summary. Cross-org peers are filtered per §17.13.',
  { matterId: z.string().describe('Matter ID') },
  async ({ matterId }) => {
    try {
      const result = await request(
        `/api/pact/matters/${encodeURIComponent(matterId)}/manifest`,
      );
      return jsonResult(result);
    } catch (err) { return errorResult(err); }
  },
);

tool(
  'pact_matter_close',
  'Close a Matter (owner-only). Per the RFC: closing does NOT cascade to attached fabrics — they persist independently and continue to be queryable directly. Use --outcome to record a free-form close reason ("deal-signed", "walked-away", etc.).',
  {
    matterId: z.string().describe('Matter ID'),
    outcome: z.string().optional().describe('Free-form outcome label'),
  },
  async ({ matterId, outcome }) => {
    try {
      const body: Record<string, unknown> = {};
      if (outcome) body.outcome = outcome;
      const result = await request(
        `/api/pact/matters/${encodeURIComponent(matterId)}/close`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      return jsonResult(result);
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
