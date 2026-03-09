# Contributing to PACT

Thank you for your interest in contributing to the PACT specification. Whether you're fixing a typo, proposing a spec change, or building an implementation, we welcome your contribution.

## Ways to Contribute

| Contribution | Where | How |
|-------------|-------|-----|
| **Spec changes** | [tailor-app](https://github.com/TailorAU/tailor-app) repo | Fork, edit `docs/architecture/`, PR to `dev` |
| **README / docs / examples** | This repo | Fork, edit, PR to `main` |
| **Bug reports** | [GitHub Issues](https://github.com/TailorAU/pact/issues) | Use the appropriate issue template |
| **New implementation** | This repo | Add to the Implementations table in README.md |
| **Schema improvements** | [tailor-app](https://github.com/TailorAU/tailor-app) repo | Fork, edit `docs/architecture/`, PR to `dev` |

## How the Spec Is Maintained

The canonical source of truth for the PACT specification lives in the [tailor-app](https://github.com/TailorAU/tailor-app) repository at:

- `docs/architecture/PACT_SPECIFICATION.md`
- `docs/architecture/PACT_GETTING_STARTED.md`

This repository (`pact`) is automatically synced from `tailor-app` on every push to the `dev` branch. Changes made directly to `spec/` in this repository will be overwritten by the next sync.

## Contributing Changes

### For specification changes

1. Fork [TailorAU/tailor-app](https://github.com/TailorAU/tailor-app)
2. Edit the spec files under `docs/architecture/`
3. Open a PR against the `dev` branch
4. Changes will auto-publish here once merged

### For README / docs / examples / meta changes

1. Fork this repository
2. Create a branch: `git checkout -b my-change`
3. Make your changes
4. Ensure Markdown links are valid
5. Open a PR against `main`

These changes will NOT be overwritten by the sync (which only touches `spec/`).

## Specification Versioning

- The spec uses semantic versioning: `v{major}.{minor}`
- Breaking changes increment the major version
- New operations or clarifications increment the minor version
- Each version lives in its own directory: `spec/v0.3/`, `spec/v0.4/`, etc.

## Implementing PACT

Anyone can implement the PACT protocol. The specification and schemas are MIT-licensed.

If you've built an implementation:
1. Open a PR to add it to the "Implementations" table in `README.md`
2. Include: implementation name, link, status, and maintainer
3. Optionally use the `implementation-listing` issue template

## Issue Templates

- **Spec Change** — Propose a change to the PACT specification
- **Agent Report** — Automated feedback from a PACT agent
- **Implementation Listing** — Register a new PACT implementation

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be respectful, be constructive, focus on the protocol.
