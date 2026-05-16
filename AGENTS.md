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

**This question is closed. `pact-repo` is canonical.** `spec/vX.Y/SPECIFICATION.md` in *this* repo is the single source of truth for the PACT specification. The tailor-app copy (`tailor-app/docs/architecture/PACT_SPECIFICATION.md`) is a **generated mirror** — never hand-edit it, and never treat it as the authoritative version.

**The flow:** edit `spec/vX.Y/SPECIFICATION.md` here → run `tools/mirror-spec.ps1 -Version X.Y.Z -AutoMerge` → tailor-app reflects it. The script opens (and, with `-AutoMerge`, squash-merges) the mirror PR on tailor-app from this repo's spec; use `-DryRun` first to preview the diff and PR body. See [`tools/README.md`](tools/README.md) for flags and defaults.

**History (for context only — not the current model):** the richer in-progress spec *used to* live in the Tailor monorepo and was mirrored *out* of tailor-app on 2026-04-26 (ticket #1301). The directions have since reversed and the loop is automated: the v2.0 mirror landed via PR [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616) (squash-merged 2026-05-14) and the v2.0.x patches via #1673 / #1679 / #1701 — all now produced by `tools/mirror-spec.ps1`, not the old hand-back-port-to-tailor-app dance. Do not reintroduce the "draft in tailor-app, back-port here" pattern; it is superseded.

## Open work (as of 2026-05-15)

**v2.0** shipped 14 May 2026 (tag `v2.0.0`; mirror via [#1616](https://github.com/TailorAU/tailor-app/pull/1616)). **v2.0.1** patch released 15 May 2026 morning (tag `v2.0.1`; mirror via [#1673](https://github.com/TailorAU/tailor-app/pull/1673)). **v2.0.2** patch released 15 May 2026 afternoon (tag `v2.0.2`; mirror via [#1679](https://github.com/TailorAU/tailor-app/pull/1679)) — closes 10 named attacks (A1–A10) + 3 structural concerns (S1–S3) from the adversarial / red-team cold-eye review. **v2.0.3** patch released 15 May 2026 evening (tag `v2.0.3`; mirror via [#1701](https://github.com/TailorAU/tailor-app/pull/1701)) — adds **Fabric Onboarding & Session Awareness**: five additive operations (§4.4 `_status`, `manifest`, `_heartbeat`, `mark-read`, `_onboard`), §6.5 pending obligations as first-class concept, §15.6 onboarding pattern, §7.2/§7.3 event-channel + MCP additions, §17.13 manifest visibility, nine new schemas, five new test vectors, runner `kind: session`, seven new MCP tools incl. `pact_session_announce` (cognitive-layer hook). See `CHANGELOG.md` v2.0.2 and v2.0.3 for the full attack-by-attack / operation-by-operation mappings. The PACT v2 roadmap (`docs/v2-plan.yaml`) is mostly done; decisions D1–D6 are recorded in `docs/v2-prep/d1-d6-decisions.yaml`.

| # | Title | Status | Owner |
|---|---|---|---|
| [#3](https://github.com/TailorAU/pact/issues/3) | `voice-biometric` credential type | Closed 2026-05-08 — accepted as a v2.0 first-class type; §18.3 structural contract in v2.0. Crypto detail + test vectors land via HMAN's PR; patches into spec/v2.0/ §18 (v2.0.x) or rolls into spec/v2.1/ depending on timing. | HMAN team |
| [#4](https://github.com/TailorAU/pact/issues/4) | `HumanPrincipal` cardinality | Closed 2026-05-08 — strictly 1:1 (§17.4). Shipped in v2.0. | — |
| [#5](https://github.com/TailorAU/pact/issues/5) | Publish `@pact-protocol/cli` and `@pact-protocol/mcp` to npm | Blocked on `pact-protocol` npm org creation. CLI + MCP at v2.0.3 ready to publish the moment the org exists. | Knox (human) |
| [#6](https://github.com/TailorAU/pact/issues/6) | Deprecate `tailor tap *` overlap | Tracking only, blocked on #5. | — |
| [#13](https://github.com/TailorAU/pact/issues/13) | AloomU v1.1 production feedback (8 questions) | Open — Q1/Q2/Q6/Q7/Q8 addressed by v2.0; Q3-Q5 deferred to a Tailor extension (D2=B). Can close once AloomU confirms. | AloomU + Knox |
| [#14](https://github.com/TailorAU/pact/issues/14) | RFC: Sessions + Mandates | Open — comment window to 2026-05-26. §19-20 normative text DEFERRED to spec/v2.1/ (v2.0 ships with §19-22 reserved). | AI shepherds |
| [#15](https://github.com/TailorAU/pact/issues/15) | v1.1 errata | Closed 2026-05-13 — `spec/v1.1/ERRATA.md` landed. | — |

### Heading toward v2.1

`spec/v2.1/` will pick up: §19-20 Sessions + Mandate (T3), §21 push delivery (T4), §22 service-account auth (T5), the `voice-biometric` crypto from HMAN's #3 PR (slots into §18.3 / §18.6 — patches into v2.0.x if that lands before v2.1; otherwise lands cleanly in v2.1). T8 (attached-resource model) ships as a Tailor extension (D2=B), not in PACT core.

## Things you should NOT do

1. **Do not run `npm publish`** on `cli/` or `mcp/`. The `pact-protocol` npm org does not exist yet — see [#5](https://github.com/TailorAU/pact/issues/5). Publishes will 401/403/404 and clutter the registry on retry.
2. **Do not force-push** any branch. If a push is rejected, `git pull --rebase && git push`.
3. **Do not promote a draft `spec/vX.Y/` to stable** without explicit sign-off. (`spec/v2.0/` was promoted on 2026-05-14 with sign-off; that's the last such promotion. The next will be `spec/v2.1/` once §19-22 / Sessions / push / service-account land.) v2.0.x patches inline are fine — they're not promotions, they're patches against the already-stable v2.0.
4. **Do not edit the normative text or schemas of frozen versions: `spec/v0.3/`, `spec/v0.4/`, `spec/v1.0/`, `spec/v1.1/`, `spec/v2.0/`.** Older versions are frozen for citation stability. v2.0 is the current stable and is patched only via additive `ERRATA.md`, the cold-eye-audit v2.0.1 patch (which lands inline as the spec's stated-stable-but-patched-once), and any future minor/major (which goes to a new directory). `spec/v1.1/ERRATA.md` is the documented additive pattern; the same applies to v2.0 if defects are discovered post-release.
5. **Do not invent spec text.** Normative spec text (`spec/v2.0/SPECIFICATION.md`, schemas, or any future `spec/v2.1/`) is authored **here** — `pact-repo` is canonical (see the Source-of-truth note above) — but still requires explicit maintainer sign-off: agents MUST NOT freehand normative changes. `docs/v2-plan.yaml` and `docs/v2-prep/` are the design record; normative text lands via reviewed change, then mirrors **out** to tailor-app via `tools/mirror-spec.ps1` (never the old draft-in-tailor-app, back-port-here dance — that direction is superseded; the v2.0 mirror via [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616) and the v2.0.x patches #1673 / #1679 / #1701 are now all script-produced). **One exception:** HMAN-co-designed surfaces — currently the §18.3 `voice-biometric` crypto — remain authoritative in HMAN's coordinated [#3](https://github.com/TailorAU/pact/issues/3) PR per §18.6 and the `docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml` contract; mirror that in when it lands, don't freehand it. Cosmetic/typo/link/structure-only edits (no normative meaning change) are exempt.
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

Both packages live in this repo and are version-pinned together (currently `2.0.3`).

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
- **HMAN — Human-Managed-Access-Network** (public, MIT; **reference implementation of §17/§18**): `https://github.com/Tailor-AUS/Human-Managed-Access-Network`. The canonical proof that the Human Authorization Layer is implementable on a sovereign local-first stack. Source of [#3](https://github.com/TailorAU/pact/issues/3) (voice-biometric crypto) and [#4](https://github.com/TailorAU/pact/issues/4) RFCs. **PACT and HMAN are deliberately separate artifacts** — PACT is the vendor-neutral protocol; HMAN is one implementation of the human end. Do not merge them; do not let spec text assume HMAN. The one co-designed seam (§18.3 voice-biometric) is frozen as a contract in `docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml`; HMAN's #3 PR fills in the crypto and must pass the conformance vectors that contract pins.

## When in doubt

Ask Knox. Don't invent spec language, don't publish packages, don't promote drafts to stable, don't force-push.
