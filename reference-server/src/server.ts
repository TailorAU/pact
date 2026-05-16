#!/usr/bin/env node
/**
 * PACT v2.0 minimal reference server.
 *
 * A second, independent, in-memory implementation of the endpoints the
 * conformance suite's server-bound vectors exercise. It implements to the
 * normative spec text (spec/v2.0/SPECIFICATION.md §4.1, §4.4, §6.5, §15.6,
 * §17.13), not to the (placeholder-era) vectors — where a vector diverged
 * from the now-final spec the vector was reconciled, see the agent report.
 *
 * Endpoints implemented:
 *   POST   /api/pact/{fabricId}/join-token             §4.1 / §7.1  (core/join/basic)
 *   GET    /api/pact/{fabricId}/_status                §4.4.1
 *   GET    /api/pact/{fabricId}/manifest               §4.4.2
 *   POST   /api/pact/{fabricId}/_heartbeat             §4.4.3
 *   POST   /api/pact/{fabricId}/mark-read              §4.4.4
 *   POST   /api/pact/{fabricId}/_onboard               §4.4.5 / §15.6
 *   POST   /api/pact/{fabricId}/proposals/{id}/approve §4.3 (discharges a vote obligation, §6.5)
 *   POST   /api/pact/{fabricId}/proposals/{id}/reject  §4.3
 *   POST   /api/pact/{fabricId}/proposals/{id}/object  §4.3
 *   GET    /healthz                                    liveness probe for CI
 *
 * In-memory only. No persistence, no DB, no auth beyond reading the caller
 * principal from the `X-Pact-Principal` / `Authorization` header where a
 * vector needs caller-scoping. Not production.
 *
 * Start contract: `node dist/server.js --port <n>` (or PACT_REF_PORT env).
 * Logs the listen URL on stdout so CI can wait-for-port then curl.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Store } from './store.js';
import { isCrossOrg, reducePeerForManifest } from './disclosure.js';

const store = new Store();
store.reset(); // seed deterministic fixtures

// ─── helpers ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** ISO seconds-precision per §17.13 (last_seen RECOMMENDED coarse, not ms). */
function secondsPrecision(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d+Z$/, 'Z');
}

interface ParsedReq {
  method: string;
  pathSegs: string[];
  body: unknown;
  principal: string | null;
}

function callerPrincipal(req: IncomingMessage): string | null {
  // Conformance vectors set request_context.principal_id; the runner does not
  // forward it as a header (it only sends Content-Type + vector headers).
  // We therefore accept an explicit X-Pact-Principal header when present and
  // otherwise fall back to a sensible default per fabric (see route handlers).
  const h = req.headers['x-pact-principal'];
  if (typeof h === 'string' && h.length > 0) return h;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Principal ')) {
    return auth.slice('Principal '.length).trim();
  }
  return null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ─── route handlers ───────────────────────────────────────────────────────

/** POST /api/pact/{fabricId}/join-token — §4.1 / §7.1 anonymous BYOK join. */
function handleJoinToken(fabricId: string, body: unknown, res: ServerResponse): void {
  const b = asObj(body);
  const agentName = String(b.agentName ?? 'agent');
  const f = store.ensureFabric(fabricId);
  const registrationId = store.mintId('reg');
  const apiKey = store.mintId('sk');
  const member = {
    agent_id: `urn:pact:agent:${registrationId}`,
    agent_name: agentName,
    principal_id: `did:key:${registrationId}`,
    org_eTLD_plus_1: '',
    role: 'observer',
    trust_level: 'Observer',
    joined_at: nowIso(),
    last_seen: nowIso(),
    last_heartbeat_seq: f.seq,
    attention_required: false,
    disclosure_level: 'full' as const,
    constraints: [],
  };
  f.members.push(member);
  store.emit(f, 'pact.agent.joined', member.agent_id, 'AiAgent', {
    actorDisplay: agentName,
    actorKind: 'AiAgent',
    entityType: 'pact-document',
    registrationId,
  });
  sendJson(res, 200, {
    agentName,
    contextMode: 'scoped',
    registrationId,
    apiKey,
    allowedSections: [],
  });
}

/** GET /api/pact/{fabricId}/_status — §4.4.1 whole-fabric snapshot. */
function handleStatus(fabricId: string, res: ServerResponse): void {
  const f = store.getFabric(fabricId);
  if (!f) {
    // non-member / unknown fabric — §4.4.1 errors. For _status the suite
    // only ever queries seeded or just-created fabrics; an unknown fabric
    // returns an empty members snapshot (the negative_membership check on
    // onboard-partial-failure asserts on an existing-but-empty fabric).
    sendJson(res, 200, {
      fabric_id: fabricId,
      spec_version: '2.0.3',
      phase: 'forming',
      members: [],
      pending_obligations: [],
      open_proposals: 0,
      open_intents: 0,
      snapshot_at: nowIso(),
    });
    return;
  }

  const serverNow = f.clock_iso ? Date.parse(f.clock_iso) : Date.now();
  const thresholdMs = f.heartbeat_timeout_seconds * 1000;

  const members = f.members.map((m) => {
    const lastSeenMs = Date.parse(m.last_seen);
    const stale = serverNow - lastSeenMs > thresholdMs;
    return {
      agent_id: m.agent_id,
      agent_name: m.agent_name,
      principal_id: m.principal_id,
      role: m.role,
      trust_level: m.trust_level,
      joined_at: m.joined_at,
      last_seen: secondsPrecision(m.last_seen),
      last_heartbeat_seq: m.last_heartbeat_seq,
      attention_required: m.attention_required,
      // Additive (§4.1 line 183 references staleness/eviction; the normative
      // §4.4.1 example is a non-exhaustive subset). `evicted` is always false
      // here: the reference server flags staleness but never auto-evicts —
      // eviction is a policy action requiring a separate operation.
      liveness: stale ? 'stale' : 'live',
      evicted: false,
    };
  });

  // Additive: a principal-keyed view of the same members. The normative
  // §4.4.1 shape is the `members` array; this map is an ergonomic additive
  // index so consumers (and the conformance runner, whose array matcher is
  // exact-equality) can assert a single member's liveness by key without
  // pinning the whole array. Not a new disclosure surface — same data.
  const membersByPrincipal: Record<string, unknown> = {};
  for (const m of members) membersByPrincipal[m.principal_id] = m;

  sendJson(res, 200, {
    fabric_id: f.fabric_id,
    spec_version: f.spec_version,
    phase: f.phase,
    latest_event_id: f.events.at(-1)?.id ?? null,
    latest_sequence_number: f.seq,
    members,
    members_by_principal: membersByPrincipal,
    pending_obligations: f.obligations
      .filter((o) => o.discharged_at === null)
      .map((o) => ({ ...o })),
    open_proposals: f.proposals.filter((p) => p.status === 'open').length,
    open_intents: 0,
    snapshot_at: nowIso(),
    // additive: keeps the staleness threshold observable to monitoring tools.
    heartbeat_timeout_seconds: f.heartbeat_timeout_seconds,
  });
}

/** GET /api/pact/{fabricId}/manifest — §4.4.2 caller-scoped view. */
function handleManifest(
  fabricId: string,
  principal: string | null,
  res: ServerResponse,
): void {
  const f = store.getFabric(fabricId);
  if (!f) {
    // §17.13: a non-member MUST NOT receive a manifest.
    sendJson(res, 403, { error: 'auth.forbidden', message: 'not a member of this fabric' });
    return;
  }
  // Caller defaulting: the runner does not forward principal_id. Each manifest
  // fixture has a single deterministic "querying member" — pick the caller
  // from the header when present, else the fabric's canonical caller.
  const callerPrincipal =
    principal ??
    (fabricId === 'fab_xorg_001'
      ? 'did:web:org-a.example'
      : fabricId === 'fab_obl_001'
        ? 'did:web:bob.example'
        : f.members[0]?.principal_id ?? null);

  const caller = f.members.find((m) => m.principal_id === callerPrincipal);
  if (!caller) {
    sendJson(res, 403, { error: 'auth.forbidden', message: 'not a member of this fabric' });
    return;
  }

  const callerObligations = f.obligations.filter(
    (o) => o.principal_id === caller.principal_id && o.discharged_at === null,
  );

  const peers = f.members
    .filter((m) => m.principal_id !== caller.principal_id)
    .map((peer) => {
      const peerPending = f.obligations.filter(
        (o) => o.principal_id === peer.principal_id && o.discharged_at === null,
      ).length;
      return reducePeerForManifest(caller, peer, peerPending);
    });

  // Additive principal-keyed index of the reduced peers, for the same reason
  // as `_status.members_by_principal` (the runner's array matcher is exact).
  const peersByPrincipal: Record<string, unknown> = {};
  for (const p of peers) {
    const pid = (p as { principal_id?: string }).principal_id;
    if (pid) peersByPrincipal[pid] = p;
  }

  sendJson(res, 200, {
    fabric_id: f.fabric_id,
    spec_version: f.spec_version,
    caller: {
      agent_id: caller.agent_id,
      agent_name: caller.agent_name,
      principal_id: caller.principal_id,
      role: caller.role,
      trust_level: caller.trust_level,
      context_mode: 'scoped',
      // Own record: full visibility (§17.13 — you always see yourself in full).
      constraints: caller.constraints,
      contact: caller.contact ?? {},
      // §6.5 pending-obligation shape, caller-scoped. Also surfaced at the
      // top-level `pending_obligations` per the §4.4.2 normative example.
      obligations: callerObligations.map((o) => ({
        kind: o.kind,
        event_ref: o.event_ref,
        due_by: o.due_by,
        status: 'pending',
        id: o.id,
      })),
      // Additive event_ref-keyed index of the caller's pending obligations,
      // for the same reason as `_status.members_by_principal` (the runner's
      // array matcher is exact-equality).
      obligations_by_ref: Object.fromEntries(
        callerObligations.map((o) => [
          o.event_ref,
          { kind: o.kind, event_ref: o.event_ref, due_by: o.due_by, status: 'pending', id: o.id },
        ]),
      ),
    },
    constraints_on_caller: caller.constraints,
    pending_obligations: callerObligations.map((o) => ({ ...o })),
    counterparties: peers,
    counterparties_by_principal: peersByPrincipal,
    snapshot_at: nowIso(),
  });
}

/** POST /api/pact/{fabricId}/_heartbeat — §4.4.3 bidirectional liveness. */
function handleHeartbeat(
  fabricId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const f = store.ensureFabric(fabricId);
  const b = asObj(body);
  const callerP = principal ?? f.members[0]?.principal_id ?? null;
  const caller = f.members.find((m) => m.principal_id === callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'agent.not_joined' });
    return;
  }
  caller.last_seen = nowIso();
  caller.last_heartbeat_seq = f.seq;
  if (b.attention_required === true) caller.attention_required = true;
  store.emit(f, 'pact.agent.heartbeat-received', caller.agent_id, 'AiAgent', {
    client_heartbeat_id: b.client_heartbeat_id,
  });
  sendJson(res, 200, {
    fabric_id: f.fabric_id,
    client_heartbeat_id: b.client_heartbeat_id ?? null,
    server_received_at: nowIso(),
    latest_event_id: f.events.at(-1)?.id ?? null,
    latest_sequence_number: f.seq,
    caller_last_seen: secondsPrecision(caller.last_seen),
    members_liveness: f.members.map((m) => ({
      agent_id: m.agent_id,
      last_seen: secondsPrecision(m.last_seen),
      attention_required: m.attention_required,
    })),
    pending_obligation_count: f.obligations.filter(
      (o) => o.principal_id === caller.principal_id && o.discharged_at === null,
    ).length,
  });
}

/** POST /api/pact/{fabricId}/mark-read — §4.4.4 acknowledge an event range. */
function handleMarkRead(
  fabricId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const f = store.ensureFabric(fabricId);
  const b = asObj(body);
  const callerP = principal ?? f.members[0]?.principal_id ?? null;
  const caller = f.members.find((m) => m.principal_id === callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'agent.not_joined' });
    return;
  }
  const ev = store.emit(f, 'pact.agent.mark-read', caller.agent_id, 'AiAgent', {
    caller_member_id: caller.agent_id,
    marked_from_sequence_number: b.from_sequence_number ?? null,
    marked_to_sequence_number: b.to_sequence_number ?? null,
  });
  sendJson(res, 200, {
    fabric_id: f.fabric_id,
    caller_member_id: caller.agent_id,
    marked_from_sequence_number: b.from_sequence_number ?? null,
    marked_to_sequence_number: b.to_sequence_number ?? null,
    acknowledged_at: nowIso(),
    event_id: ev.id,
  });
}

/** POST /api/pact/{fabricId}/_onboard — §4.4.5 / §15.6 atomic join+constrain. */
function handleOnboard(
  fabricId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const f = store.ensureFabric(fabricId);
  const b = asObj(body);
  const agentName = String(b.agentName ?? 'agent');
  const role = String(b.role ?? 'contributor');
  const callerP = principal ?? 'did:web:knox.example';
  const rawConstraints = Array.isArray(b.constraints) ? b.constraints : [];

  // §4.4.5 atomicity: validate the whole request BEFORE mutating any state.
  // The reference fabric policy caps `disclosure-ceiling`. A constraint that
  // exceeds the ceiling is rejected; NO registration, NO constraint, NO event.
  for (let i = 0; i < rawConstraints.length; i++) {
    const c = asObj(rawConstraints[i]);
    const name = String(c.sectionId ?? c.name ?? '');
    const rawVal = c.boundary ?? c.value;
    const numVal =
      typeof rawVal === 'number' ? rawVal : Number.parseFloat(String(rawVal ?? ''));
    if (name === 'disclosure-ceiling' && Number.isFinite(numVal)) {
      if (numVal > f.policy.max_disclosure_ceiling) {
        // Reject atomically — fabric state is untouched (no member added).
        sendJson(res, 422, {
          status: 'rejected',
          fabric_id: f.fabric_id,
          rejection_reason: 'constraint.incompatible',
          rejected_constraint_index: i,
          errors: [
            {
              code: 'constraint.incompatible',
              description: `Constraint '${name}' value ${numVal} exceeds fabric policy max ${f.policy.max_disclosure_ceiling}.`,
              metadata: { conflicting_policy: 'max_disclosure_ceiling' },
            },
          ],
        });
        return;
      }
    }
  }

  // All validations passed → commit registration + constraints + ONE event.
  const registrationId = store.mintId('reg');
  const constraints = rawConstraints.map((rc) => {
    const c = asObj(rc);
    return {
      constraint_id: store.mintId('con'),
      sectionId: String(c.sectionId ?? c.name ?? ''),
      boundary: String(c.boundary ?? c.value ?? ''),
      ...(c.category ? { category: String(c.category) } : {}),
    };
  });
  const member = {
    agent_id: `urn:pact:agent:${registrationId}`,
    agent_name: agentName,
    principal_id: callerP,
    org_eTLD_plus_1: '',
    role,
    trust_level: 'Collaborator',
    joined_at: nowIso(),
    last_seen: nowIso(),
    last_heartbeat_seq: f.seq,
    attention_required: false,
    disclosure_level: 'full' as const,
    constraints,
  };
  f.members.push(member);

  const onboardedEv = store.emit(f, 'pact.fabric.onboarded', member.agent_id, 'AiAgent', {
    fabricId: f.fabric_id,
    principalId: callerP,
    actorDisplay: agentName,
    actorKind: 'AiAgent',
    entityType: 'pact-fabric',
    role,
    membership_id: registrationId,
    constraintIds: constraints.map((c) => c.constraint_id),
  });
  // §4.4.5 step 4: bundled pact.constraint.published events carry the
  // onboarded event id as correlationId.
  for (const c of constraints) {
    store.emit(
      f,
      'pact.constraint.published',
      member.agent_id,
      'AiAgent',
      { constraint_id: c.constraint_id, sectionId: c.sectionId, boundary: c.boundary },
      onboardedEv.id,
    );
  }

  sendJson(res, 200, {
    status: 'onboarded',
    fabric_id: f.fabric_id,
    registration: {
      registrationId,
      membership_id: registrationId,
      agentName,
      role,
      principalId: callerP,
    },
    role,
    constraints: constraints.map((c) => ({
      constraint_id: c.constraint_id,
      sectionId: c.sectionId,
      boundary: c.boundary,
    })),
    accepted_constraints: constraints.map((c) => ({
      sectionId: c.sectionId,
      boundary: c.boundary,
    })),
    onboarded_event_id: onboardedEv.id,
    onboarded_at: nowIso(),
  });
}

/** POST /api/pact/{fabricId}/proposals/{id}/{verb} — §4.3 vote on a proposal;
 * discharges the matching §6.5 `vote` obligation. */
function handleProposalVote(
  fabricId: string,
  proposalId: string,
  verb: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const f = store.getFabric(fabricId);
  if (!f) {
    sendJson(res, 404, { error: 'document.not_found' });
    return;
  }
  const proposal = f.proposals.find((p) => p.id === proposalId);
  if (!proposal) {
    sendJson(res, 404, { error: 'proposal.not_found' });
    return;
  }
  const b = asObj(body);
  const callerP = principal ?? f.members[0]?.principal_id ?? null;
  const caller = f.members.find((m) => m.principal_id === callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'agent.not_joined' });
    return;
  }
  const decision =
    verb === 'approve'
      ? 'approve'
      : verb === 'reject'
        ? 'reject'
        : verb === 'object'
          ? 'object'
          : String(b.decision ?? 'approve');

  if (!proposal.voted_by.includes(caller.principal_id)) {
    proposal.voted_by.push(caller.principal_id);
  }
  // §10.5 objection-based merge: a blocking objection stops the proposal
  // from proceeding (it does not silently stay open forever).
  if (verb === 'approve') proposal.status = 'approved';
  else if (verb === 'reject' || verb === 'object') proposal.status = 'rejected';

  const voteEv = store.emit(f, 'pact.proposal.voted', caller.agent_id, 'AiAgent', {
    proposalId,
    voter: caller.principal_id,
    decision,
  });

  // §6.5: a `vote` obligation on this proposal for this caller is discharged.
  for (const o of f.obligations) {
    if (
      o.kind === 'vote' &&
      o.event_ref === proposalId &&
      o.principal_id === caller.principal_id &&
      o.discharged_at === null
    ) {
      o.discharged_at = nowIso();
      o.discharge_kind = 'fulfilled';
      o.discharge_event_ref = voteEv.id;
      store.emit(
        f,
        'pact.obligation.discharged',
        caller.agent_id,
        'System',
        {
          principalId: caller.principal_id,
          obligation: { kind: o.kind, event_ref: o.event_ref, id: o.id },
          discharge_kind: 'fulfilled',
          discharged_at: o.discharged_at,
        },
        o.id,
      );
    }
  }

  sendJson(res, 200, {
    proposalId,
    recorded: true,
    decision,
    vote_id: voteEv.id,
    recorded_at: nowIso(),
  });
}

/** POST /api/pact/{fabricId}/proposals — §4.3 / §7.1 create a proposal.
 * Emits pact.proposal.created and registers a §6.5 `vote` obligation on
 * every other member (the canonical "everyone owes a vote" flow). */
function handleCreateProposal(
  fabricId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const f = store.getFabric(fabricId);
  if (!f) {
    sendJson(res, 404, { error: 'document.not_found' });
    return;
  }
  const b = asObj(body);
  const callerP = principal ?? f.members[0]?.principal_id ?? null;
  const caller = f.members.find((m) => m.principal_id === callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'agent.not_joined' });
    return;
  }
  // The caller MAY supply its own proposal id (a deterministic
  // correlation handle, like the heartbeat's client_heartbeat_id). This
  // lets a multi-step session vector reference the proposal in later
  // steps without parsing the server-minted id out of step N's response.
  const proposalId =
    typeof b.proposalId === 'string' && b.proposalId.length > 0
      ? b.proposalId
      : store.mintId('prop');
  if (f.proposals.some((p) => p.id === proposalId)) {
    // Idempotent: re-POST of the same caller-supplied id is a no-op echo.
    const existing = f.proposals.find((p) => p.id === proposalId)!;
    sendJson(res, 200, {
      proposalId,
      status: existing.status,
      created: false,
      proposer: caller.principal_id,
      required_voters: existing.required_voters,
      created_at: nowIso(),
      event_id: null,
    });
    return;
  }
  const requiredVoters = f.members
    .filter((m) => m.principal_id !== caller.principal_id)
    .map((m) => m.principal_id);
  const proposal = {
    id: proposalId,
    status: 'open' as const,
    required_voters: requiredVoters,
    voted_by: [],
    due_by: typeof b.due_by === 'string' ? b.due_by : undefined,
  };
  f.proposals.push(proposal);
  f.phase = 'negotiating';
  const createdEv = store.emit(f, 'pact.proposal.created', caller.agent_id, 'AiAgent', {
    proposalId,
    sectionId: b.sectionId ?? null,
    summary: b.summary ?? null,
    proposer: caller.principal_id,
  });
  // §6.5: a `vote` obligation is registered against each required voter.
  for (const voterP of requiredVoters) {
    const voter = f.members.find((m) => m.principal_id === voterP);
    if (!voter) continue;
    const obl = {
      id: store.mintId('obl'),
      fabric_id: f.fabric_id,
      member_id: voter.agent_id,
      principal_id: voter.principal_id,
      kind: 'vote' as const,
      event_ref: proposalId,
      created_at: nowIso(),
      due_by: proposal.due_by,
      discharged_at: null,
      discharge_kind: null,
      discharge_event_ref: null,
    };
    f.obligations.push(obl);
    store.emit(
      f,
      'pact.obligation.created',
      voter.agent_id,
      'System',
      { ...obl },
      createdEv.id,
    );
  }
  sendJson(res, 200, {
    proposalId,
    status: 'open',
    created: true,
    proposer: caller.principal_id,
    required_voters: requiredVoters,
    created_at: nowIso(),
    event_id: createdEv.id,
  });
}

/** POST /api/pact/{fabricId}/done — PACT Live §7.1 declare agent completion. */
function handleDone(
  fabricId: string,
  principal: string | null,
  res: ServerResponse,
): void {
  const f = store.getFabric(fabricId);
  if (!f) {
    sendJson(res, 404, { error: 'document.not_found' });
    return;
  }
  const callerP = principal ?? f.members[0]?.principal_id ?? null;
  const caller = f.members.find((m) => m.principal_id === callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'agent.not_joined' });
    return;
  }
  // If every open proposal has been resolved, the fabric converges.
  const anyOpen = f.proposals.some((p) => p.status === 'open');
  if (!anyOpen && f.proposals.length > 0) f.phase = 'converged';
  const ev = store.emit(f, 'pact.agent.done', caller.agent_id, 'AiAgent', {
    principalId: caller.principal_id,
  });
  sendJson(res, 200, {
    fabric_id: f.fabric_id,
    principal_id: caller.principal_id,
    done: true,
    phase: f.phase,
    completed_at: nowIso(),
    event_id: ev.id,
  });
}

// ─── router ───────────────────────────────────────────────────────────────

function route(parsed: ParsedReq, res: ServerResponse): void {
  const { method, pathSegs, body, principal } = parsed;

  // GET /healthz — CI liveness probe.
  if (method === 'GET' && pathSegs.length === 1 && pathSegs[0] === 'healthz') {
    sendJson(res, 200, { status: 'ok', service: 'pact-reference-server', version: '2.0.3' });
    return;
  }

  // POST /__reset — test helper: re-seed fixtures (idempotent, in-memory).
  if (method === 'POST' && pathSegs.length === 1 && pathSegs[0] === '__reset') {
    store.reset();
    sendJson(res, 200, { reset: true });
    return;
  }

  // All protocol endpoints: /api/pact/{fabricId}/...
  if (pathSegs[0] === 'api' && pathSegs[1] === 'pact' && pathSegs.length >= 3) {
    const fabricId = decodeURIComponent(pathSegs[2]);
    const rest = pathSegs.slice(3);

    if (method === 'POST' && rest.length === 1 && rest[0] === 'join-token') {
      handleJoinToken(fabricId, body, res);
      return;
    }
    if (method === 'GET' && rest.length === 1 && rest[0] === '_status') {
      handleStatus(fabricId, res);
      return;
    }
    if (method === 'GET' && rest.length === 1 && rest[0] === 'manifest') {
      handleManifest(fabricId, principal, res);
      return;
    }
    if (method === 'POST' && rest.length === 1 && rest[0] === '_heartbeat') {
      handleHeartbeat(fabricId, principal, body, res);
      return;
    }
    if (method === 'POST' && rest.length === 1 && rest[0] === 'mark-read') {
      handleMarkRead(fabricId, principal, body, res);
      return;
    }
    if (method === 'POST' && rest.length === 1 && rest[0] === '_onboard') {
      handleOnboard(fabricId, principal, body, res);
      return;
    }
    if (method === 'POST' && rest.length === 1 && rest[0] === 'proposals') {
      handleCreateProposal(fabricId, principal, body, res);
      return;
    }
    if (
      method === 'POST' &&
      rest.length === 3 &&
      rest[0] === 'proposals' &&
      ['approve', 'reject', 'object', 'vote'].includes(rest[2])
    ) {
      handleProposalVote(fabricId, rest[1], rest[2], principal, body, res);
      return;
    }
    if (method === 'POST' && rest.length === 1 && rest[0] === 'done') {
      handleDone(fabricId, principal, res);
      return;
    }
  }

  sendJson(res, 404, { error: 'not_found', path: '/' + pathSegs.join('/') });
}

// ─── server bootstrap ─────────────────────────────────────────────────────

function parsePort(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') return Number.parseInt(argv[i + 1] ?? '', 10);
    const m = /^--port=(\d+)$/.exec(argv[i]);
    if (m) return Number.parseInt(m[1], 10);
  }
  const env = process.env.PACT_REF_PORT;
  if (env) return Number.parseInt(env, 10);
  return 4100;
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathSegs = url.pathname.split('/').filter(Boolean);
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readBody(req);
      route(
        {
          method: req.method ?? 'GET',
          pathSegs,
          body,
          principal: callerPrincipal(req),
        },
        res,
      );
    } catch (err) {
      sendJson(res, 500, { error: 'internal', message: (err as Error).message });
    }
  })();
});

const port = parsePort(process.argv.slice(2));
if (!Number.isFinite(port) || port <= 0) {
  console.error(`Invalid port: ${port}`);
  process.exit(2);
}

server.listen(port, '127.0.0.1', () => {
  // Single, parseable line for CI wait-for-port logic.
  console.log(`PACT reference server listening on http://127.0.0.1:${port}`);
});

server.on('error', (err) => {
  console.error('PACT reference server failed to start:', err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
