# PACT family — protocol, human-end, org engagement

> **Status:** Internal doctrine (Knox direction, 2026-08-09).  
> **Not normative PACT spec text.** Does not change `spec/**`.  
> **Rule:** PACT and HMAN remain separate artifacts. Do not merge the HMAN repo into PACT. Do not let the specification assume HMAN.

## Thesis

Intelligence that can sense, understand and act, under **human authority**.  
PACT is how authority, challenge, agreement and provenance travel on the wire.  
.HMAN is how a person holds and attests that authority locally.  
Tailor + AINK is how an organisation engages people, pays them, and binds itself under named humans.

## Three artifacts (one family)

| Artifact | Role | Repo | License posture |
|----------|------|------|-----------------|
| **PACT** | Vendor-neutral wire protocol: `HumanPrincipal`, `authorization_proof`, fabrics, matters, mandates, agents | [TailorAU/pact](https://github.com/TailorAU/pact) | Software MIT; specification has copyright + patent grant ([SPEC-LICENSE.md](../SPEC-LICENSE.md)) |
| **.HMAN** | Personal sovereign attester / memory / consent device — reference implementation of §17 / §18 | [Tailor-AUS/Human-Managed-Access-Network](https://github.com/Tailor-AUS/Human-Managed-Access-Network) | MIT (anyone may run their own) |
| **Tailor People + AINK** | Org engagement (hire/fire), consideration (pay, equity), DOA policy, AU compliance adapters | [TailorAU/tailor-app](https://github.com/TailorAU/tailor-app) | Product (private) |

```
Human (one person)
  └── .HMAN (optional; believed universal) — local root, biometrics, consent, memory
        └── entities: Personal / Trade / Household / …     ← life layer (above PACT)
  └── HumanPrincipal (DID)                                 ← PACT identity (strictly 1:1)
        └── authorization_proof (voice, FIDO2, …)
              └── agentId(s) they operate                   ← PACT agents
                    └── Org fabrics / Matters / Tailor     ← work under that authority
                          └── AINK ledgers                 ← cash / equity journals
```

## Identity rules (load-bearing)

1. **One human → one `HumanPrincipal`.** Multi-persona / HMAN entities (Personal, Trade, Household) are **not** separate principals. PACT may carry an advisory `persona` claim; verifiers roll it up to the single `principal_id` (§17.4–17.5).
2. **`.HMAN` ≠ `HumanPrincipal`.** HMAN holds credentials and mints proofs. Other stacks (FIDO2-only, etc.) remain valid. Spec must interoperate without HMAN.
3. **`agentId` ≠ human.** Operator-of-record binding (§23) answers which human authorized the agent.
4. **Employers are not humans.** Orgs are not `HumanPrincipal`s. Org-binding authority is **application- and law-layer** (Tailor DOA). PACT `attestation_chain` is protocol delegation, not corporate power of attorney.
5. **Hiring / pay / equity are not protocol primitives.** They are engagement + consideration + ledger (see Tailor docs below).

## Human → Org

Use a Tailor **engagement** resource (offer → accept → active → terminate) on a Matter/fabric. Consequential steps attach `authorization_proof`. Cash and equity are consideration streams in AINK — not PACT message types.

Detail: [ENGAGEMENT_RESOURCE.md](https://github.com/TailorAU/tailor-app/blob/main/docs/architecture/ENGAGEMENT_RESOURCE.md) (Tailor product; not PACT normative).

## Org → Org (with human DOAs)

Use cross-organisation PACT (Authorization-Required), Mandates/Parleys, and Matters.  
**DOA** lives in Tailor: who may bind which legal entity for which act/amount. Every binding act still carries a human `authorization_proof`. Multi-human “DAO-style” approval is org policy quorum on top of proofs — not a HMAN merge into the spec.

Detail: [ORG_DOA_POLICY.md](https://github.com/TailorAU/tailor-app/blob/main/docs/architecture/ORG_DOA_POLICY.md) (Tailor product; not PACT normative).

## Worked example — Kate Corcoran (first employee)

1. **Org proposes** — Tailor Intelligence agent, under Knox as operator-of-record (DOA: may issue employment offers for TI), proposes engagement terms on an engagement fabric/Matter.
2. **Human accepts** — Kate attests accept via HMAN (or FIDO2) → `authorization_proof` on the accept event. Still one `HumanPrincipal` for Kate.
3. **Engagement active** — Tailor People records employment; AU adapters (FWIS given, TFN, super, WorkCover) run outside PACT.
4. **Consideration** — AINK pays fortnightly wages + SG; equity grants (if any) are separate consideration streams with board/ESS policy, still human-attested where required.
5. **Terminate** — either party’s attested act (or org DOA for dismissal) closes the engagement; provenance retained on the fabric/Matter.

No step requires HMAN to be inside the PACT repository.

## Explicit non-goals

- Merge HMAN source into `TailorAU/pact`
- Make `.HMAN` a normative dependency of the PACT specification
- Model employers as `HumanPrincipal`
- Put STP, super, WorkCover, or ESS into PACT core
- Treat Personal/Trade HMAN entities as separate PACT humans
- Optional packaging monorepo / docs umbrella that collapses normative boundaries

## Related

- [`AGENTS.md`](../AGENTS.md) — “deliberately separate artifacts”
- Spec §17–18, §23 (HumanPrincipal, attestation, agent↔operator)
- HMAN [VISION.md](https://github.com/Tailor-AUS/Human-Managed-Access-Network/blob/main/VISION.md) / [PROTOCOL.md](https://github.com/Tailor-AUS/Human-Managed-Access-Network/blob/main/PROTOCOL.md) multi-entity model (above PACT)
- Seam contract: [`docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml`](v2-prep/v2.0.4-voice-biometric-lockdown.yaml)
