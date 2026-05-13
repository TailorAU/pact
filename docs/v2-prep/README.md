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

| File | Destination once approved | Status |
|---|---|---|
| [`d1-d6-decisions.yaml`](d1-d6-decisions.yaml) | Stays here as a working artifact; Knox edits inline to record decisions | Awaiting Knox |
| [`rfc-sessions-mandate.md`](rfc-sessions-mandate.md) | Posted as a GitHub issue (`rfc` label) on TailorAU/pact | Awaiting Knox approval to post |
| [`issue-13-response.md`](issue-13-response.md) | Posted as a comment on [TailorAU/pact#13](https://github.com/TailorAU/pact/issues/13) | Awaiting Knox approval to post |
| [`conformance/README.md`](conformance/README.md) | Moves to `spec/v2/conformance/README.md` after D1 resolves | Ready |
| [`conformance/test-vector-format.yaml`](conformance/test-vector-format.yaml) | Moves to `spec/v2/conformance/test-vector-format.yaml` after D1 resolves | Ready |
| [`v1.1-errata.md`](v1.1-errata.md) | Moves to `spec/v1.1/ERRATA.md` after Knox approval (does not amend frozen SPECIFICATION.md) | Awaiting Knox approval |

## What's NOT here yet

Blocked on D1–D6 resolution:

- `spec/v2/SPECIFICATION.md` (T1–T11 normative text)
- `spec/v2/schemas/*.json` (forward-port + new schemas)
- `spec/v2/conformance/*` smoke tests for T1/T2/T7
- `cli/` and `mcp/` updates for new endpoints (T11)
- `.github/workflows/conformance.yml` (CI gate)

Blocked on Knox approval (no decision dependency):

- Opening the T3 RFC issue on GitHub
- Posting the consolidated response on #13
- Promoting the v1.1 errata to `spec/v1.1/ERRATA.md`

## Resolution flow

```
D1, D4, D5, D6 resolved
       │
       ▼
Phase 0 unblocks:
  - T10 conformance scaffold → spec/v2/conformance/   (mechanical move)
  - T1 normative work begins                          (depends on D4, D6)
  - T2 normative work begins                          (depends on HMAN PR #3)
  - T7 normative work begins                          (depends on D6)
       │
       ▼
D3 resolves → Phase 1 (T3 Sessions, T4 push, T5 service-account)
       │
       ▼
D2 resolves → Phase 2 (T6 legacy, T8 composition or extension, T11 CLI/MCP)
       │
       ▼
Phase 3 (T9 full conformance) → v2.0 release
```

## Editing protocol

This workspace is unconventional — files here are pre-published drafts. Edits don't need PR review; they DO need to stay coherent with each other and with [`docs/v2-plan.yaml`](../v2-plan.yaml). If a draft here diverges from the plan, update the plan or the draft so they agree.

When a file gets promoted to its destination, delete it from `docs/v2-prep/` to avoid two copies of the same content drifting.
