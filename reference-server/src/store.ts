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

const SPEC_VERSION = '2.0.3';

export class Store {
  private fabrics = new Map<string, Fabric>();
  private idCounter = 0;

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter.toString(36)}${Date.now().toString(36)}`;
  }

  getFabric(id: string): Fabric | undefined {
    return this.fabrics.get(id);
  }

  /** Get or lazily create an empty fabric (the conformance vectors POST to
   * fabrics that "exist" per their preconditions; the runner does not seed,
   * so an empty fabric is materialised on first reference). */
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

  reset(): void {
    this.fabrics.clear();
    this.idCounter = 0;
    seedFixtures(this);
  }

  registerFabric(f: Fabric): void {
    this.fabrics.set(f.fabric_id, f);
  }
}

/**
 * Deterministic fixtures for the read-only conformance vectors whose
 * preconditions assume pre-seeded fabric state the runner does not plant
 * (`heartbeat-timeout`, `manifest-cross-org-disclosure`, `obligation-surfacing`).
 * Each vector's `preconditions.server_state.resource_id` names the fabric;
 * the runner treats preconditions as documentation, so the server self-seeds
 * these well-known fabric IDs at startup.
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
