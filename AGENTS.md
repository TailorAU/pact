# PACT Repo — Agent Onboarding

If you're an AI agent (Claude Code, Cursor, or any framework) opening this repo: **read this first.**

This is the **public spec repo** for PACT — Protocol for Agent Consensus and Truth. MIT-licensed, vendor-neutral. Implementations live elsewhere; this repo holds the specification, reference CLI, and reference MCP server.

---

## You are here

```
TailorAU/pact/
├── spec/v1.1/        ← current stable spec (May 2026)
├── spec/v1.2/        ← draft spec (current work; cut from main on 2026-04-26)
│   └── SPECIFICATION.md  ← Sections 17-18 add Human Authorization Layer
├── cli/              ← @pact-protocol/cli (vendor-neutral coordination CLI)
├── mcp/              ← @pact-protocol/mcp (vendor-neutral MCP for PACT servers)
├── docs/             ← supplementary architecture / protocol notes
├── examples/         ← example payloads and integrations
└── README.md         ← public landing
```

## Branch model

| Branch | Purpose | Rules |
|---|---|---|
| `main` | v1.1 stable spec, published CLI/MCP source | Don't push directly without review. Merges from `v1.2` only when v1.2 is final. |
| `v1.2` | Active draft of v1.2 (Human Authorization Layer) | All v1.2 work targets this branch. Long-lived until v1.2 is final. **Never force-push.** **Never merge to `main` without sign-off.** |

Forward-merge `main` into `v1.2` is fine and expected (e.g. picking up onboarding-doc updates). Do not rebase `v1.2` onto `main` — that requires a force-push.

## Source-of-truth note (important)

The richer, in-progress version of `spec/*/SPECIFICATION.md` currently lives in the **Tailor monorepo**, not here:

- `tailor-app/docs/architecture/PACT_SPECIFICATION.md` is the upstream canonical source today.
- This repo's `spec/v1.2/SPECIFICATION.md` was mirrored *out* on 2026-04-26 as part of ticket #1301.

If you edit the spec inside this repo, **back-port to the Tailor monorepo** at the same time, or your edits get overwritten on the next sync. Long-term, this repo should become the upstream and the monorepo the mirror — that flip has not happened yet.

## Open work (as of 2026-04-26)

| # | Title | Status | Owner |
|---|---|---|---|
| [#3](https://github.com/TailorAU/pact/issues/3) | `voice-biometric` credential type for Section 18 | RFC accepted in principle, awaiting PR | HMAN team (external) |
| [#4](https://github.com/TailorAU/pact/issues/4) | `HumanPrincipal` 1-to-many cardinality | Direction adopted (1:N + cross-principal linkage); spec text landed in `spec/v1.2/SPECIFICATION.md` §17.8 | Closes when HMAN PR merges |
| [#5](https://github.com/TailorAU/pact/issues/5) | Publish `@pact-protocol/cli` and `@pact-protocol/mcp` to npm | Blocked on `pact-protocol` npm org creation | Knox (human) |
| [#6](https://github.com/TailorAU/pact/issues/6) | Deprecate `tailor tap *` overlap in `@tailor-app/cli` | Tracking only, blocked on #5 | No action until #5 |

The maintainer comments on #3 and #4 (posted 2026-04-26) define the design constraints for the incoming PR. Read them before touching `spec/v1.2/SPECIFICATION.md` Section 17 or 18.

## Things you should NOT do

1. **Do not run `npm publish`** on `cli/` or `mcp/`. The `pact-protocol` npm org does not exist yet — see [#5](https://github.com/TailorAU/pact/issues/5). Publishes will 401/403/404 and clutter the registry on retry.
2. **Do not force-push** any branch. If a push is rejected, `git pull --rebase && git push`.
3. **Do not merge `v1.2` into `main`** without explicit sign-off. v1.2 is a draft. Promotion happens when the spec is final.
4. **Do not edit `spec/v1.0/`, `spec/v1.1/`, `spec/v0.4/`, or `spec/v0.3/`.** Older versions are frozen for citation stability.
5. **Do not invent spec text.** Sections 17-18 of v1.2 are mirrored verbatim from the Tailor monorepo — back-port any new text.
6. **Do not rename `cli/` or `mcp/`.** Their package names (`@pact-protocol/cli`, `@pact-protocol/mcp`) are publicly referenced in external docs and the [issue #5 acceptance criteria](https://github.com/TailorAU/pact/issues/5).

## Quick start

```powershell
# Where am I?
git branch --show-current     # main or v1.2
git status

# Read the current draft spec
cat spec/v1.2/SPECIFICATION.md

# Start work on the v1.2 draft
git checkout v1.2
# ...edit spec/v1.2/SPECIFICATION.md or schemas...
git add spec/v1.2
git commit -m "spec(v1.2): <what changed>"
git push origin v1.2

# Pick up updates that landed on main (e.g. AGENTS.md tweaks)
git checkout v1.2
git merge main --no-ff -m "chore: forward-merge main into v1.2"
git push origin v1.2

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
