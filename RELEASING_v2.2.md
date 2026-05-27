# Releasing PACT v2.2 — Matter primitive launch

> One-page turn-key checklist for the v2.2 release. Single source of truth for
> the npm publish step (cascade item 6). Read top-to-bottom, do each step,
> tick the box. Idempotent — safe to re-run any step if interrupted.

The marquee v2.2 feature is the §24 **Matter** primitive (multi-fabric deal-
room workspaces). Spec stable as of `729be1a` (`spec/v2.2/`); reference impl
+ CLI + MCP shipped at `25ab719`; CI smoke test runs `tools/matter-smoke.sh`
on every PR/push.

---

## Hard prerequisites (all must be ✅ before any publish)

- [ ] **`@pact-protocol` npm org exists.** Verify with `npm view @pact-protocol/cli` — `E404 Not Found` = org doesn't exist yet (or this package never published — same fix path). Org creation is npm-account-owner-only; cannot be automated. See [npm docs](https://docs.npmjs.com/creating-an-organization).
- [ ] **`NPM_TOKEN` secret on TailorAU/pact.** Verify: `gh secret list --repo TailorAU/pact | grep NPM_TOKEN`. Create a granular or classic npm **automation** token (publish-scoped to `@pact-protocol`) and add via **Settings → Secrets and variables → Actions → New repository secret**.
- [ ] **Logged in as a member of `@pact-protocol`.** Verify: `npm whoami` (should not 401) and `npm org ls pact-protocol` should list your username.
- [ ] **`spec/v2.2/` exists on `main`.** Already shipped — `git ls-remote origin main:refs/heads/main` and `gh api repos/TailorAU/pact/contents/spec/v2.2/SPECIFICATION.md` should return 200.
- [ ] **Reference server smoke green on main.** Verify: `gh run list --repo TailorAU/pact --workflow conformance.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` returns `"success"`.

If any prerequisite fails: stop here. Fix that one item, then re-run this checklist from the top.

---

## Step 1 — Version bump + tag

The `tools/promote-matters-to-v2.2.ps1` script already bumped `cli/`, `mcp/`, and `reference-server/` `package.json` to `2.2.0` during the spec promotion. Verify before continuing:

```bash
for d in cli mcp reference-server; do
  v=$(python3 -c "import json;print(json.load(open('$d/package.json'))['version'])")
  echo "$d: $v"
done
# expected: all three print 2.2.0
```

If any are still `2.0.3` (promotion script didn't run): bump them manually with a single commit `release: v2.2.0 — bump CLI/MCP/ref-server to 2.2.0` and push to main.

Then tag:

```bash
git checkout main
git pull
git tag v2.2.0
git push origin v2.2.0
```

- [ ] All three `package.json` at `2.2.0`
- [ ] Tag `v2.2.0` pushed to origin

---

## Step 2 — CHANGELOG entry

Open `CHANGELOG.md`, add a `## v2.2.0 — YYYY-MM-DD` section at the top:

```markdown
## v2.2.0 — 2026-MM-DD

### Added — §24 Matter primitive
- Multi-fabric deal-room workspaces; see [spec/v2.2/SPECIFICATION.md §24](spec/v2.2/SPECIFICATION.md)
- 10 REST endpoints under `/api/pact/matters[/...]`
- 6 event types: `pact.matter.opened`, `.member-added`, `.fabric-attached`, `.fabric-detached`, `.message`, `.closed`
- Cross-fabric manifest (§24.7) — aggregates pending §6.5 obligations across all attached fabrics for the caller
- §17.13 disclosure reduction on `counterparties` (cross-org peers carry `cross_org: true`)
- New conformance vectors under `spec/v2.2/conformance/matters/` + `tools/matter-smoke.sh` (20 assertions)
- New `matter-smoke` CI job in `.github/workflows/conformance.yml`

### Added — reference implementations
- `@pact-protocol/cli` 2.2.0: `pact matter open / list / show / add-member / attach / detach / message / messages / manifest / close`
- `@pact-protocol/mcp` 2.2.0: `pact_matter_*` tools (10 tools)
- `@pact-protocol/reference-server` 2.2.0: in-memory implementation of every §24 endpoint

### Added — tooling
- `tools/promote-matters-to-v2.2.ps1` — gated v2.2 promotion script (used to produce this release)
- `tools/mirror-spec.ps1 -SourceVersion` — parameterise spec source path for v2.2+ mirrors

### Spec
- §24 Matters normative; carries the seven OQ resolutions from RFC #18
- §15.1 implementation profile carries `capabilities.matters: true`
- `v2.0.x` remains "Consensus and Truth" backronym (frozen for citation stability)
- `v2.1+` is "Contexture and Trust"; v2.2 inherits

### Mirrored
- tailor-app: `docs/architecture/PACT_SPECIFICATION.md` updated to v2.2 (see tailor-app#XXXX)
- tailor-app reference impl: full Matter endpoints + EF migration (tailor-app#2324)

### Marketing
- Tagline aligned (PR #23): "Think Signal, but for multi-agent and human consensus. Collapses gate reviews from weeks to days."
```

Replace `YYYY-MM-DD` with today's date and `XXXX` with the mirror PR number once `tools/mirror-spec.ps1 -Version 2.2.0 -SourceVersion 2.2 -AutoMerge` runs.

Commit: `docs(changelog): v2.2.0`

- [ ] CHANGELOG.md updated and committed

---

## Step 3 — Mirror to tailor-app

```powershell
./tools/mirror-spec.ps1 -Version 2.2.0 -SourceVersion 2.2 -DryRun      # sanity check
./tools/mirror-spec.ps1 -Version 2.2.0 -SourceVersion 2.2 -AutoMerge    # real run
```

The script opens + admin-squash-merges the PR on `TailorAU/tailor-app`. Note the PR number returned in the script output, backfill into the CHANGELOG entry above with a follow-up commit.

- [ ] tailor-app mirror PR opened + auto-merged
- [ ] CHANGELOG XXXX backfilled

---

## Step 4 — GitHub Release (triggers the npm publish)

Easiest path:

```bash
gh release create v2.2.0 \
  --repo TailorAU/pact \
  --title "PACT v2.2.0 — Matter primitive launch" \
  --notes-file <(awk '/^## v2.2.0/,/^## v2[0-9.]+/' CHANGELOG.md | head -n -2)
```

This publishes the GitHub Release. Because `.github/workflows/publish-packages.yml` triggers on `release: published`, **both `@pact-protocol/cli@2.2.0` and `@pact-protocol/mcp@2.2.0` are auto-published** with no further action.

Alternative (manual workflow_dispatch):

```bash
gh workflow run publish-packages.yml --repo TailorAU/pact
```

Watch the run:

```bash
gh run watch --repo TailorAU/pact $(gh run list --repo TailorAU/pact --workflow publish-packages.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

- [ ] GitHub Release `v2.2.0` published
- [ ] `Publish CLI and MCP` workflow ran successfully

---

## Step 5 — Post-publish verification (the smoke that closes the cascade)

```bash
# Versions land on the registry
npm view @pact-protocol/cli version          # expect: 2.2.0
npm view @pact-protocol/mcp version          # expect: 2.2.0

# CLI actually installs and exposes pact matter *
npx --yes @pact-protocol/cli@2.2.0 --help | grep -A 1 "matter"
# expect: a line like "matter   Multi-fabric deal-room workspaces (v2.2 ..."

# MCP exposes the matter tools
npx --yes @pact-protocol/mcp@2.2.0 --help
# (or stdio-probe — list tools should include pact_matter_open ... pact_matter_close)
```

End-to-end smoke against a running reference server:

```bash
# In one shell:
npx --yes @pact-protocol/reference-server@2.2.0 --port 4100 &
# In another:
PACT_BASE_URL=http://127.0.0.1:4100 npx --yes @pact-protocol/cli@2.2.0 \
  matter open --name "Release smoke" --display-name "release"
```

- [ ] `npm view` returns 2.2.0 for both packages
- [ ] `npx @pact-protocol/cli@2.2.0 matter --help` shows the 10 subcommands
- [ ] End-to-end smoke against `@pact-protocol/reference-server@2.2.0` succeeds

---

## Step 6 — Close the cascade

- [ ] Comment on TailorAU/pact#5 with the published versions → close #5
- [ ] Comment on TailorAU/pact#18 with the npm version → close #18
- [ ] Comment on TailorAU/pact#20 noting npm-availability for impls; leave open for ongoing adoption (Tailor + AloomU + future)
- [ ] Announce on whatever channels Tailor uses publicly (Twitter, blog, etc.)

That's it. v2.2 is live on npm.

---

## Rollback (in case something breaks post-publish)

```bash
# npm — within 72h of publish, you can unpublish a single version:
npm unpublish @pact-protocol/cli@2.2.0
npm unpublish @pact-protocol/mcp@2.2.0
# After 72h, unpublish is restricted; publish 2.2.1 with the fix instead.

# spec — frozen-version rule applies: v2.2 stays on disk, future fixes go to v2.2/ERRATA.md
# or to v2.3
```

## Why this checklist exists

The npm publish step (cascade item 6) was the only `→ live` state an agent could not push forward without your npm credentials. Everything else — code, CI, spec, mirror, Tailor deploy — is already done. This document collapses the remaining work into a single page so the release ritual is friction-free when you get to it.
