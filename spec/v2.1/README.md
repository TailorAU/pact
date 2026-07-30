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
| `SPECIFICATION.md` | v2.0.3 body + §19–22 (DRAFT banner at top) |
| `schemas/` | v2.0 schemas + 8 new: `mandate.json`, `parley-create-request/-response.json`, `parley-accept-request.json`, `parley-outcome.json`, `subscription-create-request.json`, `event-delivery.json`, `service-account-create-request.json` (`$id` …/schemas/v2.1/…) |
| `conformance/` | v2.0 vectors + `extended/mandate-mcp/` (12 `kind: mandate` vectors) ; `test-vector-format.yaml` bumped to version "2" adding `kind: mandate` |
| `resource-types.yaml`, `GETTING_STARTED.md` | unchanged from v2.0 |

## Conformance claims

None yet. The `kind: mandate` vectors are mirrored by the passing
`@pact-protocol/mcp` test suites (`mcp/test/mandate.test.mjs`,
`mcp/test/wire.test.mjs`); no conformance runner executes `kind: mandate`
vectors yet, and CI does not run the v2.1 conformance tree. Implementations
MUST NOT claim v2.1 conformance while this directory is a draft.

## Known open questions (tracked in SPECIFICATION.md)

- §19.10 — facilitator close authority; predecessor-chain transitivity.
- §20.2 — the Mandate wire field `session_id` retains its RFC #14 name for
  compatibility with the shipped `au.tailor.pact/mandate` reference
  implementation; whether to rename it `parley_id` at v2.1 freeze is a
  maintainer call for sign-off.

## History

| Event | Ref |
|---|---|
| RFC #14 verdict (Parleys + Mandates) | [#14](https://github.com/TailorAU/pact/issues/14), `docs/v2-prep/rfc-14-shepherd-synthesis.yaml` |
| Mandate MCP extension design record + reference implementation | `docs/v2-prep/rfc-mcp-mandate-extension.md`, PRs #40 / #42 |
| This draft | #35 authoring PR *(number recorded on open)* |

Cite this directory as **nothing** until sign-off; cite `spec/v2.0/` as
"PACT v2.0.3".
