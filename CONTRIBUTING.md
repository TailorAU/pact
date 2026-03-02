# Contributing to PACT

Thank you for your interest in contributing to the PACT specification.

## How the Spec Is Maintained

The canonical source of truth for the PACT specification lives in the [tailor-app](https://github.com/TailorAU/tailor-app) repository at:

- `docs/architecture/PACT_SPECIFICATION.md`
- `docs/architecture/PACT_GETTING_STARTED.md`

This repository (`pact`) is automatically synced from `tailor-app` on every push to the `dev` branch. Changes made directly to this repository will be overwritten by the next sync.

## Contributing Changes

### For specification changes

1. Fork [TailorAU/tailor-app](https://github.com/TailorAU/tailor-app)
2. Edit the spec files under `docs/architecture/`
3. Open a PR against the `dev` branch
4. Changes will auto-publish here once merged

### For README / meta changes to this repo

1. Fork this repository
2. Open a PR against `main`
3. These changes will NOT be overwritten by the sync (which only touches `spec/`)

## Specification Versioning

- The spec uses semantic versioning: `v{major}.{minor}`
- Breaking changes increment the major version
- New operations or clarifications increment the minor version
- Each version lives in its own directory: `spec/v0.3/`, `spec/v0.4/`, etc.

## Implementing PACT

Anyone can implement the PACT protocol. If you've built an implementation, open a PR to add it to the "Implementations" table in `README.md`.

## Code of Conduct

Be respectful. Be constructive. Focus on the protocol, not the people.
