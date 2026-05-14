# PACT Repo — Agent Onboarding

If you're an AI agent (Claude Code, Cursor, or any framework) opening this repo: **read this first.**

This is the **public spec repo** for PACT — Protocol for Agent Consensus and Truth. MIT-licensed, vendor-neutral. Implementations live elsewhere; this repo holds the specification, reference CLI, and reference MCP server.

---

## You are here

```
TailorAU/pact/
├── spec/v2.0/        ← current stable spec (released 14 May 2026)
│   ├── SPECIFICATION.md
│   ├── resource-types.yaml      ← machine-readable resource-type registry (§14.3)
│   ├── schemas/                 ← JSON Schema 2020-12, incl. authorization-proof, principal-registry, agent-identity
│   └── conformance/             ← test vectors + @pact-protocol/conformance-runner
├── spec/v1.1/        ← previous stable spec; has ERRATA.md
├── cli/              ← @pact-protocol/cli (vendor-neutral coordination CLI; v2.0 — `--authorization-proof`, `pact verify-proof`, `pact profile`)
├── mcp/              ← @pact-protocol/mcp (vendor-neutral MCP for PACT servers; v2.0 — pact_ask, pact_negotiate_*, pact_profile)
├── CHANGELOG.md      ← release notes per spec version
├── docs/             ← supplementary architecture / protocol notes
│   ├── v2-plan.yaml      ← the PACT v2 roadmap (now mostly DONE)
│   └── v2-prep/          ← v2 working artifacts (decision record, RFC drafts, gap analyses)
├── examples/         ← example payloads and integrations
└── README.md         ← public landing
```

## Branch model

| Branch | Purpose | Rules |
|---|---|---|
| `main` | v1.1 stable spec + v2.0 draft + published CLI/MCP source | Don't push directly without review. v2.0 draft text lives here under `spec/v2.0/`. |
| `claude/*` or topic branches | Active drafting / reviews | Open against `main`. Drafting happens on short-lived review branches that merge to `main`. |
| `v1.2` (remote ref only) | **Deprecated relic** | Carried a superseded 1:N `HumanPrincipal` approach that was reverted. **Do not use, do not merge, do not delete without sign-off.** Canonical v1.2-draft history lived on `main` and was collapsed into `spec/v2.0/` on 2026-05-13. |

## Source-of-truth note (important)

The richer, in-progress version of `spec/*/SPECIFICATION.md` historically lived in the **Tailor monorepo** (`tailor-app/docs/architecture/PACT_SPECIFICATION.md`, mirrored *out* on 2026-04-26 as part of ticket #1301).

**Status as of 2026-05-14:** the v2.0 spec landed in both repos. The tailor-app mirror was synced via PR [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616) (squash-merged 2026-05-14). For v2.0.x and v2.1 work, the same coordinated-PR pattern applies: edit `spec/vX.Y/SPECIFICATION.md` here AND `tailor-app/docs/architecture/PACT_SPECIFICATION.md` there, back-port via a PR on tailor-app, then sync to pact-repo. The "which side is canonical" question remains nominally open — current de facto flow is "draft here, back-port to tailor-app, then both reflect the change."

## Open work (as of 2026-05-14)

**v2.0 shipped 14 May 2026.** Tag `v2.0.0`; the tailor-app mirror sync merged via PR [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616). The PACT v2 roadmap (`docs/v2-plan.yaml`) is mostly done; decisions D1–D6 are recorded in `docs/v2-prep/d1-d6-decisions.yaml`. Release notes: `CHANGELOG.md`.

| # | Title | Status | Owner |
|---|---|---|---|
| [#3](https://github.com/TailorAU/pact/issues/3) | `voice-biometric` credential type | Closed 2026-05-08 — accepted as a v2.0 first-class type; §18.3 structural contract in v2.0. Crypto detail + test vectors land via HMAN's PR; patches into spec/v2.0/ §18 (v2.0.x) or rolls into spec/v2.1/ depending on timing. | HMAN team |
| [#4](https://github.com/TailorAU/pact/issues/4) | `HumanPrincipal` cardinality | Closed 2026-05-08 — strictly 1:1 (§17.4). Shipped in v2.0. | — |
| [#5](https://github.com/TailorAU/pact/issues/5) | Publish `@pact-protocol/cli` and `@pact-protocol/mcp` to npm | Blocked on `pact-protocol` npm org creation. CLI + MCP at v2.0.0 ready to publish the moment the org exists. | Knox (human) |
| [#6](https://github.com/TailorAU/pact/issues/6) | Deprecate `tailor tap *` overlap | Tracking only, blocked on #5. | — |
| [#13](https://github.com/TailorAU/pact/issues/13) | AloomU v1.1 production feedback (8 questions) | Open — Q1/Q2/Q6/Q7/Q8 addressed by v2.0; Q3-Q5 deferred to a Tailor extension (D2=B). Can close once AloomU confirms. | AloomU + Knox |
| [#14](https://github.com/TailorAU/pact/issues/14) | RFC: Sessions + Mandates | Open — comment window to 2026-05-26. §19-20 normative text DEFERRED to spec/v2.1/ (v2.0 ships with §19-22 reserved). | AI shepherds |
| [#15](https://github.com/TailorAU/pact/issues/15) | v1.1 errata | Closed 2026-05-13 — `spec/v1.1/ERRATA.md` landed. | — |

### Heading toward v2.1

`spec/v2.1/` will pick up: §19-20 Sessions + Mandate (T3), §21 push delivery (T4), §22 service-account auth (T5), the `voice-biometric` crypto from HMAN's #3 PR (slots into §18.3 / §18.6 — patches into v2.0.x if that lands before v2.1; otherwise lands cleanly in v2.1). T8 (attached-resource model) ships as a Tailor extension (D2=B), not in PACT core.

## Things you should NOT do

1. **Do not run `npm publish`** on `cli/` or `mcp/`. The `pact-protocol` npm org does not exist yet — see [#5](https://github.com/TailorAU/pact/issues/5). Publishes will 401/403/404 and clutter the registry on retry.
2. **Do not force-push** any branch. If a push is rejected, `git pull --rebase && git push`.
3. **Do not promote `spec/v2.0/` to stable** without explicit sign-off. v2.0 is a draft directory and stays a draft until the spec is final; promotion is a deliberate, signed-off act. (Renaming `spec/v1.2/` → `spec/v2.0/` on 2026-05-13 under decision D1 was such a signed-off act — but it stayed *draft*, it was not a promotion to stable.)
4. **Do not edit `spec/v1.0/`, `spec/v1.1/`, `spec/v0.4/`, or `spec/v0.3/`.** Older versions are frozen for citation stability. (`spec/v1.1/ERRATA.md` exists as a new, additive errata note — it documents known issues without amending the frozen `SPECIFICATION.md` or schemas. Adding a similar `ERRATA.md` to another frozen version is allowed but still wants Knox's sign-off.)
5. **Do not invent spec text** beyond what's already in §17/§18 stubs. The §17/§18 stubs (now in `spec/v2.0/`) capture the directional decisions from issues #3 and #4; further normative text (field shapes, signature suites, threat-model notes) MUST come from a coordinated PR with HMAN / tailor-app — see the source-of-truth note above. The same applies to the new v2.0 sections (§19+ Sessions, push delivery, service-account auth, agent identity) — `docs/v2-plan.yaml` is the design record; normative text lands via reviewed PRs, not freehand.
6. **Do not rename `cli/` or `mcp/`.** Their package names (`@pact-protocol/cli`, `@pact-protocol/mcp`) are publicly referenced in external docs and the [issue #5 acceptance criteria](https://github.com/TailorAU/pact/issues/5).

## Quick start

```powershell
# Where am I?
git branch --show-current     # main or a topic branch
git status

# Read the current draft spec + roadmap
cat spec/v2.0/SPECIFICATION.md
cat docs/v2-plan.yaml

# Start a piece of v2.0 draft work
git checkout main
git checkout -b claude/<short-description>
# ...edit spec/v2.0/SPECIFICATION.md or schemas...
git add spec/v2.0
git commit -m "spec(v2.0): <what changed>"
git push -u origin claude/<short-description>
# ...then merge to main once reviewed.

# Open or comment on issues
gh issue list --repo TailorAU/pact
gh issue comment <num> --repo TailorAU/pact --body-file <file>
```

## CLI / MCP packages

Both packages live in this repo and are version-pinned together (currently `1.1.0`).

| Package | Path | Status | Install (when published) |
|---|---|---|---|
| `@pact-protocol/cli` | `cli/` | Built, **not yet on npm** ([#5](https://github.com/TailorAU/pact/issues/5)) | `npm i -g @pact-protocol/cli` |
| `@pact-protocol/mcp` | `mcp/` | Built, **not yet on npm** ([#5](https://github.com/TailorAU/pact/issues/5)) | `npx @pact-protocol/mcp` |

Until #5 unblocks, install from source:

```powershell
cd cli
npm install
npm run build
npm link    # exposes `pact` (and `pact-agent` fallback) globally
```

## Conventions

- **Commit messages:** use conventional-commits prefixes — `spec:`, `docs:`, `feat(cli):`, `chore:`, `fix:`. The internal monorepo uses the same convention so cross-repo audit trails read consistently.
- **Spec versioning:** `spec/vX.Y/` — never `spec/vX.Y.Z/`. Patch-level changes go inline; minor/major changes get a new directory.
- **Schemas:** every endpoint schema in `spec/vX.Y/schemas/` MUST stay in sync with the prose spec. If you change one without the other, you've made a mistake.
- **Issue labels (already provisioned):** `blocker`, `deprecation`, `infra`, `cli`, plus the GitHub defaults (`enhancement`, `documentation`, `bug`, etc.). Add `rfc` for issues proposing protocol changes.

## Cross-repo references

- **Tailor monorepo** (private; reference implementation): `https://github.com/TailorAU/tailor-app`. Holds canonical spec source today, reference implementation of all PACT endpoints, and the `@tailor-app/cli` (which currently still ships a legacy `tap` command group — see [#6](https://github.com/TailorAU/pact/issues/6)).
- **HMAN — Human-Managed-Access-Network** (downstream consumer): `https://github.com/Tailor-AUS/Human-Managed-Access-Network`. Source of [#3](https://github.com/TailorAU/pact/issues/3) and [#4](https://github.com/TailorAU/pact/issues/4) RFCs.

## When in doubt

Ask Knox. Don't invent spec language, don't publish packages, don't promote drafts to stable, don't force-push.
