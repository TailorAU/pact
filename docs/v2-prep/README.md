# PACT v2 — preparation workspace

> Working drafts for PACT v2.0. Nothing here is normative.
> As items land in their final home, they get deleted from this directory.

## Status (2026-05-13)

- **D1–D6 resolved** 2026-05-12 — D1=A D2=B D3=A D4=A D5=A D6=A. See [`d1-d6-decisions.yaml`](d1-d6-decisions.yaml).
- **v1.2-draft collapsed into `spec/v2.0/`** 2026-05-13 (D1=A). The stale `v1.2` branch is left untouched as a relic.
- **Conformance scaffold** moved out of here into [`spec/v2.0/conformance/`](../../spec/v2.0/conformance/) (track T10).
- **RFC #14** (Sessions + Mandates) and the **#13 consolidated response** posted; **#15** (v1.1 errata) filed and the errata note **promoted to [`spec/v1.1/ERRATA.md`](../../spec/v1.1/ERRATA.md)** 2026-05-13.
- Phase 0 is underway: T1, T2, T7, T10. Normative §17/§18/§19+ text lands via coordinated PRs per AGENTS.md.

## Contents

| File | Destination | Status |
|---|---|---|
| [`d1-d6-decisions.yaml`](d1-d6-decisions.yaml) | Stays here as the decision record | ✅ All resolved 2026-05-12; collapse done 2026-05-13 |
| [`rfc-sessions-mandate.md`](rfc-sessions-mandate.md) | Posted as [TailorAU/pact#14](https://github.com/TailorAU/pact/issues/14) (`rfc` label) | ✅ Posted 2026-05-12 — 14-day window to 2026-05-26; AI shepherding |
| [`issue-13-response.md`](issue-13-response.md) | Posted as a [comment on #13](https://github.com/TailorAU/pact/issues/13) | ✅ Posted 2026-05-12 |
| [`s17-s18-normative-draft.md`](s17-s18-normative-draft.md) | Lands in `spec/v2.0/SPECIFICATION.md` §17–§18 via the coordinated HMAN/tailor-app PR (AGENTS.md rule 5), then this file is deleted | ✅ Drafted 2026-05-13 (T1 + T2) — awaiting the tailor-app branch/context from Knox to back-port |

(Promoted out of this directory: the conformance scaffold → [`spec/v2.0/conformance/`](../../spec/v2.0/conformance/); the v1.1 errata note → [`spec/v1.1/ERRATA.md`](../../spec/v1.1/ERRATA.md).)

## Still pending

**Phase-0 / phase-1 work (per [`../v2-plan.yaml`](../v2-plan.yaml)):**
- §17/§18 normative text → **drafted** ([`s17-s18-normative-draft.md`](s17-s18-normative-draft.md)); blocked only on Knox providing the tailor-app branch/context for the coordinated PR back-port (T1, T2)
- `spec/v2.0/schemas/{authorization-proof,principal-registry,...}.json` (T1, T3, T4, T5)
- `spec/v2.0/conformance/` smoke tests for T1/T2/T7 + `.github/workflows/conformance.yml` (T10)
- `spec/v2.0/SPECIFICATION.md` §19–20 Sessions + Mandate (T3 — RFC #14 must converge first; 0 comments as of 2026-05-13)
- `cli/` + `mcp/` v2.0 endpoint coverage (T11)

## Editing protocol

Files here are pre-publication drafts. Edits don't need PR review; they DO need to stay coherent with each other and with [`../v2-plan.yaml`](../v2-plan.yaml). When a draft is promoted to its destination, delete it from here so two copies don't drift.
