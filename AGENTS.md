# PACT Repo — Agent Onboarding

If you're an AI agent (Claude Code, Cursor, or any framework) opening this repo: **read this first.**

This is the **public spec repo** for PACT — Protocol for Agent Consensus and Truth. MIT-licensed, vendor-neutral. Implementations live elsewhere; this repo holds the specification, reference CLI, and reference MCP server.

---

## You are here

```
TailorAU/pact/
├── spec/v1.1/        ← current stable spec (May 2026)
├── spec/v2.0/        ← active draft spec (was spec/v1.2/ — v1.2-draft collapsed into v2.0 on 2026-05-13, decision D1)
│   ├── SPECIFICATION.md  ← §17 HumanPrincipal (strictly 1:1), §18 Attestation Format Reference — stubs; full text via coordinated HMAN/tailor-app PRs
│   └── conformance/      ← conformance test scaffold (track T10)
├── cli/              ← @pact-protocol/cli (vendor-neutral coordination CLI)
├── mcp/              ← @pact-protocol/mcp (vendor-neutral MCP for PACT servers)
├── docs/             ← supplementary architecture / protocol notes
│   ├── v2-plan.yaml      ← the PACT v2 roadmap (tracks T1–T11, phases, conformance tiers)
│   └── v2-prep/          ← v2 working drafts (decision brief, RFC drafts, errata)
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

**Status as of 2026-05-13:** the canonical-source flip has *not* been confirmed. The §17 and §18 stubs in `spec/v2.0/SPECIFICATION.md` (collapsed from `spec/v1.2/`) were drafted directly here in this repo to land the design decisions from issues #3 and #4. They have **not** been back-ported to `tailor-app/docs/architecture/PACT_SPECIFICATION.md` yet. Knox or the tailor-app maintainer needs to either:

- Back-port the §17 (strictly 1:1) and §18 (`fido2-assertion` + `voice-biometric`) stubs into tailor-app and keep tailor-app canonical, or
- Confirm the flip and make this repo upstream (then update this section + rule #5).

Until that's resolved, **don't make further substantive edits to `spec/v2.0/SPECIFICATION.md` §17 or §18** without coordinating across both repos.

## Open work (as of 2026-05-13)

| # | Title | Status | Owner |
|---|---|---|---|
| [#3](https://github.com/TailorAU/pact/issues/3) | `voice-biometric` credential type for Section 18 | **Closed** 2026-05-08 — RFC accepted as a v2.0 first-class type alongside `fido2-assertion`; §18 stub landed in `spec/v2.0/` | HMAN team to PR normative text |
| [#4](https://github.com/TailorAU/pact/issues/4) | `HumanPrincipal` cardinality | **Closed** 2026-05-08 — direction adopted: **strictly 1:1** with a single human; HMAN persona model lives above the PACT layer; §17 stub landed in `spec/v2.0/` | — |
| [#5](https://github.com/TailorAU/pact/issues/5) | Publish `@pact-protocol/cli` and `@pact-protocol/mcp` to npm | Blocked on `pact-protocol` npm org creation; nudge posted 2026-05-08 | Knox (human) |
| [#6](https://github.com/TailorAU/pact/issues/6) | Deprecate `tailor tap *` overlap in `@tailor-app/cli` | Tracking only, blocked on #5 | No action until #5 |
| [#13](https://github.com/TailorAU/pact/issues/13) | AloomU v1.1 production feedback (8 questions) | Open — consolidated response posted 2026-05-12; mapped to v2 tracks in `docs/v2-plan.yaml` | AI shepherds; Q3-Q5 deferred to a Tailor extension (D2=B) |
| [#14](https://github.com/TailorAU/pact/issues/14) | RFC: ephemeral negotiation Sessions + Mandates (v2.0 §19-20) | Open — RFC posted 2026-05-12; 14-day comment window to 2026-05-26 | AI shepherds |
| [#15](https://github.com/TailorAU/pact/issues/15) | v1.1 errata (phantom §15/§16 refs, schema `$id` paths) | Open — public record; errata draft in `docs/v2-prep/v1.1-errata.md`, awaiting promotion to `spec/v1.1/ERRATA.md` | AI; promotion needs Knox green-light (frozen dir) |

The maintainer comments on #3 and #4 (posted 2026-05-08) define the design constraints for the incoming PR. Read them before touching `spec/v2.0/SPECIFICATION.md` Section 17 or 18. The PACT v2 roadmap is `docs/v2-plan.yaml`; decisions D1–D6 were resolved 2026-05-12 (see `docs/v2-prep/d1-d6-decisions.yaml`).

## Things you should NOT do

1. **Do not run `npm publish`** on `cli/` or `mcp/`. The `pact-protocol` npm org does not exist yet — see [#5](https://github.com/TailorAU/pact/issues/5). Publishes will 401/403/404 and clutter the registry on retry.
2. **Do not force-push** any branch. If a push is rejected, `git pull --rebase && git push`.
3. **Do not promote `spec/v2.0/` to stable** without explicit sign-off. v2.0 is a draft directory and stays a draft until the spec is final; promotion is a deliberate, signed-off act. (Renaming `spec/v1.2/` → `spec/v2.0/` on 2026-05-13 under decision D1 was such a signed-off act — but it stayed *draft*, it was not a promotion to stable.)
4. **Do not edit `spec/v1.0/`, `spec/v1.1/`, `spec/v0.4/`, or `spec/v0.3/`.** Older versions are frozen for citation stability. (Adding `spec/v1.1/ERRATA.md` — a new, additive errata note that does not amend the frozen `SPECIFICATION.md` — is permitted, but still needs Knox's sign-off; see #15.)
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
