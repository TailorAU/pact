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
| `main` | v1.1 stable spec + v1.2 draft + published CLI/MCP source | Don't push directly without review. v1.2 draft text lives here under `spec/v1.2/`. |
| `claude/*` or topic branches | Active drafting / reviews | Open against `main`. Long-lived `v1.2` branch retired 2026-05-08 — drafting happens on short-lived review branches that merge to `main`. |

## Source-of-truth note (important)

The richer, in-progress version of `spec/*/SPECIFICATION.md` historically lived in the **Tailor monorepo** (`tailor-app/docs/architecture/PACT_SPECIFICATION.md`, mirrored *out* on 2026-04-26 as part of ticket #1301).

**Status as of 2026-05-08:** the canonical-source flip has *not* been confirmed. The §17 and §18 stubs in `spec/v1.2/SPECIFICATION.md` were drafted directly here in this repo to land the design decisions from issues #3 and #4. They have **not** been back-ported to `tailor-app/docs/architecture/PACT_SPECIFICATION.md` yet. Knox or the tailor-app maintainer needs to either:

- Back-port the §17 (1:1) and §18 (voice-biometric) stubs into tailor-app and keep tailor-app canonical, or
- Confirm the flip and make this repo upstream (then update this section + rule #5).

Until that's resolved, **don't make further substantive edits to `spec/v1.2/SPECIFICATION.md` §17 or §18** without coordinating across both repos.

## Open work (as of 2026-05-08)

| # | Title | Status | Owner |
|---|---|---|---|
| [#3](https://github.com/TailorAU/pact/issues/3) | `voice-biometric` credential type for Section 18 | **Closed** 2026-05-08 — RFC accepted as first-class type alongside `fido2-assertion`; §18 stub landed | HMAN team to PR normative text |
| [#4](https://github.com/TailorAU/pact/issues/4) | `HumanPrincipal` cardinality | **Closed** 2026-05-08 — direction adopted: **strictly 1:1** with a single human; HMAN persona model lives above the PACT layer; §17 stub landed | — |
| [#5](https://github.com/TailorAU/pact/issues/5) | Publish `@pact-protocol/cli` and `@pact-protocol/mcp` to npm | Blocked on `pact-protocol` npm org creation; nudge posted 2026-05-08 | Knox (human) |
| [#6](https://github.com/TailorAU/pact/issues/6) | Deprecate `tailor tap *` overlap in `@tailor-app/cli` | Tracking only, blocked on #5 | No action until #5 |

The maintainer comments on #3 and #4 (posted 2026-05-08) define the design constraints for the incoming PR. Read them before touching `spec/v1.2/SPECIFICATION.md` Section 17 or 18.

## Things you should NOT do

1. **Do not run `npm publish`** on `cli/` or `mcp/`. The `pact-protocol` npm org does not exist yet — see [#5](https://github.com/TailorAU/pact/issues/5). Publishes will 401/403/404 and clutter the registry on retry.
2. **Do not force-push** any branch. If a push is rejected, `git pull --rebase && git push`.
3. **Do not promote `spec/v1.2/` to stable** without explicit sign-off. v1.2 is a draft directory and stays a draft until the spec is final; promotion is a deliberate, signed-off act.
4. **Do not edit `spec/v1.0/`, `spec/v1.1/`, `spec/v0.4/`, or `spec/v0.3/`.** Older versions are frozen for citation stability.
5. **Do not invent spec text** beyond what's already in §17/§18 stubs. The §17/§18 stubs landed on 2026-05-08 to capture the directional decisions from issues #3 and #4; further normative text (field shapes, signature suites, threat-model notes) MUST come from a coordinated PR with HMAN / tailor-app — see the source-of-truth note above.
6. **Do not rename `cli/` or `mcp/`.** Their package names (`@pact-protocol/cli`, `@pact-protocol/mcp`) are publicly referenced in external docs and the [issue #5 acceptance criteria](https://github.com/TailorAU/pact/issues/5).

## Quick start

```powershell
# Where am I?
git branch --show-current     # main or a topic branch
git status

# Read the current draft spec
cat spec/v1.2/SPECIFICATION.md

# Start a piece of v1.2 draft work
git checkout main
git checkout -b claude/<short-description>
# ...edit spec/v1.2/SPECIFICATION.md or schemas...
git add spec/v1.2
git commit -m "spec(v1.2): <what changed>"
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
