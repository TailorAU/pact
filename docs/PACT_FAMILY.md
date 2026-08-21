# PACT family doctrine

PACT is the **protocol**. Implementations and adjacent products stay in their own repos.

This file is the family map HMAN and Tailor agents already link. It is **not** normative spec text. Normative rules live in `spec/vX.Y/SPECIFICATION.md`.

## What PACT is

Open, vendor-neutral consensus protocol for agents and humans on a shared resource (documents, transactions, knowledge claims, matters). Propose, constrain, object, escalate. Humans always win. Financial or irreversible effects **fail closed** until a human attests (`authorization_proof`, §17).

MCP is hands. A2A is voices. PACT is the shared table.

Spec repo: this repository. Site: `https://pact.tailor.au` (knowledge graph). Implementers: [`IMPLEMENTERS.md`](../IMPLEMENTERS.md).

## What PACT is not

| Not this | That lives here |
|---|---|
| A payment rail or books product | AINK / Baink (`aink.tailor.au`, `TailorAU/tailor-app`, `TailorAU/baink.com.au`) |
| An inference market or “buy/sell intelligence” exchange | Sovrgn (`sovrgn.ai`, `TailorAU/sovrgn`) |
| A human signup / public handle registry | Nothing public. Local `.HMAN` enrol only (see below) |
| A Tailor product module | Tailor *implements* PACT; it does not own the protocol |

Do not merge implementation code into this repo. Do not write HMAN-only, AINK-only, or Sovrgn-only assumptions into normative spec text.

## Reference implementation of §17 / §18

**`.HMAN`** ([`Tailor-AUS/Human-Managed-Access-Network`](https://github.com/Tailor-AUS/Human-Managed-Access-Network)) is the MIT reference implementation of the Human Authorization Layer and attestation formats.

- Deliberately a **separate artifact**. Not merged into PACT.
- Registration is **local voice enrolment** on the member’s machine (`~/.hman/`). There is no public `register .hman` door and no handle namespace in this spec.
- How to enrol: [HMAN `docs/REGISTRATION.md`](https://github.com/Tailor-AUS/Human-Managed-Access-Network/blob/main/docs/REGISTRATION.md).

HMAN-co-designed surfaces (today: §18.3 `voice-biometric` crypto) land here only via reviewed spec change, per `AGENTS.md`.

## Adjacent products that *speak* PACT

These consume or implement PACT for their domain. They are not PACT.

| Product | Job | PACT use |
|---|---|---|
| **Tailor** | Document / cell collaboration | Reference content-layer impl (`document`, `fact`) |
| **AINK / Baink** | Ask for / record / settle money | `transaction` resource (design). Pay-asks are AINK, not PACT-the-product |
| **Sovrgn** | Buy / sell intelligence (inference market) | Does **not** implement PACT as a collaboration protocol. Uses its own JWS residency receipts. `sovrgn.ai/hman` is 404 — Sovrgn does not enrol humans |

Product-side map (Tailor monorepo): [`docs/architecture/AINK_PACT_SOVRGN_HMAN.md`](https://github.com/TailorAU/tailor-app/blob/main/docs/architecture/AINK_PACT_SOVRGN_HMAN.md).

## Agent rule

If a human asks “how do I register `.hman`?” — point them at local HMAN enrolment. Do not invent a PACT or Sovrgn signup. If they ask someone to pay — that is AINK, fail-closed in PACT until a human attests, and AINK does not itself click the bank.
