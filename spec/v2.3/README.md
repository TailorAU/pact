# PACT v2.3 — DRAFT

> **Status: DRAFT. Not stable, not released, not tagged, not mirrored.**
> Promotion to stable requires explicit maintainer sign-off per
> [`AGENTS.md`](../../AGENTS.md) rule 3. Do not cite this directory as a
> released version.

Carries [`spec/v2.2/`](../v2.2/) forward unchanged and adds **§25 —
Consensus, Authorization, and Legal Execution**: the normative safety boundary
between a PACT protocol state, a human attestation, and legal execution.

Raised as [TailorAU/pact#41](https://github.com/TailorAU/pact/issues/41).

## Why a new directory rather than an edit to v2.2

`spec/v2.2/` is marked **Status: Stable**, declares itself "Released as PACT
v2.2", instructs readers to "Cite this directory as PACT v2.2", and has been
mirrored downstream. Its `SPECIFICATION.md` has not been touched since it was
created — the only commit after it is the DRAFT→stable promotion. It has been
treated as immutable in practice for two months.

The change #41 asks for is **not** purely additive to that line: it narrows §5,
§10.5, §14.5 and §15.2, and withdraws the §14.5 mapping "silence = consent →
*Auto-authorize after TTL*" for transactions. Silently changing what a
citable, mirrored, stable-labelled version *means* is exactly what
[`GOVERNANCE.md`](../../GOVERNANCE.md) §1(2) exists to prevent. So the
normative text lands in a new line, and v2.2 readers get an additive
disclosure at [`../v2.2/ERRATA.md`](../v2.2/ERRATA.md) — the pattern already
established by [`../v1.1/ERRATA.md`](../v1.1/ERRATA.md).

**The version number is the maintainer's call.** `v2.3` is the next free
number above the current stable line and does not collide with `spec/v2.1/`
(issue [#35](https://github.com/TailorAU/pact/issues/35), Parleys, in flight).
Nothing here is tagged, published or mirrored, so this directory can be
renamed before merge at no cost. See the §19–22 absorb plan in
[`../v2.2/README.md`](../v2.2/README.md) — if the maintainer would rather this
boundary ride the v2.1 line or a v2.2 re-issue, moving it is a directory
rename plus a link sweep.

## What v2.3 contains

- **All of v2.2** carried forward unchanged — every normative section, schema,
  conformance vector, runner, and the resource-type registry. `spec/v2.2/`
  itself is untouched apart from the additive `ERRATA.md`; this directory is a
  copy that adds §25, not an edit of v2.2.
- **§25 Consensus, Authorization, and Legal Execution** (NEW, normative).
- **§17.14 Scope of a verified `authorization_proof`** (NEW, normative).
- Targeted narrowing of the existing §5, §10.5, §14.3, §14.5, §15.1 and §15.2
  text so it can no longer be read as permitting what §25 forbids.

## The boundary in one paragraph

`accepted`, `approved`, `auto-merged`, `aligned`, `consensus_reached`,
`commitment`, TTL expiry and absence of objection are **PACT protocol states
only**. None of them is, by itself, an electronic signature, legal assent,
proof of identity or capacity, or authority to bind. Silence never creates an
`authorization_proof`. An external, irreversible, financial or purportedly
legally binding apply MUST fail closed pending explicit, payload-bound human
attestation plus application-layer authority checks — or be declared outside
PACT. A document may reach consensus and be merged as a **draft**; it may not
be called `signed` or `executed` without a separately advertised execution
capability that captured each signer's intentional act.

## Delta from v2.2 — every changed line

| Location | Change |
|---|---|
| Preamble | Version → 2.3, status → DRAFT, "What's New in v2.3" |
| §5 Approval Policy | `objection-based` row: "silence = consent" → "absence of protocol objection, not legal consent"; safety-boundary callout added after the table |
| §6.2 Event Types | Adds `pact.apply.blocked`, `pact.apply.attested` |
| §10.5 Objection-Based Merge | Diagram caption "(silence = consent)" → "(no objection raised)"; new key rule scoping auto-merge to `internal-reversible` effects |
| §14.3 registry table | Adds REQUIRED `effect_class` and `human_attestation`; "registry values are a floor, not a ceiling" rule |
| §14.5 primitives table | `silence = consent` row replaced by "absence of objection at TTL" with per-type apply consequences; transaction cell now **MUST NOT auto-authorize**; adds `effect_class` / `human_attestation` rows; explicit **v2.3 correction** paragraph withdrawing the old mapping |
| §15.1 Implementation Profile | Example profile gains `effectClass` / `humanAttestation` / `applySemanticsExternal` and the `applyGuard` / `executionCapability` flags; `resourceTypes` and `capabilities` field rows updated; new `executionCapability` row |
| §15.2 Conformance Levels | Core row scoped to `internal-reversible` silence-based auto-apply and bound to §25; Extended row requires published effect classification; scoping callout added |
| §17.6 envelope table | Adds `payload_hash`, `scope`, `effect_class` (Conditional — REQUIRED for a guarded apply) |
| §17.14 (NEW) | Scope of a verified `authorization_proof` — the seven things it does **not** establish, plus the export rule |
| §25 (NEW) | The safety boundary, §25.1–§25.14 |
| Appendix A.1 | Six new `apply.*` error codes |
| `resource-types.yaml` | v2 registry: `effect_class` + `human_attestation` on all four built-ins; `transaction` and `record` guarded; `apply_guard` block; registration process requires honest classification |
| `schemas/authorization-proof.json` | `$id` bumped to `/v2.3/`; adds `payload_hash`, `scope`, `effect_class`; two new `allOf` conditionals binding them together; §17.14 scope statement in the description. Four sibling schemas repointed to the new `$id`. |
| `conformance/extended/execution-boundary/` | 11 new vectors + README |
| `conformance/README.md` | New directory listed |
| `GETTING_STARTED.md` | "silence = consent" heading and prose qualified |

Nothing else in the carry-forward differs from `spec/v2.2/`.

## Conformance level claims

- **Core** — v2.2 Core **plus** §25.3, §25.4, §25.6 and §25.10. Silence-based
  auto-apply is scoped to `internal-reversible` effects. An implementation
  that only merges document drafts satisfies this trivially.
- **Extended** — v2.2 Extended plus published `effectClass` /
  `humanAttestation` for every advertised resource type.
- **Authorization-Required** — v2.2 Authorization-Required plus enforcement of
  all six §25.7 checks on every guarded apply, and retention of the
  `pact.apply.attested` / `pact.apply.blocked` events.

This is the first conformance change in the line that can make a previously
conformant implementation non-conformant: a server that auto-settles a
`transaction` on TTL expiry is not v2.3 conformant (§25.14). That is the
intended effect.

## Known gaps — stated, not hidden

- **No implementation.** `reference-server/` does not implement §25. The six
  server-bound vectors in `conformance/extended/execution-boundary/` SKIP
  without `--server` and FAIL against the reference server today. They are the
  acceptance criteria for the implementation work, not a passing suite.
- **Not wired into CI.** `.github/workflows/conformance.yml` runs the runner
  against `spec/v2.0/conformance` only. Nothing in this directory executes in
  CI until a maintainer adds a job.
- **§19–22 still absent.** Like v2.2, this line does not contain the Parley /
  Mandate / push / service-account sections (issue #35). §25.12 states how the
  boundary applies to them when they land.
- **Backronym not refreshed.** `AGENTS.md` records that "Contexture and Trust"
  is normative from v2.1. The carry-forward keeps v2.2's title verbatim to
  avoid colliding with #35; refreshing it is that PR's call, not this one.

## Citation

Do not cite this directory yet — it is a DRAFT. On promotion, cite as
**"PACT v2.3"** and the boundary content as **"PACT v2.3 §25"**.

## File map

| Path | What |
|---|---|
| `SPECIFICATION.md` | v2.2 normative text + §17.14 + §25, with §5 / §10.5 / §14 / §15 narrowed |
| `schemas/` | v2.2 schemas + the extended `authorization-proof.json` |
| `conformance/` | v2.2 vectors + `extended/execution-boundary/` (11 vectors) |
| `resource-types.yaml` | v2 registry with the machine-readable apply guard |
| `GETTING_STARTED.md` | v2.2 text with the silence shorthand qualified |
