# Contributing to PACT

Thank you for your interest in contributing to the PACT specification. Whether you're fixing a typo, proposing a spec change, or building an implementation, we welcome your contribution.

## Ways to Contribute

| Contribution | Where | How |
|-------------|-------|-----|
| **Spec changes** | This repo | Open an issue first (use the `rfc` label for protocol changes); on accept, PR `spec/vX.Y/SPECIFICATION.md` to `main`. Normative changes require maintainer sign-off. |
| **README / docs / examples** | This repo | Fork, edit, PR to `main` |
| **Bug reports** | [GitHub Issues](https://github.com/TailorAU/pact/issues) | Use the appropriate issue template |
| **New implementation** | This repo | Add to the Implementations table in README.md |
| **Schema improvements** | This repo | PR `spec/vX.Y/schemas/` to `main`; keep schemas in lock-step with the prose spec |

## How the Spec Is Maintained

**This repository is the canonical source of truth for the PACT specification.** The spec lives here at:

- `spec/vX.Y/SPECIFICATION.md` (current stable: `spec/v2.0/`)
- `spec/vX.Y/GETTING_STARTED.md`
- `spec/vX.Y/schemas/`

A downstream mirror exists at `tailor-app/docs/architecture/PACT_SPECIFICATION.md` (a private monorepo). That copy is **generated from this repo** by `tools/mirror-spec.ps1` — it is never hand-edited and is not a place to contribute. (Historically the spec originated in tailor-app and was mirrored out; that direction reversed and is now automated. Do not propose changes there.)

## Contributing Changes

### For specification changes

1. **Open an issue first.** Use the `rfc` label for any change to protocol behaviour, wire format, or schemas. Substantive spec changes are discussed before code.
2. On acceptance, fork this repository and edit the relevant `spec/vX.Y/SPECIFICATION.md` (and any `spec/vX.Y/schemas/` in lock-step).
3. Open a PR against `main`. Normative changes require maintainer sign-off and must keep prose and schemas consistent.
4. Once merged, the maintainer mirrors the change out to the downstream tailor-app copy via `tools/mirror-spec.ps1` — contributors do not need to touch the mirror.

> Note: frozen spec versions (`spec/v0.3/`–`spec/v2.0/`) are immutable for citation stability; defects are handled via an additive `ERRATA.md`, and new work lands in a new `spec/vX.Y/` directory. See `AGENTS.md`.

### For README / docs / examples / meta changes

1. Fork this repository
2. Create a branch: `git checkout -b my-change`
3. Make your changes
4. Ensure Markdown links are valid
5. Open a PR against `main`

## Specification Versioning

- The spec uses semantic versioning: `v{major}.{minor}`
- Breaking changes increment the major version
- New operations or clarifications increment the minor version
- Each version lives in its own directory: `spec/v0.3/`, `spec/v0.4/`, etc.

## Implementing PACT

Anyone can implement the PACT protocol, royalty-free. The **specification and schemas** (`spec/**`) are licensed under the [Specification License](SPEC-LICENSE.md) — a perpetual royalty-free copyright **and patent** grant for Conformant Implementations (with defensive termination). The **software** in this repo is [MIT](LICENSE). Contributions are inbound = outbound under both (see `SPEC-LICENSE.md` §6). Note: neither license grants the "PACT" / "PACT Conformant" marks (`SPEC-LICENSE.md` §4).

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
