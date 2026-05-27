# PACT v2.2 — DRAFT (NOT FOR CITATION)

> ⚠️ **This directory is DRAFT and NOT stable.** Per AGENTS.md rule 3, no
> draft `spec/vX.Y/` directory is stable until the maintainer explicitly
> signs off promotion. This v2.2 directory exists to make the §24 Matter
> primitive runnable + testable in a real spec layout, but it is **not**
> the canonical PACT v2.2 spec.
>
> **Why it's here:** PR #19 landed the Matter primitive as a v2.2-draft.
> The goal-driven cascade required "live in spec" — this directory is
> that step's best-effort outcome given the v2.1 RFC #14 gate.

## What this v2.2 draft contains

- **Full carry-forward of `spec/v2.0/`** — all of v2.0's normative text,
  schemas, conformance vectors, runner, resource-types registry. v2.0
  remains FROZEN (AGENTS.md rule 4); this is a copy, not an edit.
- **§24 Matter primitive (added)** — appended to `SPECIFICATION.md`
  from `docs/v2-prep/matters-spec-draft.md` with DRAFT front-matter
  stripped + `2.2-draft` version-string sub.
- **`schemas/matter-*.json` (added)** — 10 JSON Schemas moved from
  `docs/v2-prep/matters-schemas/` with `$id` paths rewritten from
  `pact-spec.dev/schemas/v2.2-draft/` to `/v2.2/`.
- **`conformance/extended/matters/*.yaml` (added)** — 5 conformance
  vectors moved from `docs/v2-prep/matters-vectors/` with vector IDs
  rewritten from `matters/...` to `extended/matters/...` per the
  existing v2.0 vector convention.

## What this v2.2 draft DOES NOT contain

The v2.1 normative tracks (§19 Parleys, §20 Mandate, §21 push delivery,
§22 service-account auth) are **NOT in this directory**. They live in
RFC #14 and `docs/v2-prep/v2.1-scope.yaml` and must ship as v2.1 first
(or be folded into a future v2.2 carry-forward) before they become spec.

**This means a real v2.2 — the one Knox eventually signs off as stable —
will need to be re-carried-forward from v2.1 to absorb the §19-22 work.**
That second carry-forward will overwrite this directory's structure;
the §24 Matter content folds in unchanged.

## Promotion to stable

When v2.1 ships (RFC #14 converges + maintainer sign-off) and
maintainer signs off on v2.2:

```powershell
# Delete this draft v2.2 directory:
rm -rf spec/v2.2/

# Run the proper promotion (which carries v2.1 forward + folds Matter):
./tools/promote-matters-to-v2.2.ps1 -SignedOffBy "Knox Hart"
```

Or, if v2.2 is decided to be Matter-only (skipping v2.1's tracks):
this directory is the basis — promote it to stable by removing the
DRAFT marker in this README and tagging.

## Cascade context

Step 3 of the "make Matter production-live" cascade. The cascade is
itself driven via a Matter (`mtr_1mpnmfu8v`; see
`docs/v2-prep/matter-v2.2-landing-manifest.json` for the audit trail).

## Citation

Until promoted to stable: **DO NOT cite this directory as PACT v2.2.**
Cite `spec/v2.0/` instead. Cite §24 Matter content via the PR / RFC #18.
