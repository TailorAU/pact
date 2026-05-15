# tools/

Maintenance tooling for the PACT repo. Not shipped; not part of any package.

## `mirror-spec.ps1`

Automates the pact-repo → tailor-app spec mirror — the manual dance behind
PRs [#1616](https://github.com/TailorAU/tailor-app/pull/1616) /
[#1673](https://github.com/TailorAU/tailor-app/pull/1673) /
[#1679](https://github.com/TailorAU/tailor-app/pull/1679) /
[#1701](https://github.com/TailorAU/tailor-app/pull/1701).

PACT and tailor-app are deliberately separate repos (see `AGENTS.md` and the
"do not merge PACT/HMAN" decision). The cost of that separation is the manual
mirror; this script removes the cost without dissolving the boundary.

```powershell
# Dry run — see the diff and the would-be PR body, change nothing:
./tools/mirror-spec.ps1 -Version 2.0.4 -DryRun

# Open the mirror PR, leave it for review:
./tools/mirror-spec.ps1 -Version 2.0.4

# Open + admin-squash-merge in one shot (the v2.0.x pattern):
./tools/mirror-spec.ps1 -Version 2.0.4 -AutoMerge
```

After an `-AutoMerge` run, backfill the resulting PR number into
`CHANGELOG.md` and `AGENTS.md` (replace the `PR TBD` placeholder), commit,
push — the script prints the reminder with the PR number.

Defaults: `-PactRepo` = this repo; `-TailorApp` = `C:\TailorOS\tailor-app`
(canonical as of 2026-05-13). Override either if your clone differs. The
script is idempotent on failure — the throwaway worktree and local branch
are removed in a `finally` block.

Requires: PowerShell 7+, `git`, `gh` (authenticated).
