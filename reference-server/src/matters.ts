/**
 * Matter route handlers — v2.2 draft.
 *
 * A Matter is a multi-fabric container (the "deal-room shape"). See:
 *   - docs/v2-prep/rfc-matters-multi-fabric.md          (the RFC)
 *   - docs/v2-prep/matters-spec-draft.md                (the §-text candidate)
 *   - docs/v2-prep/matters-schemas/                     (the JSON schemas)
 *
 * This module is the second independent implementation alongside the
 * Tailor monorepo, exists to make the matter conformance vectors runnable,
 * and is in-memory only — same posture as the rest of the reference server.
 *
 * Endpoints implemented:
 *   POST   /api/pact/matters                                open a Matter
 *   GET    /api/pact/matters                                list Matters (additive)
 *   GET    /api/pact/matters/{id}                           get one Matter (additive)
 *   POST   /api/pact/matters/{id}/members                   add a member
 *   POST   /api/pact/matters/{id}/fabrics                   attach an existing fabric
 *   DELETE /api/pact/matters/{id}/fabrics/{resourceId}      detach a fabric
 *   POST   /api/pact/matters/{id}/messages                  post a side-channel message
 *   GET    /api/pact/matters/{id}/messages                  list side-channel (additive)
 *   GET    /api/pact/matters/{id}/manifest                  caller-scoped cross-fabric manifest
 *   POST   /api/pact/matters/{id}/close                     close the Matter
 *
 * Event types emitted: pact.matter.opened, .member-added, .fabric-attached,
 * .fabric-detached, .message, .closed.
 */

import type { ServerResponse } from 'node:http';
import {
  Store,
  type Matter,
  type MatterMember,
  type MatterFabricAttachment,
  type MatterMessage,
} from './store.js';
import { isCrossOrg } from './disclosure.js';

function nowIso(): string {
  return new Date().toISOString();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** §15.4 registrable-domain on a raw `did:web:host` principal. Same minimal
 * last-two-labels heuristic the rest of the reference server uses. */
function eTLDplus1(principalId: string): string {
  const m = /^did:web:([^/]+)/.exec(principalId);
  const host = m ? m[1] : principalId;
  const labels = host.split('.');
  return labels.length <= 2 ? host : labels.slice(-2).join('.');
}

/** Find the caller's Matter membership; null if not a member. */
function findCallerMember(m: Matter, callerPrincipal: string | null): MatterMember | null {
  if (!callerPrincipal) return null;
  return m.members.find((mm) => mm.principal_id === callerPrincipal) ?? null;
}

/** ───────────────────────────────────────────────────────────────────────
 *  POST /api/pact/matters — open a new Matter.
 *
 *  Body: { name: string, opened_by_display?: string }
 *  Caller-principal becomes the first member with role=owner.
 *  ─────────────────────────────────────────────────────────────────────── */
export function handleOpenMatter(
  store: Store,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const b = asObj(body);
  const name = typeof b.name === 'string' && b.name.length > 0 ? b.name : 'Untitled Matter';
  const callerP = principal ?? 'did:web:knox.example';
  const ownerDisplay =
    typeof b.opened_by_display === 'string' && b.opened_by_display.length > 0
      ? b.opened_by_display
      : callerP;

  const m = store.createMatter(name, callerP, ownerDisplay);

  const ev = store.emitMatter(m, 'pact.matter.opened', callerP, {
    matter_id: m.matter_id,
    name: m.name,
    opened_by: callerP,
  });

  sendJson(res, 200, {
    matter_id: m.matter_id,
    spec_version: m.spec_version,
    name: m.name,
    phase: m.phase,
    members: m.members,
    fabrics: m.fabrics,
    opened_at: m.opened_at,
    opened_by: m.opened_by,
    opened_event_id: ev.id,
  });
}

/** GET /api/pact/matters — list all Matters (additive, for CLI/MCP discovery). */
export function handleListMatters(store: Store, res: ServerResponse): void {
  const all = store.listMatters();
  sendJson(res, 200, {
    matters: all.map((m) => ({
      matter_id: m.matter_id,
      name: m.name,
      phase: m.phase,
      member_count: m.members.length,
      fabric_count: m.fabrics.length,
      message_count: m.messages.length,
      opened_at: m.opened_at,
      closed_at: m.closed_at,
    })),
  });
}

/** GET /api/pact/matters/{id} — get a Matter (caller-filtered per §17.13). */
export function handleGetMatter(
  store: Store,
  matterId: string,
  principal: string | null,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'auth.forbidden', message: 'not a member of this Matter' });
    return;
  }
  sendJson(res, 200, {
    matter_id: m.matter_id,
    spec_version: m.spec_version,
    name: m.name,
    phase: m.phase,
    members: m.members,
    fabrics: m.fabrics,
    opened_at: m.opened_at,
    opened_by: m.opened_by,
    closes_at: m.closes_at,
    closed_at: m.closed_at,
    message_count: m.messages.length,
  });
}

/** ───────────────────────────────────────────────────────────────────────
 *  POST /api/pact/matters/{id}/members — add a member to a Matter.
 *  Only owners may add members (RFC lean: owner role is the gatekeeper).
 *  ─────────────────────────────────────────────────────────────────────── */
export function handleAddMember(
  store: Store,
  matterId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  if (m.phase === 'closed') {
    sendJson(res, 409, { error: 'matter.closed', message: 'cannot add a member to a closed Matter' });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller || caller.role !== 'owner') {
    sendJson(res, 403, {
      error: 'auth.forbidden',
      message: 'only Matter owners may add members',
    });
    return;
  }
  const b = asObj(body);
  const newPrincipal = String(b.principal_id ?? '');
  if (!newPrincipal) {
    sendJson(res, 422, {
      errors: [{ code: 'member.invalid', description: 'principal_id is required' }],
    });
    return;
  }
  const existing = m.members.find((mm) => mm.principal_id === newPrincipal);
  if (existing) {
    // §24.6 idempotent "ensure present": no state change and NO event. The
    // EXISTING role is returned even when a different one was requested
    // (RFC #32 option (a)) — add-member never changes a member's role, so a
    // dropped-ACK retry can never promote or demote someone as a side effect.
    sendJson(res, 200, {
      matterId: m.matter_id,
      added: false,
      principalId: existing.principal_id,
      role: existing.role,
    });
    return;
  }
  const display = String(b.display_name ?? newPrincipal);
  const role: 'owner' | 'participant' = b.role === 'owner' ? 'owner' : 'participant';
  const member: MatterMember = {
    principal_id: newPrincipal,
    display_name: display,
    role,
    joined_at: nowIso(),
    org_eTLD_plus_1: eTLDplus1(newPrincipal),
  };
  m.members.push(member);
  const ev = store.emitMatter(m, 'pact.matter.member-added', callerP, {
    matter_id: m.matter_id,
    added_principal: newPrincipal,
    added_role: role,
    added_by: callerP,
  });
  // Flat camelCase per §24.6 / matter-add-member-response.json — matches the
  // deployed wire contract pinned by #30 / #31 and the shape cli/ already
  // reads. There is no nested `member` wrapper.
  sendJson(res, 200, {
    matterId: m.matter_id,
    added: true,
    principalId: member.principal_id,
    role: member.role,
    eventId: ev.id,
  });
}

/** ───────────────────────────────────────────────────────────────────────
 *  POST /api/pact/matters/{id}/fabrics — attach an existing fabric.
 *  ATTACH IS A LINK, NOT A MERGE: the fabric retains its own membership and
 *  obligations; this just registers the cross-reference. Per RFC OQ4: a
 *  fabric MAY belong to multiple Matters simultaneously.
 *  ─────────────────────────────────────────────────────────────────────── */
export function handleAttachFabric(
  store: Store,
  matterId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  if (m.phase === 'closed') {
    sendJson(res, 409, {
      error: 'matter.closed',
      message: 'cannot attach a fabric to a closed Matter',
    });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller || caller.role !== 'owner') {
    sendJson(res, 403, {
      error: 'auth.forbidden',
      message: 'only Matter owners may attach fabrics',
    });
    return;
  }
  const b = asObj(body);
  const resourceId = String(b.resourceId ?? b.fabric_id ?? '');
  if (!resourceId) {
    sendJson(res, 422, {
      errors: [{ code: 'fabric.invalid', description: 'resourceId is required' }],
    });
    return;
  }
  // The reference store lazily materialises fabrics; we ensure rather than
  // 404 on attach so workflows that "attach the term sheet" before the term
  // sheet has been written to work end-to-end. A production implementation
  // SHOULD require the fabric to exist already.
  store.ensureFabric(resourceId);
  if (m.fabrics.some((f) => f.resourceId === resourceId)) {
    sendJson(res, 200, {
      matter_id: m.matter_id,
      attached: false,
      already_attached: true,
      resourceId,
    });
    return;
  }
  const attachment: MatterFabricAttachment = {
    resourceId,
    attached_at: nowIso(),
    attached_by: callerP,
  };
  m.fabrics.push(attachment);
  const ev = store.emitMatter(m, 'pact.matter.fabric-attached', callerP, {
    matter_id: m.matter_id,
    resourceId,
    attached_by: callerP,
  });
  sendJson(res, 200, {
    matter_id: m.matter_id,
    attached: true,
    attachment,
    event_id: ev.id,
  });
}

/** DELETE /api/pact/matters/{id}/fabrics/{resourceId} — detach a fabric.
 * Per RFC OQ3: detach does NOT close the underlying fabric — it persists. */
export function handleDetachFabric(
  store: Store,
  matterId: string,
  resourceId: string,
  principal: string | null,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  if (m.phase === 'closed') {
    sendJson(res, 409, { error: 'matter.closed' });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller || caller.role !== 'owner') {
    sendJson(res, 403, {
      error: 'auth.forbidden',
      message: 'only Matter owners may detach fabrics',
    });
    return;
  }
  const idx = m.fabrics.findIndex((f) => f.resourceId === resourceId);
  if (idx < 0) {
    sendJson(res, 404, { error: 'fabric.not_attached' });
    return;
  }
  m.fabrics.splice(idx, 1);
  const ev = store.emitMatter(m, 'pact.matter.fabric-detached', callerP, {
    matter_id: m.matter_id,
    resourceId,
    detached_by: callerP,
  });
  sendJson(res, 200, {
    matter_id: m.matter_id,
    detached: true,
    resourceId,
    event_id: ev.id,
  });
}

/** ───────────────────────────────────────────────────────────────────────
 *  POST /api/pact/matters/{id}/messages — post a side-channel message.
 *  Per maintainer call 2026-05-24: TYPED EVENTS ONLY. The body is structured
 *  (sender, posted_at, body{format,content}, optional references); UIs may
 *  render as chat but the wire format stays typed.
 *  ─────────────────────────────────────────────────────────────────────── */
export function handlePostMessage(
  store: Store,
  matterId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  if (m.phase === 'closed') {
    sendJson(res, 409, { error: 'matter.closed', message: 'cannot post to a closed Matter' });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller) {
    sendJson(res, 403, {
      error: 'auth.forbidden',
      message: 'not a member of this Matter',
    });
    return;
  }
  const b = asObj(body);
  const content = String(b.content ?? '').trim();
  if (!content) {
    sendJson(res, 422, {
      errors: [{ code: 'message.empty', description: 'content is required' }],
    });
    return;
  }
  const message: MatterMessage = {
    id: store.mintId('msg'),
    sender_principal: callerP,
    posted_at: nowIso(),
    body: { format: 'text', content },
    ...(typeof b.fabric_id === 'string'
      ? {
          references: {
            fabric_id: String(b.fabric_id),
            ...(typeof b.section_id === 'string' ? { section_id: String(b.section_id) } : {}),
          },
        }
      : {}),
  };
  m.messages.push(message);
  const ev = store.emitMatter(m, 'pact.matter.message', callerP, {
    matter_id: m.matter_id,
    message_id: message.id,
    sender: callerP,
    body: message.body,
    ...(message.references ? { references: message.references } : {}),
  });
  sendJson(res, 200, {
    matter_id: m.matter_id,
    message,
    event_id: ev.id,
  });
}

/** GET /api/pact/matters/{id}/messages — list the side-channel.
 * §17.13 disclosure rules apply: cross-org senders' principal_id stays visible
 * (it's a routing handle, not contact PII), but content is unfiltered within
 * the Matter — Matter membership IS the disclosure boundary. */
export function handleListMessages(
  store: Store,
  matterId: string,
  principal: string | null,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'auth.forbidden', message: 'not a member of this Matter' });
    return;
  }
  sendJson(res, 200, {
    matter_id: m.matter_id,
    messages: m.messages,
    count: m.messages.length,
  });
}

/** ───────────────────────────────────────────────────────────────────────
 *  GET /api/pact/matters/{id}/manifest — caller-scoped cross-fabric manifest.
 *  Extension of §4.4.2 to Matter scope: aggregates the attached fabrics' state
 *  into a single response, filtered per §17.13 cross-org rules.
 *  ─────────────────────────────────────────────────────────────────────── */
export function handleMatterManifest(
  store: Store,
  matterId: string,
  principal: string | null,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller) {
    sendJson(res, 403, { error: 'auth.forbidden', message: 'not a member of this Matter' });
    return;
  }

  // Caller-scoped peers — §17.13 reduction applies at Matter scope.
  const peers = m.members
    .filter((mm) => mm.principal_id !== caller.principal_id)
    .map((peer) => {
      const crossOrg = isCrossOrg(caller.principal_id, peer.principal_id);
      if (crossOrg) {
        return {
          principal_id: peer.principal_id,
          display_name: peer.display_name,
          role: peer.role,
          joined_at: peer.joined_at,
          cross_org: true,
        };
      }
      return {
        principal_id: peer.principal_id,
        display_name: peer.display_name,
        role: peer.role,
        joined_at: peer.joined_at,
        org_eTLD_plus_1: peer.org_eTLD_plus_1,
        cross_org: false,
      };
    });

  // Aggregate attached-fabric state. Cross-org disclosure rules per §17.13
  // apply to each fabric: open_proposals + pending_obligations COUNTS are
  // safe to expose at Matter scope (they are summary metrics, not PII), but
  // raw constraint text + raw obligation IDs are NOT included here — the
  // caller must query the individual fabric's /manifest for per-fabric detail.
  const fabricsSummary = m.fabrics.map((att) => {
    const f = store.getFabric(att.resourceId);
    if (!f) {
      return {
        resourceId: att.resourceId,
        attached_at: att.attached_at,
        status: 'unknown' as const,
      };
    }
    const pendingForCaller = f.obligations.filter(
      (o) => o.principal_id === caller.principal_id && o.discharged_at === null,
    );
    return {
      resourceId: att.resourceId,
      attached_at: att.attached_at,
      attached_by: att.attached_by,
      phase: f.phase,
      member_count: f.members.length,
      open_proposals: f.proposals.filter((p) => p.status === 'open').length,
      pending_obligation_count_for_caller: pendingForCaller.length,
      caller_is_fabric_member: f.members.some(
        (fm) => fm.principal_id === caller.principal_id,
      ),
    };
  });

  // Cross-fabric pending obligations FOR THE CALLER — the §6.5 obligations
  // surfaced at Matter scope. Per the RFC, this is the "where am I across
  // all artifacts" answer that fabric-scoped §4.4.2 cannot give.
  const callerObligationsAcrossFabrics: Array<{
    fabric_id: string;
    obligation_id: string;
    kind: string;
    event_ref: string;
    due_by: string | undefined;
  }> = [];
  for (const att of m.fabrics) {
    const f = store.getFabric(att.resourceId);
    if (!f) continue;
    for (const o of f.obligations) {
      if (o.principal_id === caller.principal_id && o.discharged_at === null) {
        callerObligationsAcrossFabrics.push({
          fabric_id: f.fabric_id,
          obligation_id: o.id,
          kind: o.kind,
          event_ref: o.event_ref,
          due_by: o.due_by,
        });
      }
    }
  }

  sendJson(res, 200, {
    matter_id: m.matter_id,
    spec_version: m.spec_version,
    phase: m.phase,
    caller: {
      principal_id: caller.principal_id,
      display_name: caller.display_name,
      role: caller.role,
    },
    counterparties: peers,
    fabrics: fabricsSummary,
    pending_obligations_across_fabrics: callerObligationsAcrossFabrics,
    side_channel: {
      message_count: m.messages.length,
      latest_message_at: m.messages.at(-1)?.posted_at ?? null,
    },
    snapshot_at: nowIso(),
  });
}

/** POST /api/pact/matters/{id}/close — close a Matter.
 * Per RFC OQ3: closing does NOT cascade to attached fabrics. They persist
 * independently and continue to be queryable directly. */
export function handleCloseMatter(
  store: Store,
  matterId: string,
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): void {
  const m = store.getMatter(matterId);
  if (!m) {
    sendJson(res, 404, { error: 'matter.not_found' });
    return;
  }
  const callerP = principal ?? m.opened_by;
  const caller = findCallerMember(m, callerP);
  if (!caller || caller.role !== 'owner') {
    sendJson(res, 403, {
      error: 'auth.forbidden',
      message: 'only Matter owners may close it',
    });
    return;
  }
  if (m.phase === 'closed') {
    sendJson(res, 200, {
      matter_id: m.matter_id,
      already_closed: true,
      closed_at: m.closed_at,
    });
    return;
  }
  const b = asObj(body);
  const outcome = typeof b.outcome === 'string' ? b.outcome : 'closed';
  m.phase = 'closed';
  m.closed_at = nowIso();
  const ev = store.emitMatter(m, 'pact.matter.closed', callerP, {
    matter_id: m.matter_id,
    closed_by: callerP,
    outcome,
    detached_fabrics: m.fabrics.map((f) => f.resourceId),
  });
  sendJson(res, 200, {
    matter_id: m.matter_id,
    phase: m.phase,
    closed: true,
    closed_at: m.closed_at,
    outcome,
    fabrics_detached: false, // per RFC OQ3 — fabrics persist; not closed
    fabrics_referenced: m.fabrics.map((f) => f.resourceId),
    event_id: ev.id,
  });
}

/** ───────────────────────────────────────────────────────────────────────
 *  Router — dispatched from server.ts when pathSegs[2] === 'matters'.
 *  ─────────────────────────────────────────────────────────────────────── */
export function routeMatters(
  store: Store,
  method: string,
  matterPathSegs: string[],
  principal: string | null,
  body: unknown,
  res: ServerResponse,
): boolean {
  // matterPathSegs are the segments after `/api/pact/matters/` —
  //   []                                  → collection
  //   ['{id}']                            → single matter
  //   ['{id}', 'members']                 → member ops
  //   ['{id}', 'fabrics']                 → attach
  //   ['{id}', 'fabrics', '{resourceId}'] → detach
  //   ['{id}', 'messages']                → side-channel
  //   ['{id}', 'manifest']                → cross-fabric manifest
  //   ['{id}', 'close']                   → close

  if (matterPathSegs.length === 0) {
    if (method === 'GET') {
      handleListMatters(store, res);
      return true;
    }
    if (method === 'POST') {
      handleOpenMatter(store, principal, body, res);
      return true;
    }
    return false;
  }

  const matterId = decodeURIComponent(matterPathSegs[0]);

  if (matterPathSegs.length === 1) {
    if (method === 'GET') {
      handleGetMatter(store, matterId, principal, res);
      return true;
    }
    return false;
  }

  const action = matterPathSegs[1];

  if (action === 'members' && matterPathSegs.length === 2 && method === 'POST') {
    handleAddMember(store, matterId, principal, body, res);
    return true;
  }

  if (action === 'fabrics' && matterPathSegs.length === 2 && method === 'POST') {
    handleAttachFabric(store, matterId, principal, body, res);
    return true;
  }

  if (action === 'fabrics' && matterPathSegs.length === 3 && method === 'DELETE') {
    handleDetachFabric(
      store,
      matterId,
      decodeURIComponent(matterPathSegs[2]),
      principal,
      res,
    );
    return true;
  }

  if (action === 'messages' && matterPathSegs.length === 2) {
    if (method === 'POST') {
      handlePostMessage(store, matterId, principal, body, res);
      return true;
    }
    if (method === 'GET') {
      handleListMessages(store, matterId, principal, res);
      return true;
    }
    return false;
  }

  if (action === 'manifest' && matterPathSegs.length === 2 && method === 'GET') {
    handleMatterManifest(store, matterId, principal, res);
    return true;
  }

  if (action === 'close' && matterPathSegs.length === 2 && method === 'POST') {
    handleCloseMatter(store, matterId, principal, body, res);
    return true;
  }

  return false;
}
