# Releasing `@pact-protocol/cli` and `@pact-protocol/mcp`

## Prerequisites

1. An [npm](https://www.npmjs.com/) account with publish rights to the `@pact-protocol` organization.
2. A granular or classic npm access token with **Publish** permission.

## One-time: GitHub Actions (recommended)

1. In the **TailorAU/pact** repo: **Settings → Secrets and variables → Actions**.
2. Create secret **`NPM_TOKEN`** with your npm automation token.
3. Run workflow **Publish CLI and MCP** manually: **Actions → Publish CLI and MCP → Run workflow**.

Alternatively, create a **GitHub Release**; the same workflow runs on `release: published` and publishes both packages at the version in each `package.json`.

## Manual publish (maintainers)

```bash
cd cli && npm ci && npm run build && npm publish --access public
cd ../mcp && npm ci && npm run build && npm publish --access public
```

Ensure you are logged in (`npm whoami`) and a member of the `@pact-protocol` scope.

## Version bumps

Bump `version` in `cli/package.json` and `mcp/package.json` together (keep aligned unless you intentionally diverge), commit, then release.

## Smoke test after publish

```bash
npm view @pact-protocol/cli version
npm view @pact-protocol/mcp version
npx --yes @pact-protocol/cli --help
PACT_BASE_URL=https://example.com PACT_API_KEY=test npx --yes @pact-protocol/mcp --help
```
