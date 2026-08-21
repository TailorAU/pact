# Reviewed one-document legislation ingest

This is the production runbook for repository-allowlisted legislation builds.
It covers the dedicated `Source — Reviewed Legislation Ingest` workflow and
the local dispatcher in `sites/source/scripts/`.

## Security and data contract

- Only `workflow_dispatch` on merged `main` is accepted. The
  `source-prod-ingest` environment is restricted to protected branches.
- Runs for the same canonical document ID queue and serialize. Runs for
  different IDs can proceed independently. The concurrency key is the
  runner-verified SHA-256 of the exact case-preserving canonical ID, avoiding
  length and punctuation ambiguities in the GitHub group name.
- The local dispatcher never reads the Source admin key. It accepts a
  committed builder key, not an arbitrary script path, and pins both builder
  dependencies/data files, the raw output SHA-256, and the exact normalized
  payload SHA-256. Imports use a fresh isolated bytecode cache so an
  external-root `.pyc` cannot bypass source pins. Each build runs in a fresh
  snapshot containing only that manifest-pinned dependency closure; unpinned
  sibling modules in the external root are unavailable.
- Each manifest entry declares whether `relatedDocs` is an explicit replacement
  or an omission that preserves stored relations. Omission is preserved in the
  POST body; it is never silently converted to `[]`.
- The workflow validates its complete compact input serialization at 60,000
  bytes, strictly decodes base64, and streams gzip expansion to a 16 MiB cap
  before the credentialed job can start. It also binds the builder key,
  normalized payload hash, document metadata, diagnostic terms, and relation
  policy back to the manifest in trusted `main`; valid but unauthorized manual
  payloads therefore fail in the credential-free job.
- URL validation in the dependency-free Python runner is an intentional
  conservative subset of Source's WHATWG parser: reviewed builders must emit
  an explicit `http(s)://` URL with an unambiguous ASCII host, no whitespace,
  backslashes, or userinfo. This can reject an unusual Source-valid URL, but it
  must never authorize a URL that Source would reject. Shared differential
  vectors lock both classifications.
- The only authoritative success condition is the v1 canonical read:
  `GET /api/axiom/legislation?id=<encoded-id>&format=canonical`. Its normalized
  document and lowercase SHA-256 must both equal the reviewed complete state.
  For a preserve write, the runner hydrates only that expected hash projection
  from the uncached pre-read (`stored relatedDocs` on 200, `[]` on 404). An
  unavailable or invalid exact state fails before POST.
- POST has at most three attempts. A timeout, reset, 408, 429, or 5xx triggers
  bounded exact-state reconciliation before another POST is permitted. Search
  terms run after exact success and produce warnings only.
- `ADMIN_SECRET` comes from `SOURCE_INGEST_ADMIN_KEY`. `CRON_SECRET` continues
  to come from `SOURCE_CRON_SECRET`; do not join or substitute these values.
  Because the exposed legacy value previously occupied both slots, admin
  staging alone is not complete remediation. Before the final merge, stage a
  distinct fresh cron value in the protected `prod` and `source-prod-cron`
  environments; each rotation requires its own production proof before it is
  marked complete. After the protected cron proof, delete only the repository
  secret `SOURCE_CRON_SECRET`; the unrelated `PACT_CRON_SECRET` must remain
  untouched.

The ingest and canonical endpoint contracts from #5307 and #5308 must be
merged and deployed before dispatching production data.

## Prepare and dry-run a reviewed builder

The approved external root is supplied explicitly. The key must exist in
`reviewed_legislation_builders.json`.

```powershell
cd C:\TailorOS\tailor-app\sites\source\scripts

python dispatch_reviewed_legislation_ingest.py `
  --builder-key financial-hardship-standard-2024 `
  --builder-root C:\TailorOS\pact-ingest `
  --dry-run

python dispatch_reviewed_legislation_ingest.py `
  --builder-key planning-act-2016 `
  --builder-root C:\TailorOS\pact-ingest `
  --dry-run
```

A dry run executes the builder twice with a minimal environment and checks
byte identity, path confinement, committed hashes, schema, ID, section count,
date, deterministic review hash, compression, relation policy, and the full
dispatch-size limit. Its output contains safe IDs, counts, sizes, hashes, and a
correlation ID only. The workflow emits the expected complete-state canonical
hash after its uncached pre-read. `--watch` retains a 60-second cap for each
dispatch and run-list CLI call, then uses a bounded 30-minute cap while
following the queued two-job workflow.

## Production deployment and verification

1. Merge the endpoint children (#5307 and #5308), bring this workflow child
   (#5309) up to that exact `main`, and complete review and every hosted gate.
2. Immediately before merging #5309, generate a fresh cron value without
   printing it and set the same value as `SOURCE_CRON_SECRET` in the protected
   `prod` and `source-prod-cron` environments. Confirm the distinct staged
   `SOURCE_INGEST_ADMIN_KEY` remains in protected `prod` and
   `source-prod-ingest`. Do not delete the repository cron secret yet.
3. Merge #5309 and watch its `cd-source.yml` run. Confirm the deployment is
   green, `/api/health` is healthy, and the reported Source version is the
   merged commit. This single deploy must activate the distinct rotated admin
   and cron values in Azure.
4. Dispatch the manual-only, read-only auth proof from `main`:
   `gh workflow run cron-source.yml -f job=auth-check --ref main`. Record its
   green Action run and confirm admin and cron auth are distinct. The
   `auth-check` choice is never scheduled, is excluded from `all`, and performs
   no database or maintenance mutation. After that proof, delete only the
   repository-level `SOURCE_CRON_SECRET`; leave the unrelated
   `PACT_CRON_SECRET` untouched. Mark the cron rotation complete, but keep the
   admin rotation pending until its later exact-ingest proof.
5. Confirm an exact read for the new document returns the contract 404 and an
   exact read for the update candidate returns a valid v1 canonical envelope.
6. Dispatch the new document and watch the Action:

   ```powershell
   python dispatch_reviewed_legislation_ingest.py `
     --builder-key financial-hardship-standard-2024 `
     --builder-root C:\TailorOS\pact-ingest `
     --watch
   ```

7. Record the Action run ID. Verify the exact response reports 31 sections and
   the complete-state hash emitted by the workflow. A search warning does not
   invalidate this evidence.
8. Dispatch `planning-act-2016` the same way. Verify 80 sections,
   `inForceDate=2017-07-03`, `lastAmendedDate=2026-04-27`, and the workflow's
   complete-state hash.
9. Dispatch each key once more. Both runs must report exact canonical equality
   and skip POST.
10. Record the deploy run, read-only cron auth proof, deletion of only the
    repository-level `SOURCE_CRON_SECRET`, both ingest runs, both no-op reruns,
    exact stored/expected hashes and counts, and protected-environment
    configuration in #5309/#5310 without recording any credential value.

If verification fails, stop further dispatches. Leave the admin/cron secret
split in place, preserve the protected scopes, and fix or roll forward the
application promptly; do not restore the exposed shared value. Never restore
`ADMIN_SECRET` from `SOURCE_CRON_SECRET` as a rollback mechanism, and never
delete or rotate the unrelated `PACT_CRON_SECRET` as part of this ceremony.
