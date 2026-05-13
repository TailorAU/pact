# RFC: Ephemeral negotiation Sessions with handler-signed Mandates

> **Status:** RFC — for discussion before normative spec text lands.
> **Target version:** PACT v2 (Section 19–20).
> **Owner:** Knox Hart.
> **Related issues:** #13 (Q1, Q6, Q7), #3 (voice-biometric), #4 (HumanPrincipal 1:N).
> **Source:** [docs/v2-plan.yaml](../v2-plan.yaml) Track T3.

## Problem

PACT v1.1 assumes a long-lived shared **resource** (document, transaction, fact, record). Agents join the resource, declare intents and constraints, propose changes, and consensus emerges over time. This model works well for collaborative authoring but is heavyweight for bounded negotiation between two or more agents on a specific topic.

Three concrete gaps surface from production use:

1. **#13 Q1 (self-approval)** — when two agents operate under one human principal, the approval flow rejects any cross-agent approval. AloomU hit this in their inaugural deployment.
2. **#13 Q6 / Q7 (escalation routing)** — agents currently escalate to "whoever is watching the resource," not back to the specific human session that spawned them. No protocol-level binding between an agent and the operator's session.
3. **Bilateral negotiation shape** — many real use cases are "have my agent talk to that agent for 5 minutes about this specific thing," not "join a persistent fabric." Today there is no PACT shape for that.

## Proposal

Add a new **PACT Session** mode to v2 — ephemeral, time-bounded, bilateral or small-N. Sessions complement (do not replace) the resource model.

Each agent enters a Session with a **Mandate** — a handler-signed capability grant defining the negotiating envelope. The Mandate is generated *before* the Session opens, encodes what the agent may publish, must respect, may commit to, and may disclose, and is enforced by the PACT server on every operation.

### Session lifecycle

```
Handler A                              PACT Server                              Handler B
   │                                        │                                        │
   │── POST /api/pact/sessions ────────────▶│                                        │
   │   { purpose, ttl, mandate }            │                                        │
   │◀── { sessionId, peerInviteUrl } ──────│                                        │
   │                                        │                                        │
   │─── peerInviteUrl (out-of-band) ────────────────────────────────────────────────▶│
   │                                        │                                        │
   │                                        │◀── POST /sessions/{id}/accept ─────────│
   │                                        │   { mandate }                          │
   │                                        │── { sessionId, joinToken } ──────────▶│
   │                                        │                                        │
   │── hand joinToken to Agent A ───┐       │       ┌── hand joinToken to Agent B ──│
   │                                ▼       │       ▼                                │
   │                            [Agent A    │   Agent B]                             │
   │                                ▲       │       ▲                                │
   │                                ├── negotiate within mandate envelopes ──┤        │
   │                                │       │       │                                │
   │                                ▼       │       ▼                                │
   │                            session.closed (aligned | deadlocked | timeout)      │
   │                                        │                                        │
   │◀── outcome posted to escalation_hook ──┴── outcome posted to escalation_hook ──▶│
```

### Mandate primitive

```json
{
  "mandate": {
    "version": "1",
    "session_id": "sess_xyz",
    "agent_id": "agent_abc",
    "handler_principal_id": "did:web:knox.example",
    "identity_claim": "this agent represents Knox on API contract negotiation",
    "constraint_envelope": {
      "may_publish": ["interface", "performance", "security"],
      "must_respect": [
        { "boundary": "no breaking changes to event v1 schema" },
        { "boundary": "p99 latency < 200ms" }
      ]
    },
    "commitment_authority": {
      "max_binding_decisions": 1,
      "binding_scope": "interface contract draft"
    },
    "disclosure_ceiling": 2,
    "escalation_hook": "https://my-relay.example/agent_abc/escalations",
    "expires_at": "2026-05-12T18:00:00Z",
    "signature": "base64url-...",
    "signing_key_id": "did:web:knox.example#key-1"
  }
}
```

Field semantics:

- **identity_claim** — human-readable assertion of what the agent represents
- **constraint_envelope** — pre-loaded intents/constraints; agent CAN publish more, but only in `may_publish` categories
- **commitment_authority** — caps on irreversible decisions; exceeding triggers escalation
- **disclosure_ceiling** — max graduated-disclosure level (1–4 from §10.3); agent cannot reveal beyond this
- **escalation_hook** — push endpoint (T4) where the server delivers outcomes and mandate-violation events
- **signature** — handler's signature over the mandate body; verified by the server at session-open

### Why this works for the three gaps

| Gap | How Sessions solve it |
|---|---|
| #13 Q1 self-approval | No approval step exists in Sessions. Outcome is reported back to each handler, who decides what to do with it. Self-approval as a concept doesn't apply. |
| #13 Q6/Q7 routing | The handler's `escalation_hook` is the structural binding. Outcome flows back to the URL the handler registered, not to a generic resource inbox. |
| Bilateral shape | Sessions ARE the bilateral shape. Two handlers handshake out-of-band, two agents negotiate in-band, session closes, outcome goes home. |

## Open design questions

These need resolution before normative text lands.

1. **Mandate revocation mid-session.** Handler revokes — does the session hang up immediately, or finish the current round?
   - Proposal: immediate hang-up with `pact.session.closed { outcome: "mandate_revoked" }`. Finishing current round risks the agent committing under an authority that no longer exists.

2. **Mandate intersection at session-open.** Handler A says "must reach a price decision," Handler B says "no price commitments today." Does the session refuse to open, or open with explicit deadlock?
   - Proposal: open with deadlock outcome attached. Agents see the conflict, can renegotiate scope or escalate. Refusing-to-open hides the disagreement; opening-with-deadlock surfaces it.

3. **Outcome binding.** Are session outcomes binding on the handlers, or advisory?
   - Proposal: advisory by default. Opt-in `outcome_binding: "commitment"` flag elevates a specific outcome to binding (requires both handlers to pre-authorize in the mandate). Otherwise we've reinvented contracts via API.

4. **Carry-forward.** Can a session reference a predecessor (round 2 of negotiation), or is each session strictly islanded?
   - Proposal: islanded by default with optional `predecessor_session_id` field. Privacy-preserving default with escape hatch for multi-round negotiations.

5. **Mediator presence.** Sessions peer-to-peer with optional facilitator, or always-mediated?
   - This is **decision D5** in v2-plan.yaml — resolved at the charter level before this RFC converges.

6. **Clock skew.** Session TTL is bounded by whose clock?
   - Proposal: server's clock is authoritative. Mandate `expires_at` is in server time. Out-of-spec clock drift > 30s causes session refusal.

## Relationship to existing primitives

- **Generalises v1.2 §17 `authorization_proof`.** Authorization proof attests "human authorized *this specific message*." Mandate attests "human authorized *this agent to operate within these bounds for this session*." Same trust chain, broader temporal scope.
- **Complements Resources (§3–§12).** Long-lived collaboration → Resource. Bounded negotiation → Session. Both supported in v2.
- **Reuses Push Delivery (T4) for `escalation_hook`.** The hook is a per-mandate webhook; T4 standardises the signed event delivery format.
- **Reuses Service-Account Auth (T5) for handler-side automation.** Handlers can mint mandates programmatically via service-account credentials.

## Conformance impact

- **Core**: Sessions OPTIONAL. Core implementations may run resource-only.
- **Extended**: SHOULD support Sessions; MUST enforce mandate envelopes if Sessions are advertised in the Implementation Profile.
- **Authorization-Required**: MUST require valid handler signature on every Mandate (no anonymous Sessions across organisations).

## Non-goals

- **Mediated Sessions as a separate resource type.** Considered (D5 option B/C) but deferred. If demand materialises, v2.1 ships `MediatedSession` resource type with §13 Mediator role baked in.
- **Outcome → automatic resource creation.** Sessions don't auto-create downstream resources. Handler decides what to do with the outcome.
- **Multi-party Sessions beyond small-N.** Sessions are designed for 2–5 agents. Larger negotiations should use a long-lived Resource.

## Implementation references

- Mandate enforcement reference algorithm: TBD in normative §20.
- Test vectors: TBD in `spec/v2/conformance/sessions/`.
- Reference CLI / MCP coverage: T11 deliverable.

## Asks for reviewers

1. Validate the three-gap claim — are Sessions actually the right shape for #13 Q1/Q6/Q7?
2. Flag any concerns with the Mandate field shape (especially `disclosure_ceiling` and `commitment_authority`).
3. Weigh in on the six open design questions above, particularly mandate revocation (Q1) and outcome binding (Q3).
4. Confirm or contest the non-goals.

Open for comment for 14 days from this RFC's posting date. After convergence, normative text lands in spec/v2/SPECIFICATION.md §19 and §20.
