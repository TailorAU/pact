# Discussion note: PACT in a multi-tenant whitelabel platform

> **Status:** Discussion draft — non-normative. Not spec text; no normative
> change is proposed here. Captures open questions for the Tailor team raised by
> the whitelabel platform direction.
> **Date:** 2026-06-16.
> **Related:** §15 (Implementation Profiles), §17 (Human Authorization Layer),
> §17.9 (Authorization-Required tier), §23 (Agent identity lifecycle), §24
> (Matter / multi-fabric), `GOVERNANCE.md`, `IMPLEMENTERS.md`.

## Context

The platform direction has shifted: rather than Tailor being a single product,
Tailor becomes a **whitelabel substrate** on which *any* organisation builds its
own tailored intelligence system. In that model PACT stops being "the protocol
Tailor uses internally" and becomes **the inter-organisation trading layer** —
the one thing every tenant relies on to exchange information safely, manageably,
and without leaking either side's private context.

This note records (a) why PACT already supports that model, and (b) the open
questions the whitelabel direction forces — separating genuine *spec gaps* from
*deployment decisions* the spec deliberately leaves to the implementation.

## Tenancy topology (the thing to pin down)

```
        Tenant A (org)                                   Tenant B (org)
   ┌──────────────────────┐                         ┌──────────────────────┐
   │ private context,     │                         │ private context,     │
   │ reasoning, data      │                         │ reasoning, data      │
   │   ┌────────────┐     │      shared resource     │   ┌────────────┐     │
   │   │ A's agents │─────┼───────┐        ┌─────────┼───│ B's agents │     │
   │   └────────────┘     │       ▼        ▼         │   └────────────┘     │
   │   §17 authz layer?   │   ┌──────────────────┐   │   §17 authz layer?   │
   └──────────────────────┘   │  PACT fabric /   │   └──────────────────────┘
                              │  event log       │
        who custodies ───────▶│  (coordination,  │◀─────── who custodies
        this, and who         │   never content) │
        can read its          └──────────────────┘
        metadata?
```

The protocol guarantees the log never holds either tenant's *content*. It does
**not**, by itself, decide who hosts the log, who roots trust, or what each side
can infer from the coordination *metadata*. Those are the questions below.

## Why PACT already fits the model

The "trade without leaking either side's context" property is concrete spec
machinery, not aspiration:

| Whitelabel requirement | PACT mechanism | Spec |
|---|---|---|
| Substrate never sees tenant content | PACT coordinates; it never holds the resource content | Design principle |
| Reveal a limit without revealing the reasoning | Constraint primitive (`X must not exceed $2M`, no *why*) | Core |
| Control what one tenant sees *about* another | Information barriers + 4-level Graduated Disclosure | Extended |
| Cross-org trades are authenticated + accountable | `authorization_proof` REQUIRED on cross-org messages | §17.9 (Authorization-Required) |
| A tenant doesn't expose a stable identity surface | Per-task `agentId` minting / rotation | §23 |
| Tamper-evident, independently verifiable log | Per-event `prev_hash` chaining + signed log root | §6 / §15.1 `logSigningKey` |

So the value proposition lands at the **Extended → Authorization-Required**
tier. Anything below that and the safety properties become opt-in.

## Open questions for the Tailor team

Tagged **[deployment]** (implementation choice the spec leaves open) or
**[spec gap]** (possibly under-specified in the normative text — worth a
decision record / RFC).

### Q1 — Trust root: per-tenant or shared authorization layer? **[deployment, high stakes]**

Each tenant needs a credential / principal registry (§17.4 `HumanPrincipal` is
1:1; `principal-registry` schema). Does **each tenant run its own** §17
authorization layer (HMAN-style, sovereign), or does **Tailor run one shared
registry** for all tenants?

- Shared → Tailor becomes the trust root for everyone, colliding with the
  `GOVERNANCE.md` "no privileged control / no privileged core treatment" charter
  and weakening "no leak from either side."
- Per-tenant → how do two tenants' registries establish cross-trust for a
  single trade (federation, mutual attestation, a discovery mechanism)?

**This answer decides whether the platform is structurally neutral or only
nominally neutral.** It also interacts with open issue #17 (custodial
neutrality is a tracked gap).

### Q2 — Fabric custody and independent verifiability. **[deployment]**

When Tenant A and Tenant B trade over a shared resource, **whose server hosts
the event log?** Whoever custodies it sees the coordination *metadata* even if
never the content (see Q5). v2.2 added `prev_hash` chaining and signed log
roots — can each tenant **independently verify and export** the chain so they
are not trusting the host's word for what happened? That is the line between
"manageable" and "trust-me."

### Q3 — Conformance-tier floor for inter-tenant trade. **[deployment]**

§17.9 requires `authorization_proof` on cross-organisation messages only at
**Authorization-Required**. Will tenants be *required* to run at that tier to
trade across the boundary, or can a Core-tier tenant participate? If the floor
is Core, the safe/accountable property is opt-in. Recommend: cross-tenant
trades MUST be Authorization-Required, advertised + checkable via the §15.5
tier probe.

### Q4 — Scope of "humans always win" across the tenant boundary. **[spec gap]**

Core principle: any human can override any agent decision at any time. Within
one fabric that is clean. Across tenants it needs scoping the spec does not
clearly pin: **Tenant A's human must be able to override A's positions but NOT
B's.** What binds override authority to the principal/tenant that owns the
position? Unscoped, "humans always win" becomes a cross-tenant attack surface
(A's operator vetoing B's agents). Candidate for a normative clarification:
override is authoritative only over events authored under the overriding
principal's own authorization root.

### Q5 — Metadata side-channel between *competing* tenants. **[spec gap]**

"No context leak from either side" holds for *content* — PACT never holds it.
But the coordination log leaks *signal*: which sections a tenant scored high
**salience** on, what it **objected** to, response **timing**, who **joined**.
Between competing tenants that is inferable context. Graduated Disclosure
governs what agents see *about each other*; the open questions are: **what is
the default disclosure level between two tenants, who sets it** (each tenant vs
a platform default), and **does the salience/objection/timing metadata fall
under a barrier or travel in the clear?** A leaky default quietly undermines the
whole pitch. Worth analysing whether §-level guidance on metadata minimisation
between mutually-distrusting principals is needed.

### Q6 — Does whitelabel ever produce a non-Tailor implementation? **[strategic]**

`IMPLEMENTERS.md` wants a second implementation *not built by Tailor* to prove
vendor-neutrality. If every tenant runs on Tailor's substrate, the model
demonstrates cross-**tenant** interop but not cross-**vendor** neutrality —
different claims. Decide whether neutrality stays a *charter* property
(governance) or gets *demonstrated* by standing up / inviting an independent
implementation. Keep external messaging precise about which claim is being made
until #17 closes.

## Summary

- The model is **supported today** at Extended → Authorization-Required; the
  governance charter (Tailor gets no privileged treatment) is a *feature* for
  the whitelabel pitch, not fine print.
- Most questions are **deployment decisions** (Q1–Q3, Q6) — they need an
  explicit, recorded choice, not new spec text.
- Two are **possible spec gaps** worth a decision record / RFC:
  **Q4 (override scoping across tenants)** and **Q5 (metadata side-channel
  between competing tenants)**. Neither should be freehanded into `spec/**` —
  they route through the normal RFC + maintainer-sign-off flow per `AGENTS.md`.

## Next actions (proposed, not taken)

1. Get the Q1 answer from the Tailor team — it gates everything else.
2. If Q4/Q5 are confirmed as gaps, open `rfc` issues and draft against them here
   in `docs/v2-prep/` before any normative change.
3. Pin the inter-tenant tier floor (Q3) into the platform's onboarding contract.
