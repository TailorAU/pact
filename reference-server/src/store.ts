/**
 * In-memory state model for the PACT reference server.
 *
 * This is deliberately minimal — it exists to make the v2.0 conformance
 * suite's server-bound vectors executable and to be a second independent
 * implementation, not to be production. No persistence, no DB, no auth
 * beyond what a conformance vector exercises.
 *
 * The shapes here follow spec/v2.0/SPECIFICATION.md §4.1, §4.4, §6.5,
 * §15.6 and §17.13. Where a field is additive (not in the normative
 * response example but not forbidden — the spec response examples are
 * non-exhaustive `subset` shapes), it is marked so in a comment.
 */

export type Phase = 'forming' | 'negotiating' | 'converged' | 'escalated' | 'closed';
export type Liveness = 'live' | 'stale';

/** A published constraint (§4.4.5 / §10.3). */
export interface Constraint {
  constraint_id: string;
  sectionId: string;
  boundary: string;
  category?: string;
}

/** Pending obligation — §6.5 `pending-obligation.json` shape. */
export interface Obligation {
  id: string;
  fabric_id: string;
  member_id: string;
  /** principal that owes the action — used for caller-scoping the manifest. */
  principal_id: string;
  kind: 'vote' | 'respond' | 'sign' | 'ack';
  event_ref: string;
  created_at: string;
  due_by?: string;
  discharged_at: string | null;
  discharge_kind: 'fulfilled' | 'superseded' | 'timed_out' | 'escalated' | null;
  discharge_event_ref: string | null;
}

export interface Member {
  agent_id: string;
  agent_name: string;
  principal_id: string;
  /** registrable-domain (eTLD+1) for the §15.4 cross-org determination. */
  org_eTLD_plus_1: string;
  role: string;
  trust_level: string;
  joined_at: string;
  /** ISO 8601 — when the server last heard from this member (§4.1 / §4.4.3). */
  last_seen: string;
  last_heartbeat_seq: number;
  attention_required: boolean;
  /** §10.3 graduated disclosure level applied to cross-org peers. */
  disclosure_level: 'full' | 'summary' | 'constraint' | 'category';
  constraints: Constraint[];
  /** caller contact metadata — PII, elided cross-org per §17.13. */
  contact?: { email?: string; escalation_hook?: string };
}

export interface PactEvent {
  id: string;
  event_type: string;
  epochMs: number;
  sequenceNumber: number;
  actorId: string;
  actorKind: string;
  payloadJson: Record<string, unknown>;
  correlationId?: string;
}

export interface Proposal {
  id: string;
  status: 'open' | 'approved' | 'rejected' | 'withdrawn';
  required_voters: string[];
  voted_by: string[];
  due_by?: string;
}

export interface Fabric {
  fabric_id: string;
  spec_version: string;
  phase: Phase;
  members: Member[];
  obligations: Obligation[];
  proposals: Proposal[];
  events: PactEvent[];
  /** policy ceilings used by _onboard constraint validation (§4.4.5 / §15.6). */
  policy: { max_disclosure_ceiling: number };
  /** §4.4.1 staleness threshold — additive (spec §4.1 line 183 references staleness). */
  heartbeat_timeout_seconds: number;
  /** server "now" override used only by deterministic fixtures. */
  clock_iso?: string;
  seq: number;
}

// ─── Matter (v2.2 draft — docs/v2-prep/matters-spec-draft.md) ──────────────
// A Matter is a long-lived container that groups N peer fabrics under a
// shared participant set, exposes a typed side-channel, and surfaces a
// cross-fabric manifest. Per the RFC at docs/v2-prep/rfc-matters-multi-fabric.md
// the leans implemented here:
//   - a fabric MAY belong to multiple Matters (no exclusivity)
//   - Matter membership is eligibility, NOT automatic fabric enrollment
//   - closing a Matter does NOT close the attached fabrics
// Identity and disclosure all reuse §17 / §23 / §17.13 — no new primitive.

export type MatterPhase = 'open' | 'active' | 'closed';

export interface MatterMember {
  principal_id: string;
  display_name: string;
  /** owner = can attach/detach + add members + close; participant = can post + read. */
  role: 'owner' | 'participant';
  joined_at: string;
  /** registrable-domain (eTLD+1) for §17.13 cross-org reduction. Cached for speed. */
  org_eTLD_plus_1: string;
}

export interface MatterFabricAttachment {
  resourceId: string;
  attached_at: string;
  attached_by: string;
}

/** A typed side-channel message — the wire shape for `pact.matter.message`.
 * Per the RFC (maintainer call 2026-05-24): TYPED EVENTS ONLY, no chat-product
 * surface. UIs MAY render as chat; the wire format is structured events. */
export interface MatterMessage {
  id: string;
  sender_principal: string;
  posted_at: string;
  body: {
    /** `text` is the v0.1 format; `proposal-ref` / `obligation-ref` etc. land later. */
    format: 'text';
    content: string;
  };
  /** optional cross-link to a section of an attached fabric. */
  references?: { fabric_id: string; section_id?: string };
}

export interface Matter {
  matter_id: string;
  spec_version: string;
  name: string;
  phase: MatterPhase;
  members: MatterMember[];
  fabrics: MatterFabricAttachment[];
  messages: MatterMessage[];
  events: PactEvent[];
  opened_at: string;
  opened_by: string;
  closes_at: string | null;
  closed_at: string | null;
  seq: number;
}

export interface ConformanceStateSetup {
  accepted: boolean;
  matterStateApplied: boolean;
}

const SPEC_VERSION = '2.0.3';
const MATTERS_DRAFT_VERSION = '2.2';

// Local re-implementation of the §15.4 registrable-domain helper, to avoid a
// store.ts ↔ disclosure.ts circular dep. Same last-two-labels heuristic the
// reference disclosure module uses (production needs the Public Suffix List).
function registrableDomainFromPrincipal(principalId: string): string {
  const m = /^did:web:([^/]+)/.exec(principalId);
  const host = m ? m[1] : principalId;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  return labels.slice(-2).join('.');
}

export class Store {
  private fabrics = new Map<string, Fabric>();
  private matters = new Map<string, Matter>();
  private idCounter = 0;

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter.toString(36)}${Date.now().toString(36)}`;
  }

  getFabric(id: string): Fabric | undefined {
    return this.fabrics.get(id);
  }

  // ─── Matter accessors (v2.2 draft) ─────────────────────────────────────

  getMatter(id: string): Matter | undefined {
    return this.matters.get(id);
  }

  listMatters(): Matter[] {
    return Array.from(this.matters.values());
  }

  createMatter(name: string, openedBy: string, openedByDisplay: string): Matter {
    const id = this.nextId('mtr');
    const now = new Date().toISOString();
    const ownerOrgETLD = registrableDomainFromPrincipal(openedBy);
    const m: Matter = {
      matter_id: id,
      spec_version: MATTERS_DRAFT_VERSION,
      name,
      phase: 'open',
      members: [
        {
          principal_id: openedBy,
          display_name: openedByDisplay,
          role: 'owner',
          joined_at: now,
          org_eTLD_plus_1: ownerOrgETLD,
        },
      ],
      fabrics: [],
      messages: [],
      events: [],
      opened_at: now,
      opened_by: openedBy,
      closes_at: null,
      closed_at: null,
      seq: 0,
    };
    this.matters.set(id, m);
    return m;
  }

  registerMatter(m: Matter): void {
    this.matters.set(m.matter_id, m);
  }

  /** Emit an event on a Matter (analogous to Fabric `emit`, separate sequence
   * domain so Matter and Fabric events do not collide on sequenceNumber). */
  emitMatter(
    m: Matter,
    eventType: string,
    actorPrincipal: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): PactEvent {
    m.seq += 1;
    const ev: PactEvent = {
      id: this.nextId('evt'),
      event_type: eventType,
      epochMs: Date.now(),
      sequenceNumber: m.seq,
      actorId: actorPrincipal,
      actorKind: 'AiAgent',
      payloadJson: payload,
      ...(correlationId ? { correlationId } : {}),
    };
    m.events.push(ev);
    return ev;
  }

  /** Get or lazily create an empty fabric. This remains useful for external
   * runner targets that prepare state out of band; the repository CI harness
   * now overlays each vector's declared state through `POST /__reset`. */
  ensureFabric(id: string): Fabric {
    let f = this.fabrics.get(id);
    if (!f) {
      f = {
        fabric_id: id,
        spec_version: SPEC_VERSION,
        phase: 'forming',
        members: [],
        obligations: [],
        proposals: [],
        events: [],
        policy: { max_disclosure_ceiling: 2 },
        heartbeat_timeout_seconds: 60,
        seq: 0,
      };
      this.fabrics.set(id, f);
    }
    return f;
  }

  emit(
    f: Fabric,
    eventType: string,
    actorId: string,
    actorKind: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): PactEvent {
    f.seq += 1;
    const ev: PactEvent = {
      id: this.nextId('evt'),
      event_type: eventType,
      epochMs: Date.now(),
      sequenceNumber: f.seq,
      actorId,
      actorKind,
      payloadJson: payload,
      ...(correlationId ? { correlationId } : {}),
    };
    f.events.push(ev);
    return ev;
  }

  mintId(prefix: string): string {
    return this.nextId(prefix);
  }

  reset(serverState?: unknown): ConformanceStateSetup {
    this.fabrics.clear();
    this.matters.clear();
    this.idCounter = 0;
    seedFixtures(this);
    return materializeServerState(this, serverState);
  }

  registerFabric(f: Fabric): void {
    this.fabrics.set(f.fabric_id, f);
  }
}

/**
 * Deterministic baseline fixtures for the read-only conformance vectors
 * (`heartbeat-timeout`, `manifest-cross-org-disclosure`,
 * `obligation-surfacing`). The required CI harness resets before every vector,
 * preserves these well-known fixtures, then fully overlays the compact Matter
 * state carried in a Matter vector's `preconditions.server_state`.
 */
export function seedFixtures(store: Store): void {
  // ── fab_hb_001 — heartbeat-timeout (§4.1, §4.4.1) ──────────────────────
  // Member A heartbeated 5s ago (live); member B silent 120s ago (stale,
  // past the 60s threshold). Server clock pinned so liveness is deterministic.
  {
    const now = '2026-05-15T12:00:00Z';
    const f: Fabric = {
      fabric_id: 'fab_hb_001',
      spec_version: SPEC_VERSION,
      phase: 'negotiating',
      members: [
        {
          agent_id: 'urn:pact:agent:alice',
          agent_name: 'alice-bot',
          principal_id: 'did:web:alice.example',
          org_eTLD_plus_1: 'alice.example',
          role: 'contributor',
          trust_level: 'Collaborator',
          joined_at: '2026-05-15T11:00:00Z',
          last_seen: '2026-05-15T11:59:55Z',
          last_heartbeat_seq: 10,
          attention_required: false,
          disclosure_level: 'full',
          constraints: [],
        },
        {
          agent_id: 'urn:pact:agent:bob',
          agent_name: 'bob-bot',
          principal_id: 'did:web:bob.example',
          org_eTLD_plus_1: 'bob.example',
          role: 'contributor',
          trust_level: 'Collaborator',
          joined_at: '2026-05-15T11:00:00Z',
          last_seen: '2026-05-15T11:58:00Z',
          last_heartbeat_seq: 4,
          attention_required: false,
          disclosure_level: 'full',
          constraints: [],
        },
      ],
      obligations: [],
      proposals: [],
      events: [],
      policy: { max_disclosure_ceiling: 2 },
      heartbeat_timeout_seconds: 60,
      clock_iso: now,
      seq: 0,
    };
    store.registerFabric(f);
  }

  // ── fab_xorg_001 — manifest-cross-org-disclosure (§4.4.2, §15.4, §17.13) ─
  // Two members on distinct registrable domains; no cross-org consent on
  // file, so member A sees B's display name only — B's contact, raw
  // constraints and obligations are reduced to counts.
  {
    const f: Fabric = {
      fabric_id: 'fab_xorg_001',
      spec_version: SPEC_VERSION,
      phase: 'negotiating',
      members: [
        {
          agent_id: 'urn:pact:agent:org-a',
          agent_name: 'alice-bot',
          principal_id: 'did:web:org-a.example',
          org_eTLD_plus_1: 'org-a.example',
          role: 'contributor',
          trust_level: 'Collaborator',
          joined_at: '2026-05-15T10:00:00Z',
          last_seen: '2026-05-15T11:59:00Z',
          last_heartbeat_seq: 7,
          attention_required: false,
          disclosure_level: 'full',
          constraints: [
            { constraint_id: 'con_a1', sectionId: 'rate-limit-per-minute', boundary: '30' },
          ],
          contact: {
            email: 'alice@org-a.example',
            escalation_hook: 'https://alerts.org-a.example/inbox',
          },
        },
        {
          agent_id: 'urn:pact:agent:org-b',
          agent_name: 'bob-bot',
          principal_id: 'did:web:org-b.example',
          org_eTLD_plus_1: 'org-b.example',
          role: 'contributor',
          trust_level: 'Collaborator',
          joined_at: '2026-05-15T10:00:00Z',
          last_seen: '2026-05-15T11:59:00Z',
          last_heartbeat_seq: 9,
          attention_required: false,
          disclosure_level: 'summary',
          constraints: [
            { constraint_id: 'con_b1', sectionId: 'rate-limit-per-minute', boundary: '60' },
            { constraint_id: 'con_b2', sectionId: 'disclosure-ceiling', boundary: '1' },
          ],
          contact: {
            email: 'bob@org-b.example',
            escalation_hook: 'https://alerts.org-b.example/inbox',
          },
        },
      ],
      obligations: [
        {
          id: 'obl_b1',
          fabric_id: 'fab_xorg_001',
          member_id: 'urn:pact:agent:org-b',
          principal_id: 'did:web:org-b.example',
          kind: 'vote',
          event_ref: 'prop_xyz',
          created_at: '2026-05-15T10:30:00Z',
          due_by: '2026-05-16T10:00:00Z',
          discharged_at: null,
          discharge_kind: null,
          discharge_event_ref: null,
        },
      ],
      proposals: [],
      events: [],
      policy: { max_disclosure_ceiling: 2 },
      heartbeat_timeout_seconds: 60,
      seq: 0,
    };
    store.registerFabric(f);
  }

  // ── fab_obl_001 — obligation-surfacing (§4.4.2, §6.5) ───────────────────
  // Member B owes a vote on an open proposal; the obligation must surface in
  // the manifest pre-vote and be discharged after the vote.
  {
    const f: Fabric = {
      fabric_id: 'fab_obl_001',
      spec_version: SPEC_VERSION,
      phase: 'negotiating',
      members: [
        {
          agent_id: 'urn:pact:agent:bob',
          agent_name: 'bob-bot',
          principal_id: 'did:web:bob.example',
          org_eTLD_plus_1: 'bob.example',
          role: 'proposer',
          trust_level: 'Collaborator',
          joined_at: '2026-05-15T10:00:00Z',
          last_seen: '2026-05-15T11:59:00Z',
          last_heartbeat_seq: 3,
          attention_required: false,
          disclosure_level: 'full',
          constraints: [],
        },
      ],
      obligations: [
        {
          id: 'obl_obl1',
          fabric_id: 'fab_obl_001',
          member_id: 'urn:pact:agent:bob',
          principal_id: 'did:web:bob.example',
          kind: 'vote',
          event_ref: 'prop_xyz',
          created_at: '2026-05-15T10:30:00Z',
          due_by: '2026-05-16T10:00:00Z',
          discharged_at: null,
          discharge_kind: null,
          discharge_event_ref: null,
        },
      ],
      proposals: [
        {
          id: 'prop_xyz',
          status: 'open',
          required_voters: ['did:web:bob.example'],
          voted_by: [],
          due_by: '2026-05-16T10:00:00Z',
        },
      ],
      events: [],
      policy: { max_disclosure_ceiling: 2 },
      heartbeat_timeout_seconds: 60,
      seq: 0,
    };
    store.registerFabric(f);
  }

  // fab_abc123 is left to lazy creation: both _onboard vectors (success +
  // partial-failure) target it with `registered_agents: []`, so an empty
  // fabric created on first reference is exactly the right precondition.
}

// ─── Non-normative conformance fixture materialisation ───────────────────

const FIXTURE_TIMESTAMP = '2026-05-15T12:00:00Z';
const KNOX_FIXTURE_PRINCIPAL = 'did:web:knox.example';

function fixtureObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fixtureObjects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = fixtureObject(item);
    return object ? [object] : [];
  });
}

function fixtureCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function fixtureFabricPhase(value: unknown): Phase {
  return value === 'forming' ||
    value === 'negotiating' ||
    value === 'converged' ||
    value === 'escalated' ||
    value === 'closed'
    ? value
    : 'forming';
}

function fixtureMatterPhase(value: unknown): MatterPhase {
  return value === 'active' || value === 'closed' ? value : 'open';
}

function materializeFabric(store: Store, state: Record<string, unknown>): void {
  const fabricId = typeof state.fabric_id === 'string' ? state.fabric_id : '';
  if (!fabricId) return;

  const proposalCount = fixtureCount(state.proposals_open);
  const pendingForKnox = fixtureCount(state.obligations_pending_for_knox);
  const proposals: Proposal[] = Array.from({ length: proposalCount }, (_, index) => ({
    id: `prop_fixture_${index + 1}`,
    status: 'open',
    required_voters: index < pendingForKnox ? [KNOX_FIXTURE_PRINCIPAL] : [],
    voted_by: [],
  }));
  const obligations: Obligation[] = Array.from({ length: pendingForKnox }, (_, index) => ({
    id: `obl_fixture_knox_${index + 1}`,
    fabric_id: fabricId,
    member_id: 'urn:pact:agent:knox',
    principal_id: KNOX_FIXTURE_PRINCIPAL,
    kind: 'vote',
    event_ref: proposals[index]?.id ?? `prop_fixture_pending_${index + 1}`,
    created_at: FIXTURE_TIMESTAMP,
    discharged_at: null,
    discharge_kind: null,
    discharge_event_ref: null,
  }));

  store.registerFabric({
    fabric_id: fabricId,
    spec_version: SPEC_VERSION,
    phase: fixtureFabricPhase(state.phase),
    members: [],
    obligations,
    proposals,
    events: [],
    policy: { max_disclosure_ceiling: 2 },
    heartbeat_timeout_seconds: 60,
    seq: 0,
  });
}

function materializeResource(store: Store, state: Record<string, unknown>): boolean {
  const resourceId = typeof state.resource_id === 'string' ? state.resource_id : '';
  if (!resourceId) return false;

  const existing = store.getFabric(resourceId);
  const fabric = store.ensureFabric(resourceId);
  if (state.phase !== undefined) fabric.phase = fixtureFabricPhase(state.phase);
  if (
    typeof state.heartbeat_timeout_seconds === 'number' &&
    Number.isFinite(state.heartbeat_timeout_seconds) &&
    state.heartbeat_timeout_seconds >= 0
  ) {
    fabric.heartbeat_timeout_seconds = state.heartbeat_timeout_seconds;
  }
  if (typeof state.server_clock === 'string') fabric.clock_iso = state.server_clock;

  const policy = fixtureObject(state.fabric_policy);
  if (
    policy &&
    typeof policy.max_disclosure_ceiling === 'number' &&
    Number.isFinite(policy.max_disclosure_ceiling)
  ) {
    fabric.policy.max_disclosure_ceiling = policy.max_disclosure_ceiling;
  }

  // The three richer legacy fixtures are already seeded with their complete,
  // deterministic member/proposal/obligation shapes. For a new resource,
  // materialise the compact identity list used by empty-session and §25
  // preconditions so the declared resource and principals genuinely exist.
  if (!existing && Array.isArray(state.registered_agents)) {
    fabric.members = state.registered_agents.flatMap((agent, index): Member[] => {
      const object = fixtureObject(agent);
      const principalId =
        typeof agent === 'string'
          ? agent
          : object && typeof object.principalId === 'string'
            ? object.principalId
            : '';
      if (!principalId) return [];
      return [{
        agent_id: `urn:pact:agent:fixture-${index + 1}`,
        agent_name:
          object && typeof object.agentName === 'string' ? object.agentName : principalId,
        principal_id: principalId,
        org_eTLD_plus_1: registrableDomainFromPrincipal(principalId),
        role: object && typeof object.role === 'string' ? object.role : 'contributor',
        trust_level: 'Collaborator',
        joined_at: FIXTURE_TIMESTAMP,
        last_seen:
          object && typeof object.last_seen === 'string' ? object.last_seen : FIXTURE_TIMESTAMP,
        last_heartbeat_seq: 0,
        attention_required: false,
        disclosure_level: 'full',
        constraints: [],
      }];
    });
  }

  return true;
}

function materializeMatter(store: Store, state: Record<string, unknown>): void {
  const matterId = typeof state.matter_id === 'string' ? state.matter_id : '';
  if (!matterId) return;

  const memberStates = fixtureObjects(state.members);
  const ownerState = memberStates.find((member) => member.role === 'owner') ?? memberStates[0];
  const openedBy =
    ownerState && typeof ownerState.principal_id === 'string'
      ? ownerState.principal_id
      : KNOX_FIXTURE_PRINCIPAL;
  const members: MatterMember[] = memberStates.flatMap((member) => {
    if (typeof member.principal_id !== 'string' || member.principal_id.length === 0) return [];
    const role: MatterMember['role'] = member.role === 'owner' ? 'owner' : 'participant';
    return [
      {
        principal_id: member.principal_id,
        display_name:
          typeof member.display_name === 'string' ? member.display_name : member.principal_id,
        role,
        joined_at:
          typeof member.joined_at === 'string' ? member.joined_at : FIXTURE_TIMESTAMP,
        org_eTLD_plus_1: registrableDomainFromPrincipal(member.principal_id),
      },
    ];
  });

  const fabrics: MatterFabricAttachment[] = fixtureObjects(state.fabrics).flatMap(
    (attachment) => {
      const resourceId =
        typeof attachment.resourceId === 'string'
          ? attachment.resourceId
          : typeof attachment.fabric_id === 'string'
            ? attachment.fabric_id
            : '';
      if (!resourceId) return [];
      store.ensureFabric(resourceId);
      return [
        {
          resourceId,
          attached_at:
            typeof attachment.attached_at === 'string'
              ? attachment.attached_at
              : FIXTURE_TIMESTAMP,
          attached_by:
            typeof attachment.attached_by === 'string' ? attachment.attached_by : openedBy,
        },
      ];
    },
  );

  const phase = fixtureMatterPhase(state.phase);
  store.registerMatter({
    matter_id: matterId,
    spec_version:
      typeof state.spec_version === 'string' ? state.spec_version : MATTERS_DRAFT_VERSION,
    name: typeof state.name === 'string' ? state.name : matterId,
    phase,
    members,
    fabrics,
    messages: [],
    events: [],
    opened_at:
      typeof state.opened_at === 'string' ? state.opened_at : FIXTURE_TIMESTAMP,
    opened_by: openedBy,
    closes_at: typeof state.closes_at === 'string' ? state.closes_at : null,
    closed_at:
      typeof state.closed_at === 'string'
        ? state.closed_at
        : phase === 'closed'
          ? FIXTURE_TIMESTAMP
          : null,
    seq: 0,
  });
}

/**
 * Accept the reference harness's compact `preconditions.server_state`
 * vocabulary. Matter + fabric fixture shapes are fully materialised. Generic
 * `resource_id` shapes receive the deterministic baseline/lazy resource setup
 * used by the older runner families; this is not a general state importer.
 */
export function materializeServerState(store: Store, serverState: unknown): ConformanceStateSetup {
  if (serverState === undefined || serverState === null) {
    return { accepted: true, matterStateApplied: false };
  }
  const state = fixtureObject(serverState);
  if (!state) return { accepted: false, matterStateApplied: false };

  let recognized = Object.keys(state).length === 0;
  let matterStateApplied = false;

  if (state.resource_id !== undefined) {
    if (!materializeResource(store, state)) return { accepted: false, matterStateApplied: false };
    recognized = true;
  }

  if (state.fabric !== undefined) {
    const singularFabric = fixtureObject(state.fabric);
    if (!singularFabric || typeof singularFabric.fabric_id !== 'string') return { accepted: false, matterStateApplied: false };
    materializeFabric(store, singularFabric);
    recognized = true;
  }
  if (state.fabrics !== undefined) {
    if (!Array.isArray(state.fabrics)) return { accepted: false, matterStateApplied: false };
    const fabrics = fixtureObjects(state.fabrics);
    if (fabrics.length !== state.fabrics.length || fabrics.some((fabric) => typeof fabric.fabric_id !== 'string')) {
      return { accepted: false, matterStateApplied: false };
    }
    for (const fabric of fabrics) materializeFabric(store, fabric);
    recognized = true;
  }

  if (state.matter !== undefined) {
    const singularMatter = fixtureObject(state.matter);
    if (!singularMatter || typeof singularMatter.matter_id !== 'string') return { accepted: false, matterStateApplied: false };
    materializeMatter(store, singularMatter);
    recognized = true;
    matterStateApplied = true;
  }
  if (state.matters !== undefined) {
    if (!Array.isArray(state.matters)) return { accepted: false, matterStateApplied: false };
    const matters = fixtureObjects(state.matters);
    if (matters.length !== state.matters.length || matters.some((matter) => typeof matter.matter_id !== 'string')) {
      return { accepted: false, matterStateApplied: false };
    }
    for (const matter of matters) materializeMatter(store, matter);
    recognized = true;
    matterStateApplied = true;
  }

  return { accepted: recognized, matterStateApplied };
}
