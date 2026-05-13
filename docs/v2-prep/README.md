# PACT v2 — preparation workspace

> Pre-staging area for PACT v2 work. Nothing here is normative.
> Files here are drafts staged for approval before they move to:
> - `spec/v2/` (normative spec text, conformance, schemas)
> - GitHub (issues, PR comments)
> - `docs/IMPLEMENTERS.md` (registry)
> - `spec/v1.1/ERRATA.md` (errata note)
>
> Staged: 2026-05-12. Waiting on decisions D1, D4, D5, D6 (see [`d1-d6-decisions.yaml`](d1-d6-decisions.yaml)) and per-file approval before publication.

## Contents

| File | Destination | Status |
|---|---|---|
| [`d1-d6-decisions.yaml`](d1-d6-decisions.yaml) | Stays here as a working artifact | ✅ **All resolved 2026-05-12** — D1=A D2=B D3=A D4=A D5=A D6=A |
| [`rfc-sessions-mandate.md`](rfc-sessions-mandate.md) | Posted as [TailorAU/pact#14](https://github.com/TailorAU/pact/issues/14) (`rfc` label) | ✅ Posted 2026-05-12 |
| [`issue-13-response.md`](issue-13-response.md) | Posted as a [comment on #13](https://github.com/TailorAU/pact/issues/13) | ✅ Posted 2026-05-12 |
| [`conformance/README.md`](conformance/README.md) | Moves to `spec/v2/conformance/README.md` after D1 resolves | Ready (blocked on D1) |
| [`conformance/test-vector-format.yaml`](conformance/test-vector-format.yaml) | Moves to `spec/v2/conformance/test-vector-format.yaml` after D1 resolves | Ready (blocked on D1) |
| [`v1.1-errata.md`](v1.1-errata.md) | Public record: [TailorAU/pact#15](https://github.com/TailorAU/pact/issues/15). Promotes to `spec/v1.1/ERRATA.md` on Knox approval (new file; does not amend frozen SPECIFICATION.md) | Issue filed; ERRATA.md promotion awaiting Knox |

## What's NOT here yet

Blocked on D1–D6 resolution:

- `spec/v2/SPECIFICATION.md` (T1–T11 normative text)
- `spec/v2/schemas/*.json` (forward-port + new schemas)
- `spec/v2/conformance/*` smoke tests for T1/T2/T7
- `cli/` and `mcp/` updates for new endpoints (T11)
- `.github/workflows/conformance.yml` (CI gate)

Done (shipped 2026-05-12):

- ~~Opening the T3 RFC issue on GitHub~~ → [#14](https://github.com/TailorAU/pact/issues/14)
- ~~Posting the consolidated response on #13~~ → [comment](https://github.com/TailorAU/pact/issues/13)
- ~~Filing the v1.1 errata public record~~ → [#15](https://github.com/TailorAU/pact/issues/15)

Still awaiting Knox approval (touches frozen `spec/v1.1/`):

- Promoting the v1.1 errata note to `spec/v1.1/ERRATA.md` (kept as a draft in this dir until Knox green-lights writing inside a frozen version directory)

## Resolution flow

```
D1-D6 RESOLVED 2026-05-12 (D1=A D2=B D3=A D4=A D5=A D6=A)
       │
       ▼
v1.2 → v2 branch collapse (D1=A)            ← NEXT — pending Knox confirmation of branch mechanics
       │
       ▼
Phase 0 (unblocked):
  - T10 conformance scaffold → spec/v2/conformance/   (mechanical move once spec/v2/ exists)
  - T1 normative work — W3C DIDs (did:web + did:key), Authorization-Required tier  (D4=A, D6=A)
  - T2 normative work                                 (depends on HMAN PR #3)
  - T7 normative work — identity URNs designed for future federation               (D6=A)
       │
       ▼
Phase 1 — T3 peer-to-peer Sessions + normative Mandate (D3=A, D5=A), T4 push, T5 service-account
       │
       ▼
Phase 2 — T6 legacy self-approval, T11 CLI/MCP   (T8 removed — Tailor extension per D2=B)
       │
       ▼
Phase 3 — T9 full conformance → v2.0 release
```

## Editing protocol

This workspace is unconventional — files here are pre-published drafts. Edits don't need PR review; they DO need to stay coherent with each other and with [`docs/v2-plan.yaml`](../v2-plan.yaml). If a draft here diverges from the plan, update the plan or the draft so they agree.

When a file gets promoted to its destination, delete it from `docs/v2-prep/` to avoid two copies of the same content drifting.
