# PACT Repo — Agent Onboarding

If you're an AI agent (Claude Code, Cursor, or any framework) opening this repo: **read this first.**

This is the **public spec repo** for PACT — Protocol for Agent Contexture and Trust (the backronym was refined from "Consensus and Truth"; the **acronym and all `pact*` identifiers are unchanged**; "Contexture and Trust" is **normative from v2.1**, and shipped **v2.0.x stays "Consensus and Truth"** as-released per the frozen-version rule below). Vendor-neutral and **dual-licensed**: software (`cli/`, `mcp/`, `reference-server/`, runner, `tools/`) is MIT ([`LICENSE`](LICENSE)); the specification (`spec/**`) is under [`SPEC-LICENSE.md`](SPEC-LICENSE.md) — a royalty-free copyright + patent implementation grant with defensive termination (W3C/MCP/A2A pattern). Neither grants the "PACT" / "PACT Conformant" marks. Implementations live elsewhere; this repo holds the specification, reference CLI, reference MCP server, and a minimal reference server.

**Family map (read before confusing PACT with products):** [`docs/PACT_FAMILY.md`](docs/PACT_FAMILY.md). PACT is the protocol. `.HMAN` is the §17 reference impl (local voice enrol — no public register). AINK is money. Sovrgn is the intelligence market (`sovrgn.ai/hman` is 404). Do not invent a PACT signup.

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

## Open work (as of 2026-07-24)

**v2.0.3** is the latest tagged release. **`spec/v2.2/`** (Matter §24) is stable on `main` but **not** cut as `v2.2.0` / npm yet. Live product host: `https://pact.tailor.au` (KG). Document-server Matters: `https://api.tailor.au`. Owner takeover restocked the `ready` queue 2026-07-24.

| # | Title | Status | Owner |
|---|---|---|---|
| [#5](https://github.com/TailorAU/pact/issues/5) | Publish the CLI + MCP packages | **Reopened — plan invalidated (2026-08-05):** the `@pact-protocol` npm org name is **owned by an unrelated third party** (publishes `@pact-protocol/sdk`, "Protocol for Agent Credentials and Trust"). A Tailor-controlled scope must be chosen first — see `docs/npm-scope-decision.md`. No `NPM_TOKEN`. Knox-only. | Knox |
| [#33](https://github.com/TailorAU/pact/issues/33) | Cut v2.2.0 release | Blocked on #5. Checklist: `RELEASING_v2.2.md`. | Knox → agent |
| [#32](https://github.com/TailorAU/pact/issues/32) | Matter add-member idempotency (§24.6) | **`ready`** — decision (a) different-role = no-op. | agent |
| [#35](https://github.com/TailorAU/pact/issues/35) | Author `spec/v2.1/` §19–22 (Parley) | **`ready`** — RFC #14 converged. | agent |
| [#28](https://github.com/TailorAU/pact/issues/28) | Living-doc citation contract | Umbrella; children in tailor-app #4460/#4461/#4462 `ready`. | agent |
| [#34](https://github.com/TailorAU/pact/issues/34) | KG product extraction into this repo | Blocker — runtime still `tailor-app` `sites/source/`. Security-sensitive. | Knox |
| [#14](https://github.com/TailorAU/pact/issues/14) | RFC Parleys / Mandates | Accepted-with-modifications; delivery is #35. | — |
| [#18](https://github.com/TailorAU/pact/issues/18) / [#20](https://github.com/TailorAU/pact/issues/20) | Matters RFC + adoption | Spec/ref live; Tailor live with #4212 gaps; npm gap #5. | — |
| [#16](https://github.com/TailorAU/pact/issues/16) | SPEC-LICENSE counsel review | Open — not lawyer-vetted yet. | Knox + counsel |
| [#17](https://github.com/TailorAU/pact/issues/17) | Structural neutrality | Open — custodial gap tracked honestly. | Knox + legal |
| [#13](https://github.com/TailorAU/pact/issues/13) | AloomU production feedback | Can close when AloomU confirms. | AloomU + Knox |
| [#6](https://github.com/TailorAU/pact/issues/6) | Deprecate `tailor tap *` | Blocked on #5 + 30-day npm stability. | — |
| [#29](https://github.com/TailorAU/pact/issues/29) | §17 HAL attestation export deltas | Open RFC — not yet `ready`. | Knox |

### Heading toward v2.1 / v2.2 release

- **v2.1** (`#35`): §19 Parleys + §20 Mandate + §21 push + §22 service-account — draft in new directory; do not edit frozen `spec/v2.0/` or rewrite `spec/v2.2/` in that PR.
- **v2.2 release** (`#33`): tag + npm after #5 unblocks. Matter already in `spec/v2.2/`.
- **Absorb later:** when v2.1 is stable, re-carry into a v2.2 re-issue / v2.2.1 per `spec/v2.2/README.md`.

## Things you should NOT do

1. **Do not run `npm publish`** on `cli/` or `mcp/`. The `pact-protocol` npm org is **not ours** — it is owned by an unrelated third party (verified 2026-08-05; it publishes `@pact-protocol/sdk`). See [#5](https://github.com/TailorAU/pact/issues/5) and `docs/npm-scope-decision.md`. Any publish attempt against that scope will fail — and must not be retried under any scope until Knox picks one.
2. **Do not force-push** any branch. If a push is rejected, `git pull --rebase && git push`.
3. **Do not promote a draft `spec/vX.Y/` to stable** without explicit sign-off. (`spec/v2.0/` promoted 2026-05-14; `spec/v2.2/` Matter-line promoted 2026-05-27.) The next promotion is `spec/v2.1/` once #35 lands and is signed off — then absorb §19–22 into a v2.2 re-issue per `spec/v2.2/README.md`. v2.0.x patches inline are fine — they're not promotions.
4. **Do not edit the normative text or schemas of frozen versions: `spec/v0.3/`, `spec/v0.4/`, `spec/v1.0/`, `spec/v1.1/`, `spec/v2.0/`.** Older versions are frozen for citation stability. v2.0 is the current stable and is patched only via additive `ERRATA.md`, the cold-eye-audit v2.0.1 patch (which lands inline as the spec's stated-stable-but-patched-once), and any future minor/major (which goes to a new directory). `spec/v1.1/ERRATA.md` is the documented additive pattern; the same applies to v2.0 if defects are discovered post-release.
5. **Do not invent spec text.** Normative spec text (`spec/v2.0/SPECIFICATION.md`, schemas, or any future `spec/v2.1/`) is authored **here** — `pact-repo` is canonical (see the Source-of-truth note above) — but still requires explicit maintainer sign-off: agents MUST NOT freehand normative changes. `docs/v2-plan.yaml` and `docs/v2-prep/` are the design record; normative text lands via reviewed change, then mirrors **out** to tailor-app via `tools/mirror-spec.ps1` (never the old draft-in-tailor-app, back-port-here dance — that direction is superseded; the v2.0 mirror via [TailorAU/tailor-app#1616](https://github.com/TailorAU/tailor-app/pull/1616) and the v2.0.x patches #1673 / #1679 / #1701 are now all script-produced). **One exception:** HMAN-co-designed surfaces — currently the §18.3 `voice-biometric` crypto — remain authoritative in HMAN's coordinated [#3](https://github.com/TailorAU/pact/issues/3) PR per §18.6 and the `docs/v2-prep/v2.0.4-voice-biometric-lockdown.yaml` contract; mirror that in when it lands, don't freehand it. Cosmetic/typo/link/structure-only edits (no normative meaning change) are exempt.
6. **Do not rename `cli/` or `mcp/` unilaterally.** The eventual published scope is a pending Knox decision ([#5](https://github.com/TailorAU/pact/issues/5), `docs/npm-scope-decision.md`) — the current `@pact-protocol/*` package names **cannot publish as-is** because that npm scope is owned by an unrelated third party. Until #5 resolves: do not rename anything, do not publish anywhere, and do not add `@pact-protocol/*` install commands to any doc (install-from-source is the only documented path).

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
| `@pact-protocol/cli` | `cli/` | Built, **not yet on npm**; scope pending decision ([#5](https://github.com/TailorAU/pact/issues/5)) | TBD — scope pending #5 |
| `@pact-protocol/mcp` | `mcp/` | Built, **not yet on npm**; scope pending decision ([#5](https://github.com/TailorAU/pact/issues/5)) | TBD — scope pending #5 |

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
