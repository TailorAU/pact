# npm scope decision — `@pact-protocol` is externally owned

Status: **DECIDED 2026-08-05 (Knox): Option B — `@pact-spec`.** Fallback if the org name proves unavailable at creation time: Option A (`@pact_`, already Tailor-owned). Availability could not be verified anonymously — npm confirms it at org creation. Filed 2026-08-05 · Tracks [#5](https://github.com/TailorAU/pact/issues/5); gates [#33](https://github.com/TailorAU/pact/issues/33) (v2.2.0 release) and [#6](https://github.com/TailorAU/pact/issues/6) (`tailor tap` deprecation).

## Verified facts (2026-08-05)

- The npm scope **`@pact-protocol` is owned by an unrelated third party**: `@pact-protocol/sdk` 0.5.0, maintainer `beek3 <bkauhl3@gmail.com>` (Brenden Kauhl), "PACT Protocol — TypeScript SDK for agent identity, delegation, trust, and commitments" ("Protocol for Agent **Credentials** and Trust", Apache-2.0, github.com/bkauhl3/pact-protocol). Verified via `npm view @pact-protocol/sdk`.
- `npm view @pact-protocol/cli` → **E404**. Every doc that assumed "E404 = org uncreated" (RELEASING_v2.2.md pre-flight, AGENTS.md rule 1, issue #5's plan "create the pact-protocol npm org") was reasoning from a false premise: the org exists and is not ours.
- **Exposure:** `npm i -g @pact-protocol/cli` has been advertised on this README and on `pact.tailor.au`. If the scope owner ever publishes a `cli` or `mcp` package, users following our instructions would install a stranger's code (dependency-confusion shape). This PR removes every live install reference; the tailor-app-side pages are fixed in a companion PR.
- Tailor **does** control the `@pact_` scope: `@pact_/cli` and `@pact_/mcp` 1.0.0 published 2026-04-09 by `tailor-au <admin@tailorco.au>` — but at v1.0.0 they lag the in-repo 2.0.3 packages.
- PyPI **`source-tailor-tools` is referenced on pact.tailor.au (/get-started, /mcp) but is unregistered** (pypi simple index 404) — squattable today.
- Availability of alternative npm org names **could not be verified anonymously** (npmjs.com and the registry user endpoint both reject unauthenticated probes). npm shows availability at org-creation time; verifying a candidate takes one authenticated attempt.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Reuse `@pact_`** (already ours) | Exists now; zero acquisition risk; prior `@pact_/cli` 1.0.0 gives version continuity | Awkward trailing underscore; scope name conveys nothing about the protocol; the 1.0.0 relics predate the v2 spec |
| **B. New org, protocol-flavored** (candidates to check, in order: `pact-spec` — matches the `pact-spec.dev` schema host already baked into `$id` paths; `pactprotocol`; `pact-au`) | Clean identity; `@pact-spec/*` aligns with an identifier the spec already uses | Availability unverified until attempted; another rename of docs if a candidate is taken |
| **C. Org-branded: `tailorau`** | Unambiguous provenance; useful beyond PACT | Cuts against the vendor-neutrality posture (GOVERNANCE.md, issue #17) — the package would carry the vendor's name forever |
| **D. Approach the `@pact-protocol` owner / npm dispute** | Keeps every existing reference intact | Owner's use is legitimate (real, active, adjacent project — not squatting), so an npm dispute is unlikely to succeed; contact adds delay and an external dependency |

**Recommendation:** B with `pact-spec` as first candidate (falling back to A if taken) — it is the only candidate that already appears in shipped identifiers, and it keeps vendor neutrality. Whatever is chosen, `SECURITY.md`/README should permanently note that `@pact-protocol` on npm is unaffiliated.

## Decision-execution checklist (after Knox picks)

1. Create/confirm the org; mint a granular automation token scoped to it; add as `NPM_TOKEN` repo secret (RELEASING.md flow).
2. Rename `cli/`, `mcp/`, `reference-server/`, and the conformance-runner `package.json` names to the chosen scope (AGENTS.md rule 6 revision rides in the same PR — frozen `spec/v*/conformance/runner/package.json` copies get an ERRATA note, not an edit).
3. Restore real install commands in README/AGENTS.md/site + pact.tailor.au (reversing the from-source fallback this PR introduces).
4. Register the PyPI name `source-tailor-tools` (or strip those references from pact.tailor.au) — separate 10-minute action, currently squattable.
5. Update #5's acceptance criteria to the new scope; then run [#33](https://github.com/TailorAU/pact/issues/33) per `RELEASING_v2.2.md`.
