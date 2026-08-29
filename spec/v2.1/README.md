# PACT v2.1 — DRAFT / NOT FOR CITATION

> **This directory is a DRAFT.** It has **not** been signed off per
> AGENTS.md rule 3 and MUST NOT be cited, mirrored, or treated as stable.
> Cite **`spec/v2.0/`** (stable, v2.0.3) until this banner is removed by an
> explicit maintainer sign-off recorded below. Review vehicle:
> [#35](https://github.com/TailorAU/pact/issues/35).

## Sign-off record

| Event | Authority | Date |
|---|---|---|
| Draft opened (#35 authoring PR) | agent, per #35 `ready` | 2026-07-30 |
| Promotion to stable | *(pending — requires explicit maintainer sign-off)* | — |

## What v2.1 contains

A carry-forward of the stable **v2.0.3** body plus four new normative
sections, authored from the RFC
[#14](https://github.com/TailorAU/pact/issues/14) verdict
(ACCEPT-WITH-MODIFICATIONS, 2026-05-16; window closed 2026-05-26):

- **§19 Parleys** — ephemeral, time-bounded negotiation between 2–5 agents;
  peer-to-peer with opt-in facilitator (D5); outcomes advisory by default
  with opt-in binding requiring per-handler §17.6 proofs (SOQ4).
- **§20 Mandates** — handler-signed capability grants; RFC 8785 canonical
  signing; per-operation verification; immediate revocation (ratified Q1).
- **§21 Push Delivery** — signed event webhooks, at-least-once, per-event
  idempotency, 24 h retry then dead-letter; carries Mandate escalation
  hooks (T3+T4 ship together per the verdict).
- **§22 Service-Account Authentication** — the v1.1 invite-token scoped
  `apiKey` promoted to a first-class auth mode with
  create/rotate/revoke/scope-narrow lifecycle, including per-mandate scoping.

From v2.1 the backronym is **Contexture and Trust** (AGENTS.md); shipped
v2.0.x stays "Consensus and Truth" as released. Acronym and `pact*`
identifiers unchanged.

**Not in this directory:** §24 Matters — that lives in `spec/v2.2/` and
folds together with §19–22 in the planned v2.2 re-issue (see
`spec/v2.2/README.md`, "Known scope gap").

## File map

| Path | Content |
|---|---|
| `SPECIFICATION.md` | v2.0.3 body + §19–22 (DRAFT banner at top); carried-body edits: §5/§17.6 Parley renames, §6.1 envelope widened for `pact-parley`, §6.2 events, §15.1 flags, Appendix A.1/A.2 |
| `schemas/` | v2.0 schemas + 10 new (`$id` …/v2.1/…): `mandate.json`, `parley-create-request/-response.json`, `parley-accept-request/-response.json`, `parley-outcome.json`, `subscription-create-request.json`, `event-delivery.json`, `dead-letter-record.json`, `service-account-create-request.json`; plus `event.json` modified in place (`$id` bumped to v2.1: `pact-parley` entityType, per-entity sequencing, hyphenated event namespaces) |
| `conformance/` | v2.0 vectors + `extended/mandate-mcp/` (12 `kind: mandate` vectors); `test-vector-format.yaml` version "2" (adds `kind: mandate`, declares `notes:`); runner skips `kind: mandate` with a stated reason; README rewritten for v2.1 |
| `resource-types.yaml`, `GETTING_STARTED.md` | unchanged from v2.0 |

## Conformance claims

None yet. The `kind: mandate` vectors are mirrored by the passing
`@pact-protocol/mcp` test suites (`mcp/test/mandate.test.mjs`,
`mcp/test/wire.test.mjs`); no conformance runner executes `kind: mandate`
vectors yet, and CI does not run the v2.1 conformance tree. Implementations
MUST NOT claim v2.1 conformance while this directory is a draft.

## Known open questions and draft decisions (tracked in SPECIFICATION.md §19.10)

- Facilitator authority beyond close; predecessor-chain transitivity;
  Parley-scoped subscriptions; in-Parley schema variants.
- **Draft decision flagged for sign-off:** §19.3.1 refuses a `commitment`
  open when the *opener's own* Mandate cannot complete it — a narrow
  divergence from a maximal reading of ratified Q2 (which governs
  counterparty shortfalls, handled open-with-deadlock per §19.3.2).
- §20.2 — the Mandate wire field `session_id` retains its RFC #14 name for
  compatibility with the shipped `au.tailor.pact/mandate` reference
  implementation; whether to rename it `parley_id` at v2.1 freeze is a
  maintainer call for sign-off.
- **Reference-implementation drift to reconcile at sign-off:** the shipped
  `@pact-protocol/mcp` guard predates this draft's SOQ2 expiry grace
  (it judges `expires_at` absolutely) and does not yet require
  `identity_claim`/`alg` in carried mandates — both tracked as follow-ups.

## History

| Event | Ref |
|---|---|
| RFC #14 verdict (Parleys + Mandates) | [#14](https://github.com/TailorAU/pact/issues/14), `docs/v2-prep/rfc-14-shepherd-synthesis.yaml` |
| Mandate MCP extension design record + reference implementation | `docs/v2-prep/rfc-mcp-mandate-extension.md`, PRs #40 / #42 |
| This draft | #35 authoring PR *(number recorded on open)* |

Cite this directory as **nothing** until sign-off; cite `spec/v2.0/` as
"PACT v2.0.3".
