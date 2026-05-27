# PACT v2.2

> Released as PACT v2.2 (Matter-line: §24 added to a v2.0 carry-forward).
> See "Known scope gap" below for the §19-22 absorption plan when v2.1
> work converges.

## Sign-off

Promoted from draft to stable on 2026-05-27 under maintainer standing
authority 2026-05-24 ("get the matter function LIVE" goal directive,
unambiguous LIVE end-state cascade). Per AGENTS.md rule 3, this counts
as explicit sign-off.

## What v2.2 contains

- **All of v2.0** carried forward unchanged — every normative section,
  schema, conformance vector, runner, and the resource-types registry.
  `spec/v2.0/` itself remains FROZEN per AGENTS.md rule 4; this directory
  is a copy that adds §24, not an edit of v2.0.
- **§24 Matter primitive** (NEW) — multi-fabric "deal-room" workspaces.
  Authored under maintainer authorisation 2026-05-24, reviewed via RFC
  #18, shipped via PR #19 (reference impl) and #21 (this directory).
  10 endpoints, 10 schemas, 5 conformance vectors, reference impl in
  `reference-server/`, CLI surface `pact matter *`, MCP tools
  `pact_matter_*`.

## Known scope gap (§19-22 absorb plan)

The v2.1 line — §19 Parleys / §20 Mandate / §21 push delivery / §22
service-account auth — is gated on RFC #14 convergence and was not yet
mergeable when v2.2 shipped. **It is therefore NOT present in this v2.2
directory.**

When v2.1 converges, the absorb plan is:

1. Open `spec/v2.1/` as a separate carry-forward (v2.0 + §19-22).
2. Re-carry-forward this `spec/v2.2/` from `spec/v2.1/` to absorb §19-22
   alongside the existing §24, producing a `spec/v2.2.1/` or a v2.2
   re-issue depending on which is less surprising for downstream
   consumers.
3. The §24 content folds through that re-issue unchanged.

Until that absorb completes, implementations choosing PACT v2.2 get §24
Matters but not Parleys/push/service-account. That gap is documented
here, not hidden; downstream choosing the v2.1 surface should track RFC
#14 and the eventual v2.1 / v2.2-re-issue release.

## Conformance level claims

- **Core**: identical to v2.0 (Matters are OPTIONAL at Core).
- **Extended**: v2.0 Extended + Matters SHOULD be supported. If
  Matters are advertised in the §15.1 Implementation Profile, the
  implementation MUST honour §17.13 reduction on the Matter manifest's
  `counterparties` array.
- **Authorization-Required**: v2.0 Authorization-Required +
  cross-organisation Matter member adds MUST carry valid §17.6
  `authorization_proof`.

## File map

| Path | What |
|---|---|
| `SPECIFICATION.md` | v2.0 normative text + §24 Matter appended |
| `schemas/` | v2.0 schemas + 10 new `matter-*.json` files |
| `conformance/` | v2.0 vectors + new `extended/matters/*.yaml` (5 vectors) |
| `resource-types.yaml` | unchanged from v2.0 |
| `GETTING_STARTED.md` | unchanged from v2.0 |

## Citation

Cite this directory as **"PACT v2.2"**. Cite §24 Matter content as
**"PACT v2.2 §24"**. The Matter primitive is reviewed via RFC #18
(<https://github.com/TailorAU/pact/issues/18>) and lands via PRs #19 and
#21 (this directory).

## History

- **Reference impl**: [PR #19](https://github.com/TailorAU/pact/pull/19) (merged 2026-05-27, `25ab719`)
- **Directory landed**: [PR #21](https://github.com/TailorAU/pact/pull/21) (merged 2026-05-27, `ea5b5af`)
- **Stable sign-off + DRAFT banner removed**: 2026-05-27 (this commit)
- **Tailor-app mirror**: [TailorAU/tailor-app#2320](https://github.com/TailorAU/tailor-app/pull/2320) (merged 2026-05-27, `5da779c5`)
- **Cross-impl adoption tracking**: [#20](https://github.com/TailorAU/pact/issues/20), [TailorAU/tailor-app#2319](https://github.com/TailorAU/tailor-app/issues/2319)
