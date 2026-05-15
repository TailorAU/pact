#!/usr/bin/env pwsh
#Requires -Version 7
<#
.SYNOPSIS
  Mirror spec/v2.0/SPECIFICATION.md from pact-repo into the canonical
  tailor-app mirror (docs/architecture/PACT_SPECIFICATION.md) via a
  coordinated PR — automating the manual dance behind PRs #1616 / #1673 /
  #1679 / #1701.

.DESCRIPTION
  PACT and tailor-app are deliberately separate repos (see AGENTS.md and
  the "should we merge PACT/HMAN" decision: no). The cost of that
  separation is the manual mirror. This script removes the manual cost
  without dissolving the boundary:

    1. Validates both repos + the spec file exist.
    2. Fetches tailor-app origin/main.
    3. Creates a throwaway worktree off origin/main.
    4. Copies the pact-repo spec over the mirror file.
    5. If there is no diff, aborts cleanly (nothing to mirror).
    6. Commits with the conventional `spec: mirror PACT vX.Y.Z` message.
    7. Pushes the branch and opens a PR with the standard body.
    8. With -AutoMerge: admin-squash-merges (enforce_admins is false on
       tailor-app main; build-test is the only required check and it does
       not fire on doc-only PRs — gitleaks is informational).
    9. Cleans up the worktree and local branch.

  The script is idempotent on failure: the worktree and local branch are
  removed in a finally block so a half-run leaves no debris.

.PARAMETER Version
  The PACT version being mirrored, e.g. "2.0.3". Drives the branch name,
  commit message, PR title, and the CHANGELOG anchor link.

.PARAMETER PactRepo
  Path to the pact-repo working tree. Defaults to the repo this script
  lives in (two levels up from tools/).

.PARAMETER TailorApp
  Path to the canonical tailor-app clone. Defaults to C:\TailorOS\tailor-app
  (canonical as of 2026-05-13 — moved off OneDrive).

.PARAMETER SourceCommit
  Short SHA of the pact-repo release commit, embedded in the commit/PR
  body for provenance. Defaults to the current pact-repo HEAD short SHA.

.PARAMETER AutoMerge
  If set, admin-squash-merge the PR and delete the remote branch after it
  is created. Without this flag the PR is left open for manual review.

.PARAMETER DryRun
  If set, do everything except push / open-PR / merge. Prints the diff
  stat and the would-be PR body, then cleans up. Use this to sanity-check
  before a real run.

.EXAMPLE
  ./tools/mirror-spec.ps1 -Version 2.0.3 -AutoMerge

.EXAMPLE
  ./tools/mirror-spec.ps1 -Version 2.0.4 -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [string]$PactRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,

  [string]$TailorApp = 'C:\TailorOS\tailor-app',

  [string]$SourceCommit,

  [switch]$AutoMerge,

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---- Derived constants -----------------------------------------------------
$specRel      = 'spec/v2.0/SPECIFICATION.md'
$mirrorRel    = 'docs/architecture/PACT_SPECIFICATION.md'
$branch       = "spec-mirror-v$Version"
$worktreeRel  = ".claude/worktrees/$branch"
$specPath     = Join-Path $PactRepo $specRel
$worktreePath = Join-Path $TailorApp $worktreeRel
$mirrorPath   = Join-Path $worktreePath $mirrorRel
# CHANGELOG.md anchor convention: "## vX.Y.Z — YYYY-MM-DD" -> "vXYZ--yyyy-mm-dd".
$anchorVer    = "v$($Version -replace '\.','')"

function Fail([string]$m) { Write-Error $m; exit 1 }

# ---- Pre-flight ------------------------------------------------------------
if (-not (Test-Path $specPath))  { Fail "Spec not found: $specPath" }
if (-not (Test-Path $TailorApp)) { Fail "tailor-app not found: $TailorApp (override with -TailorApp)" }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "gh CLI not on PATH." }

if (-not $SourceCommit) {
  $SourceCommit = (git -C $PactRepo rev-parse --short HEAD).Trim()
}

Write-Host "Mirroring PACT v$Version" -ForegroundColor Cyan
Write-Host "  pact-repo : $PactRepo @ $SourceCommit"
Write-Host "  tailor-app: $TailorApp"
Write-Host "  branch    : $branch"
if ($DryRun)    { Write-Host "  mode      : DRY RUN (no push / PR / merge)" -ForegroundColor Yellow }
elseif ($AutoMerge) { Write-Host "  mode      : auto-merge (admin squash)" -ForegroundColor Yellow }

$cleanupNeeded = $false
try {
  # ---- Worktree off a fresh origin/main ------------------------------------
  git -C $TailorApp fetch origin main --quiet
  if (Test-Path $worktreePath) {
    git -C $TailorApp worktree remove $worktreeRel --force 2>$null
  }
  git -C $TailorApp worktree add $worktreeRel origin/main --quiet
  $cleanupNeeded = $true
  git -C $worktreePath checkout -b $branch --quiet

  # ---- Copy the spec over the mirror ---------------------------------------
  Copy-Item -LiteralPath $specPath -Destination $mirrorPath -Force

  $stat = git -C $worktreePath diff --stat -- $mirrorRel
  if (-not $stat) {
    Write-Host "No diff — mirror is already in sync. Nothing to do." -ForegroundColor Green
    return
  }
  Write-Host "Mirror diff:" -ForegroundColor Cyan
  Write-Host $stat

  $commitMsg = @"
spec: mirror PACT v$Version from pact-repo

Automated mirror via tools/mirror-spec.ps1.

Source: pact-repo tag v$Version (commit $SourceCommit). Full release
notes at https://github.com/TailorAU/pact/blob/v$Version/CHANGELOG.md#$anchorVer

Spec-only change. No code, no schemas, no docs-site impact. PACT and
tailor-app are deliberately separate repos; this mirror keeps the
canonical tailor-app copy in sync without dissolving the boundary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"@

  $prBody = @"
## Summary

Automated mirror of PACT spec v$Version from [pact-repo](https://github.com/TailorAU/pact) (tag ``v$Version``, commit ``$SourceCommit``) into ``$mirrorRel`` via ``tools/mirror-spec.ps1``.

Continues the established v2.0.x coordinated-PR pattern (#1616 / #1673 / #1679 / #1701). Spec-only diff — no code, no API contracts on the tailor-app side, no docs-site impact.

Full changelog: https://github.com/TailorAU/pact/blob/v$Version/CHANGELOG.md#$anchorVer

## Test plan

- [x] pact-repo source side built + conformance suite green before tag.
- [x] Spec-only diff (mirror file byte-identical to ``$specRel`` at tag ``v$Version``).
- [ ] CI (gitleaks, informational); ``build-test`` does not apply (no code paths touched).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
"@

  if ($DryRun) {
    Write-Host "`n--- DRY RUN: would commit ---" -ForegroundColor Yellow
    Write-Host $commitMsg
    Write-Host "`n--- DRY RUN: would open PR with body ---" -ForegroundColor Yellow
    Write-Host $prBody
    return
  }

  # ---- Commit + push -------------------------------------------------------
  git -C $worktreePath add $mirrorRel
  git -C $worktreePath commit -m $commitMsg --quiet
  git -C $worktreePath push -u origin $branch --quiet

  # ---- PR ------------------------------------------------------------------
  $prUrl = gh pr create `
    --repo TailorAU/tailor-app `
    --base main `
    --head $branch `
    --title "spec: mirror PACT v$Version" `
    --body $prBody
  Write-Host "PR opened: $prUrl" -ForegroundColor Green

  if ($AutoMerge) {
    $prNum = ($prUrl -split '/')[-1]
    Write-Host "Admin-squash-merging PR #$prNum ..." -ForegroundColor Yellow
    gh pr merge $prNum --repo TailorAU/tailor-app --squash --admin --delete-branch
    $merged = gh pr view $prNum --repo TailorAU/tailor-app --json state,mergeCommit | ConvertFrom-Json
    if ($merged.state -ne 'MERGED') { Fail "PR #$prNum did not reach MERGED (state: $($merged.state))." }
    Write-Host "Merged as $($merged.mergeCommit.oid)" -ForegroundColor Green
    Write-Host "`nNext: backfill the mirror PR number (#$prNum) into pact-repo CHANGELOG.md + AGENTS.md, commit, push." -ForegroundColor Cyan
  } else {
    Write-Host "`nPR left open for review. Re-run with -AutoMerge or merge manually." -ForegroundColor Cyan
  }
}
finally {
  if ($cleanupNeeded) {
    git -C $TailorApp worktree remove $worktreeRel --force 2>$null
    git -C $TailorApp branch -D $branch 2>$null | Out-Null
  }
}
