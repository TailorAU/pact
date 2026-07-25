# PACT v2.1 — DRAFT

> ## ⚠️ DRAFT — NOT FOR CITATION
>
> This directory is **not** a released PACT version. It has **not** been
> promoted to stable and **MUST NOT** be cited, implemented against as a
> stable target, or mirrored to downstream consumers until a maintainer
> signs it off per [AGENTS.md](../../AGENTS.md) rule 3.
>
> The current stable versions are **v2.0** (`spec/v2.0/`, the v2.0.3 line)
> and **v2.2** (`spec/v2.2/`, the Matter line). Cite those.

## What v2.1 contains

- **All of v2.0.3** carried forward unchanged — every normative section,
  schema, conformance vector, runner, and the resource-types registry.
  `spec/v2.0/` itself remains **FROZEN** per AGENTS.md rule 4; this
  directory is a copy that adds §19–§22, not an edit of v2.0.
- **§19 Parleys** (NEW) — PACT's second interaction mode: ephemeral,
  time-bounded, small-N (2–5) negotiations between agents.
- **§20 The Mandate primitive** (NEW) — a handler-signed, §17-family
  capability grant that pins an agent's negotiating envelope, enforced by
  the server on every operation.
- **§21 Push Delivery** (NEW) — signed event webhooks, serving both the
  operations-alerting case and the Mandate `escalation_hook`.
- **§22 Service-Account Authentication** (NEW) — the scoped-key model
  promoted to a first-class auth mode with an explicit lifecycle.

12 new schemas, 11 new conformance vectors.

## Provenance

This directory lands RFC [#14](https://github.com/TailorAU/pact/issues/14)
(verdict **ACCEPT-WITH-MODIFICATIONS**; comment window closed 2026-05-26 with
zero external substantive objections) under charter decisions **D3=A** and
**D5=A**, tracked by issue [#35](https://github.com/TailorAU/pact/issues/35).

Design record — **non-normative**, but this text was authored against it and
every contested call traces back to it:

| Document | What it fixes |
|---|---|
| [`docs/v2-prep/rfc-sessions-mandate.md`](../../docs/v2-prep/rfc-sessions-mandate.md) | The original RFC draft |
| [`docs/v2-prep/rfc-14-shepherd-synthesis.yaml`](../../docs/v2-prep/rfc-14-shepherd-synthesis.yaml) | The verdict, modifications M1–M4, and OQ1–OQ6 rulings |
| [`docs/v2-prep/v2.1-scope.yaml`](../../docs/v2-prep/v2.1-scope.yaml) | Tracks T3/T4/T5, directory mechanics, the backronym decision |
| [`docs/v2-plan.yaml`](../../docs/v2-plan.yaml) | The v2 roadmap these tracks come from |

### How the required modifications were discharged

| # | Requirement | Where it landed |
|---|---|---|
| **M1** | Name the primitive so the bare word "Session" never denotes it | §19.2 terminology note + the three-way disambiguation table; §17.6 gets a v2.1 clarification binding "session mandate" to §20 |
| **M2** | Compose with v2.0.3, do not duplicate | §19.3 reuse table — Mandate is §17-family, state reuses the §4.4.2 manifest shape, rounds are §6.5 obligations, liveness is §4.4.3 |
| **M3** | Ratify OQ1–OQ4, OQ6 | §20.6 (OQ1), §19.6 (OQ2), §19.8 (OQ3+SOQ4), §19.9 (OQ4), §20.4 (OQ6+SOQ2) |
| **M4** | §19–20 and §21 ship together | Both are in this directory — `escalation_hook` is load-bearing for the outcome path |

### Maintainer decisions encoded here

- **SOQ1** — the noun is **"Parley"**, chosen because it is collision-free
  with *both* the shipped v2.0.3 §4.4 fabric session-awareness layer *and*
  the §13 mediated negotiation rounds. Schema filenames, `$id` paths, event
  stems, and the `capabilities.parleys` flag all key off it.
- **SOQ2** — Mandate clock skew **reuses the §17.7 ±5 min configurable
  window**. The RFC's tighter 30-second bound is *not* adopted: a tighter
  threshold for the broader grant than for a single message would be an
  inconsistency inside one trust model.
- **SOQ4** — a binding Parley outcome **MUST** carry a per-handler §17
  `authorization_proof`. A Mandate flag alone is insufficient (§19.8).
- **SOQ5** — T3 (§19–20) and T4 (§21) ship together; T5 (§22) joins the
  same cut.

## The backronym refinement

v2.1 is where **"Protocol for Agent Contexture and Trust"** becomes normative.
The **acronym is unchanged**, and so is every identifier — package names,
the `pact-spec.dev` `$id` base, the repo, the git tags. Shipped v2.0.x stays
"Consensus and Truth" as-released, and frozen versions are not
re-backronymed, per AGENTS.md rule 4. See "What's New in v2.1" in
[`SPECIFICATION.md`](./SPECIFICATION.md).

## Schema `$id` re-basing

Every schema in `schemas/` — carried-forward and new alike — has its `$id`
and cross-schema `$ref`s under `https://pact-spec.dev/schemas/v2.1/`.

This differs from how `spec/v2.2/` carried v2.0 forward (it left the
carried schemas on their `v2.0` `$id`s). Re-basing is deliberate and is what
`v2.1-scope.yaml` specifies: a validator that loads `spec/v2.0/schemas/` and
`spec/v2.1/schemas/` together would otherwise hit duplicate-`$id` errors,
because two different files would claim the same canonical URL.

## Conformance

| Level | Parleys (§19) | Push (§21) | Service accounts (§22) |
|---|---|---|---|
| **Core** | OPTIONAL | OPTIONAL | OPTIONAL |
| **Extended** | SHOULD; **MUST** enforce Mandate envelopes if `capabilities.parleys` is advertised | SHOULD | SHOULD |
| **Authorization-Required** | **MUST** require a valid handler signature on every Mandate | Envelope **MUST** be signed with the sender's principal key | Cross-org messages **still** require a §17.6 `authorization_proof` |

New capability flags: `parleys`, `parleyBindingOutcomes`, `pushDelivery`,
`serviceAccounts`. Advertising a capability carries its enforcement
obligations — a flag without the enforcement is a false conformance claim.

## Known gaps in this draft

Recorded rather than hidden. None blocks review; all are follow-on work.

1. **No dedicated Mandate-enforcement runner kind.** `v2.1-scope.yaml`
   anticipates one (analogous to the v2.0.3 `kind: session`). The runner
   supports `http` / `verification` / `session` only and *fails* on an
   unknown kind, so inventing one here would break CI. The §19–20 vectors
   use `kind: http` and `kind: session` instead. Full §20.7 coverage needs
   that runner work.
2. **§21 delivery semantics are not vector-covered.** The vectors cover
   subscription management; the signed envelope, retry/backoff, and
   dead-lettering are server→client behaviour and need a delivery-observing
   harness the runner does not have.
3. **No cross-organisation §22 vector.** The "service-account auth is not a
   substitute for `authorization_proof`" rule (§22.2) needs a
   two-organisation fixture the single-server harness cannot express.
4. **The reference server does not implement §19–§22.** The new vectors are
   therefore not wired into the `conformance-server` CI job; they SKIP
   without a `--server` target.
5. **`must_respect` boundary evaluation is implementation-defined.** §20.3
   requires implementations to document their method and to fail closed on
   an unevaluable boundary, but does not specify the evaluation itself —
   it is partly semantic. This is a deliberate v2.1 boundary, not an
   oversight.

## Promotion checklist

Per AGENTS.md rule 3, promoting this directory to stable requires **explicit
maintainer sign-off**. Before that:

- [ ] Maintainer review of §19–§22 normative text
- [ ] Explicit sign-off recorded in this README (as `spec/v2.2/README.md`
      does)
- [ ] DRAFT banner removed from this file and from `SPECIFICATION.md`
- [ ] `CHANGELOG.md` v2.1.0 entry (including the backronym refinement and
      the v2.0.x-stays-as-shipped boundary)
- [ ] Tag `v2.1.0` + GitHub Release
- [ ] Mirror out to tailor-app via `tools/mirror-spec.ps1 -Version 2.1.0`
- [ ] Then the **v2.2 absorb**: re-carry `spec/v2.2/` from `spec/v2.1/` so
      §19–22 sit alongside §24, per
      [`spec/v2.2/README.md`](../v2.2/README.md) "Known scope gap"

## File map

| Path | What |
|---|---|
| `SPECIFICATION.md` | v2.0.3 normative text + §19–§22 |
| `schemas/` | v2.0 schemas re-based to `/v2.1/` + 12 new |
| `conformance/extended/parleys/` | 7 new §19–20 vectors |
| `conformance/extended/push/` | 2 new §21 vectors |
| `conformance/extended/service-accounts/` | 2 new §22 vectors |
| `resource-types.yaml` | unchanged from v2.0 |
| `GETTING_STARTED.md` | unchanged from v2.0 |
