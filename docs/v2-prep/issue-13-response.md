Thanks for filing this — eight questions from a real Stage-0 deployment is exactly the kind of feedback that shapes v2 well.

I've drafted a consolidated v2 plan that addresses all eight questions: [`docs/v2-plan.yaml`](https://github.com/TailorAU/pact/blob/main/docs/v2-plan.yaml). Here's how each maps to a v2 track:

| # | Question | v2 track | Resolution direction |
|---|---|---|---|
| Q1 | Self-approval — configurable or hard? | T3 (Sessions) + T6 (legacy) | **Sessions sidestep this entirely** — no approval step exists. For legacy long-lived resources, T6 adds a per-resource `allowSelfApproval` flag (default `false`); recommended pattern stays `ObjectionBased` policy. |
| Q2 | Service-account auth | T5 | Formalising the v1.1 invite-token flow as a first-class auth mode. Scoped, rotatable, daemon-shaped. The scoped `apiKey` you already get from `join-token` is essentially this; v2 makes it explicit with lifecycle endpoints. |
| Q3 | Attached-document share visibility | T8 | Currently Tailor-specific; D2 in the plan asks whether this stays in v2 core or splits to a Tailor extension. Direction: extension. |
| Q4 | `--section` targeting attached docs | T8 | Same — D2 governs whether v2 core covers this. |
| Q5 | `--weight` / `--type` semantics | T8 | T8 spells out what each field does at the protocol layer versus being documentary. Likely outcome: `--weight Mandatory` becomes protocol-enforced (blocks merge until satisfied); `--type` stays documentary. Subject to D2. |
| Q6 | Webhook out | T4 | New push-delivery track. Per-resource subscriptions, signed event envelopes, at-least-once delivery with idempotency. Slack / PagerDuty / control-plane consumers are the headline use case. |
| Q7 | Agent identity persistence + transfer | T7 (phase 0) | Owns the identity lifecycle, including hostile / non-cooperative operator transfer via M-of-N recovery — directly motivated by your sovereignty posture ("operator-of-record can change without losing identity continuity"). |
| Q8 | Spec + reference impl + conformance | T9 + T11 | Public conformance test suite + canonical `docs/IMPLEMENTERS.md`. You offered to PR `docs/IMPLEMENTERS.md` — taking that offer; once the conformance scaffold lands in phase 0, AloomU's onboarding can be the first listed implementer. |

The plan also introduces new shape that wasn't in your questions but solves them collectively:

- **T3 PACT Sessions** — ephemeral, bilateral negotiation with handler-signed Mandates. RFC at [`docs/v2-prep/rfc-sessions-mandate.md`](https://github.com/TailorAU/pact/blob/main/docs/v2-prep/rfc-sessions-mandate.md). Resolves Q1 by removing the approval step entirely and Q6/Q7 by binding outcomes to handler-registered endpoints.
- **T1 Human Authorization Layer + W3C DIDs** — promotes v1.2 §17 to normative with DID-based principal identity (`did:web` + `did:key` as required methods, pending decision D6).
- **T11 Reference CLI/MCP** — `@pact-protocol/cli` and `@pact-protocol/mcp` updated for full v2 coverage and unblocked for npm publish (closes #5).

Phase 0 (foundation: identity, authorization, attestation, hygiene + conformance scaffold) opens once decisions D1, D4, D5, D6 are called. Once that's done, normative work starts in parallel across T1, T2, T7, T10.

Offer: keep AloomU's unrealestate.au deployment as a reference for v2 validation — your cutover criterion ("30 consecutive days without P0 spec-disagreement issues + onboarding playbook annotated against final v2") is baked into the plan's cutover criteria.

— Knox / TailorAU
