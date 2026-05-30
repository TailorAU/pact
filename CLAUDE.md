# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

`AGENTS.md` is the canonical agent-onboarding doc for this repo and is more
detailed than this file on policy. Read it before doing spec work. The
highest-leverage rules from it (do not violate without explicit sign-off from
Knox):

- **Never hand-edit normative spec text or schemas freehand.** `spec/vX.Y/SPECIFICATION.md`,
  schemas, and conformance vectors require maintainer sign-off. The design
  record lives in `docs/v2-plan.yaml` and `docs/v2-prep/`.
- **Frozen versions are immutable for citation stability:** `spec/v0.3/`,
  `spec/v0.4/`, `spec/v1.0/`, `spec/v1.1/`, plus any released stable version.
  Patch released stable versions only via additive `ERRATA.md`, never by
  rewriting normative text. Minor/major changes get a brand-new `spec/vX.Y/`
  directory — directories are always `spec/vX.Y/`, never `spec/vX.Y.Z/`.
- **This repo (`TailorAU/pact`) is the canonical source of truth for the spec.**
  The copy in the private `tailor-app` monorepo is a generated mirror produced
  by `tools/mirror-spec.ps1`. Never treat tailor-app as authoritative; never
  reintroduce the old "draft in tailor-app, back-port here" flow.
- **Do not run `npm publish`** on `cli/` or `mcp/` (the `@pact-protocol` npm org
  did not exist as of the AGENTS.md writing — check issue #5). Do not **rename**
  `cli/` or `mcp/`; their package names are publicly referenced. Do not
  **force-push**; on a rejected push, `git pull --rebase && git push`.
- One co-designed seam — the §18.3 `voice-biometric` crypto — is authored in
  HMAN's PR (issue #3) against the contract in
  `docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml`, not freehanded here.

When in doubt about anything normative, ask Knox.

## What this repo is

PACT (Protocol for Agent Contexture and Trust) is a vendor-neutral coordination
and consensus protocol for multi-agent + human negotiation over a shared
resource. This is the **public spec repo**: it holds the specification plus a
reference CLI, a reference MCP server, a minimal reference HTTP server, and a
conformance runner. Production implementations live elsewhere (the private
`tailor-app` monorepo; the public MIT `HMAN` repo implements §17/§18).

**Dual-licensed:** software (`cli/`, `mcp/`, `reference-server/`, the conformance
runner, `tools/`) is MIT; the specification (`spec/**`) is under
`SPEC-LICENSE.md`. Keep edits on the correct side of that line.

The protocol's core model: agents declare positions (Join / Intent / Constraint /
Salience / Object / Escalation / Done) over an event-sourced log; **silence =
acceptance** (proposals auto-merge after TTL unless objected to); **humans can
override any agent decision at any time**. PACT coordinates — it never holds the
content; content operations belong to the implementation.

## Layout

- `spec/vX.Y/` — versioned specs. Each has `SPECIFICATION.md`,
  `schemas/` (JSON Schema), `conformance/` (test vectors + runner),
  `resource-types.yaml`, `GETTING_STARTED.md`. Check the `> **Status:**` line at
  the top of `SPECIFICATION.md` to see if a version is Draft or Stable.
- `cli/` — `@pact-protocol/cli`, the `pact` CLI (TypeScript). Commands in
  `src/commands/`, HTTP layer in `src/api.ts`, proof verification in `src/proof.ts`.
- `mcp/` — `@pact-protocol/mcp`, MCP server exposing the same primitives as tools.
- `reference-server/` — `@pact-protocol/reference-server`, an in-memory PACT
  server used by CI to execute server-bound conformance vectors end-to-end.
- `spec/v2.0/conformance/runner/` — `@pact-protocol/conformance-runner`, executes
  test-vector YAML files.
- `tools/` — `mirror-spec.ps1` (spec → tailor-app mirror), `matter-smoke.sh`
  (§24 Matter endpoint smoke test against the reference server).
- `docs/v2-prep/` — design records, RFC drafts, decision logs (D1–D6).

## Build, typecheck, run

There is **no unit-test framework** in this repo; correctness is enforced by
TypeScript builds, JSON-Schema validation, and the conformance/smoke suites.
Each TS package is independent — run commands from inside its directory.

```bash
# CLI / MCP / reference-server (each is the same shape)
cd cli && npm ci && npm run build && npm run typecheck   # tsc + tsc --noEmit
cd cli && npm link        # exposes the `pact` (and `pact-agent`) binary globally

# Reference server (in-memory; used as a conformance target)
cd reference-server && npm ci && npm run build
node dist/server.js --port 4100        # then GET /healthz to confirm it is up
```

## Conformance & smoke tests (this is the "test suite")

```bash
# Build + run the conformance runner over all vectors
cd spec/v2.0/conformance/runner && npm ci && npm run build
node dist/index.js run --vectors ..                 # kind:verification run locally; kind:http/session SKIP without a server
node dist/index.js run --vectors .. --filter verify # run a single vector / subset by id substring
node dist/index.js run --vectors .. --server http://127.0.0.1:4100   # also execute server-bound vectors
node dist/index.js run --vectors .. --json          # machine-readable report

# Matter primitive (§24) end-to-end smoke test — starts/stops its own reference server
./tools/matter-smoke.sh 4111
```

Runner exit code: `0` if all selected vectors pass (or skip for documented
reasons), `1` otherwise. To run server-bound (`kind:http` / `kind:session`)
vectors: build + start `reference-server` on a port, then pass `--server`.

## Schema validation (CI gate)

Schemas must stay in lockstep with prose — changing one without the other is a
bug. CI validates with `ajv-cli`:

```bash
npm install -g ajv-cli ajv-formats
# Frozen versions (v0.3/v0.4/v1.0/v1.1) are draft-07:
ajv compile -s spec/v1.1/schemas/<file>.json --spec=draft7 -c ajv-formats
# v2.0+ is JSON Schema 2020-12 and uses cross-schema $refs — register every
# OTHER sibling schema with -r (excluding self) or refs won't resolve:
ajv compile -s spec/v2.0/schemas/<file>.json -r spec/v2.0/schemas/<other>.json ... --spec=draft2020 -c ajv-formats
```

CI workflows: `.github/workflows/validate.yml` (schemas, markdown lint via
`.markdownlint.json`, link check, CLI/MCP builds) and `conformance.yml`
(runner + reference-server + matter-smoke). Publishing is manual /
release-triggered via `publish-packages.yml` (see `RELEASING.md`).

## Conventions

- **Conventional-commit prefixes**, scoped to area: `spec(vX.Y): …`, `docs: …`,
  `feat(cli): …`, `fix: …`, `chore: …`. The private monorepo uses the same
  convention for cross-repo audit consistency.
- **Branching:** drafting happens on short-lived `claude/*` or topic branches
  opened against `main`; merge to `main` after review. Don't push to `main`
  directly without review.
