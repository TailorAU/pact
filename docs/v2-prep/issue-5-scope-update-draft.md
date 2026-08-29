# Comment for issue #5 — POSTED 2026-08-05 (adapted with the decided scope: `@pact-spec`)

> Historical draft. The live comment on #5 supersedes this file; scope decision recorded in `docs/npm-scope-decision.md`.

---

**The plan in this issue is invalidated — the `@pact-protocol` npm org cannot be created because it already exists under third-party ownership.**

Verified 2026-08-05:

- `npm view @pact-protocol/sdk` → `0.5.0`, maintainer `beek3 <bkauhl3@gmail.com>` — "PACT Protocol — TypeScript SDK for agent identity, delegation, trust, and commitments" (an unrelated project: "Protocol for Agent **Credentials** and Trust", github.com/bkauhl3/pact-protocol).
- `npm view @pact-protocol/cli` → E404. The RELEASING_v2.2.md pre-flight's "E404 = org doesn't exist yet" inference was wrong: the org exists, it just isn't ours and has never published a `cli`.
- Until now the README and pact.tailor.au advertised `npm i -g @pact-protocol/cli`. That command fails today — and would install the third party's code if they ever publish a `cli` under their scope. Reference hygiene PR: removes every live `@pact-protocol` install command (README, AGENTS.md, RELEASING*.md) and adds `docs/npm-scope-decision.md`; a companion tailor-app PR fixes the pact.tailor.au pages.

New acceptance path for this issue:

1. **Knox picks a scope** — options + recommendation in `docs/npm-scope-decision.md` (short version: `@pact-spec` first candidate, `@pact_` — which Tailor already owns and published `@pact_/cli` 1.0.0 into — as fallback; full trade-offs in the doc).
2. Rename packages to the chosen scope (supersedes AGENTS.md rule 6 as written), mint `NPM_TOKEN`, publish per RELEASING.md.
3. Restore real install commands across README / site / pact.tailor.au.
4. Also flagged: PyPI `source-tailor-tools` is referenced on pact.tailor.au but unregistered — squattable; register or strip.

#33 (v2.2.0 release) and #6 (`tailor tap` deprecation) remain downstream of this decision.
