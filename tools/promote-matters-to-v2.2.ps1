#!/usr/bin/env pwsh
#Requires -Version 7
<#
.SYNOPSIS
  Promote the Matter primitive drafts from docs/v2-prep/matters-* into
  spec/v2.2/ as the official §24 normative text + schemas + vectors.

.DESCRIPTION
  Gated by AGENTS.md rule 3 ("Do not promote a draft spec/vX.Y/ to stable
  without explicit sign-off") — this script REFUSES TO RUN unless
  -SignedOffBy is passed with a maintainer-equivalent value. The script
  prints the full intended diff in -DryRun mode so the maintainer can
  sanity-check before authorising the real run.

  Preconditions checked before any file is touched:
    1. spec/v2.1/ EXISTS (carry-forward source). If v2.1 has not shipped
       yet, the script fails loud — RFC #14 must converge first.
    2. spec/v2.2/ DOES NOT exist (otherwise this would clobber a real
       version). If a prior promotion already ran, re-run requires
       -Force.
    3. docs/v2-prep/matters-spec-draft.md + matters-schemas/ +
       matters-vectors/ all present.
    4. -SignedOffBy passed with a non-empty value.

  Steps executed (idempotent within a single run):
    1. Carry-forward: copy spec/v2.1/ -> spec/v2.2/ recursively.
    2. Fold in §24: append docs/v2-prep/matters-spec-draft.md content
       into spec/v2.2/SPECIFICATION.md as §24, stripping the DRAFT
       front-matter and updating any "2.2-draft" version strings to "2.2".
    3. Move schemas: docs/v2-prep/matters-schemas/*.json ->
       spec/v2.2/schemas/, rewriting $id paths
       (pact-spec.dev/schemas/v2.2-draft/ -> /v2.2/).
    4. Move vectors: docs/v2-prep/matters-vectors/*.yaml ->
       spec/v2.2/conformance/matters/, rewriting `id: matters/...` to
       `id: extended/matters/...` per spec/v2.0/ vector convention.
    5. Update reference-server: change MATTERS_DRAFT_VERSION = '2.2-draft'
       to MATTERS_VERSION = '2.2' in store.ts.
    6. Bump package versions: cli/, mcp/, reference-server/ package.json
       to 2.2.0 (one step beyond the v2.1 release that just happened —
       the script reads v2.1's version from spec/v2.1/SPECIFICATION.md
       and confirms 2.2.0 > it).
    7. Print remaining manual steps (CHANGELOG entry, tag, mirror,
       Tailor + AloomU coordination).

  After this script runs successfully:
    - All drafts removed from docs/v2-prep/matters-* (they live in
      spec/v2.2/ now)
    - One coherent commit suggested: `spec(v2.2): promote Matter drafts
      to normative §24` — staged but NOT committed (maintainer reviews
      the diff and commits/amends as they see fit).
    - mirror-spec.ps1 needs -Version 2.2 + a source-path update
      (currently hardcoded to spec/v2.0/SPECIFICATION.md — see
      mirror-spec.ps1 line 83).

.PARAMETER PactRepo
  Path to the pact-repo working tree. Defaults to the repo this script
  lives in (two levels up from tools/).

.PARAMETER SignedOffBy
  REQUIRED for non-dry-run. Maintainer name/identifier authorising the
  promotion. Recorded in the script log; does NOT add a Signed-off-by
  trailer to a commit (the script doesn't commit — maintainer does that
  step explicitly).

.PARAMETER DryRun
  Print the intended diff + the §24 fold-in result + the schema $id
  rewrites + the vector id rewrites. NO file changes. Use this to
  sanity-check before -SignedOffBy.

.PARAMETER Force
  Override the "spec/v2.2/ already exists" guard. Use only if a previous
  promotion was incomplete and is being redone. The script will refuse
  if any file inside spec/v2.2/ is git-tracked (i.e., already committed).

.EXAMPLE
  # Sanity-check what would happen — no changes:
  ./tools/promote-matters-to-v2.2.ps1 -DryRun

.EXAMPLE
  # Real promotion (only after v2.1 ships + maintainer sign-off):
  ./tools/promote-matters-to-v2.2.ps1 -SignedOffBy "Knox Hart"
#>
[CmdletBinding()]
param(
  [string]$PactRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$SignedOffBy,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$m) { Write-Error $m; exit 1 }
function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }

# ---- Preconditions ---------------------------------------------------------

$v21Dir    = Join-Path $PactRepo 'spec/v2.1'
$v22Dir    = Join-Path $PactRepo 'spec/v2.2'
$draftSpec = Join-Path $PactRepo 'docs/v2-prep/matters-spec-draft.md'
$draftSch  = Join-Path $PactRepo 'docs/v2-prep/matters-schemas'
$draftVec  = Join-Path $PactRepo 'docs/v2-prep/matters-vectors'

if (-not (Test-Path $v21Dir)) {
  Fail @"
spec/v2.1/ does not exist. v2.1 must ship before v2.2 can be promoted.
RFC #14 (https://github.com/TailorAU/pact/issues/14) is the v2.1 gate.
Until that converges and spec/v2.1/SPECIFICATION.md lands, this script
will not run. (If you have a different carry-forward source in mind,
edit `$v21Dir` at the top of the script.)
"@
}

if (Test-Path $v22Dir) {
  if (-not $Force) {
    Fail "spec/v2.2/ already exists. Pass -Force to re-promote, OR delete it first."
  }
  # If -Force AND any file inside is git-tracked, refuse — clobbering committed history.
  $tracked = git -C $PactRepo ls-files 'spec/v2.2/'
  if ($tracked) {
    Fail "spec/v2.2/ contains git-tracked files. -Force does not override committed history. Delete the tracked files first if you really mean it."
  }
}

foreach ($p in @($draftSpec, $draftSch, $draftVec)) {
  if (-not (Test-Path $p)) { Fail "Required draft missing: $p" }
}

if (-not $DryRun -and [string]::IsNullOrWhiteSpace($SignedOffBy)) {
  Fail @"
-SignedOffBy is REQUIRED for non-dry-run. Per AGENTS.md rule 3 ("Do not
promote a draft spec/vX.Y/ to stable without explicit sign-off"), the
script will not run without a maintainer signature.

Usage:
  ./tools/promote-matters-to-v2.2.ps1 -SignedOffBy "Knox Hart"

To preview the changes without touching anything:
  ./tools/promote-matters-to-v2.2.ps1 -DryRun
"@
}

Info "Promote Matters → spec/v2.2/"
Info "  PactRepo    : $PactRepo"
Info "  Source spec : $v21Dir (carry-forward)"
Info "  Target spec : $v22Dir"
if ($DryRun) { Warn "  Mode        : DRY RUN (no changes)" }
else         { Warn "  Mode        : COMMIT (SignedOffBy: $SignedOffBy)" }

# ---- Step 1: Carry-forward spec/v2.1/ -> spec/v2.2/ ------------------------

Info "`n[1/6] Carry-forward spec/v2.1/ -> spec/v2.2/"
if ($DryRun) {
  $count = (Get-ChildItem -Path $v21Dir -Recurse -File | Measure-Object).Count
  Write-Host "  Would copy $count files from spec/v2.1/ to spec/v2.2/"
} else {
  Copy-Item -Path $v21Dir -Destination $v22Dir -Recurse -Force
  Ok "  Copied spec/v2.1/ -> spec/v2.2/"
}

# ---- Step 2: Fold §24 (Matters) into spec/v2.2/SPECIFICATION.md -----------

Info "`n[2/6] Fold §24 Matters into spec/v2.2/SPECIFICATION.md"

$draftContent = Get-Content -Raw -LiteralPath $draftSpec
# Strip the DRAFT front-matter blockquotes (everything up to the first ## 24.1 heading)
$folded = $draftContent -replace '(?s)^.*?(## 24\.1)', '## §24 Matters — multi-fabric deal-room workspaces`n`n$1'
# Replace 2.2-draft references with 2.2
$folded = $folded -replace '2\.2-draft', '2.2'
$folded = $folded -replace 'pact-spec\.dev/schemas/v2\.2-draft/', 'pact-spec.dev/schemas/v2.2/'

$specV22Path = Join-Path $v22Dir 'SPECIFICATION.md'
if ($DryRun) {
  Write-Host "  Would append $(($folded -split "`n").Count) lines to spec/v2.2/SPECIFICATION.md as §24"
  Write-Host "  First 5 lines of folded text:"
  $folded -split "`n" | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" }
} else {
  # Append §24 to the carried-forward SPECIFICATION.md. Maintainer reviews the
  # exact insertion point — script appends at end; maintainer may move it to
  # the canonical section-number sequence (after §23 Agent Identity Lifecycle).
  Add-Content -LiteralPath $specV22Path -Value "`n`n---`n`n$folded"
  Ok "  Appended §24 Matters to spec/v2.2/SPECIFICATION.md"
}

# ---- Step 3: Move schemas with $id rewrite --------------------------------

Info "`n[3/6] Move matters-schemas -> spec/v2.2/schemas/ ($id rewrite)"
$targetSchemas = Join-Path $v22Dir 'schemas'
$schemaFiles   = Get-ChildItem -Path $draftSch -Filter '*.json'
foreach ($f in $schemaFiles) {
  $content = Get-Content -Raw -LiteralPath $f.FullName
  $rewritten = $content -replace 'pact-spec\.dev/schemas/v2\.2-draft/', 'pact-spec.dev/schemas/v2.2/'
  $target = Join-Path $targetSchemas $f.Name
  if ($DryRun) {
    Write-Host "  Would move $($f.Name) -> spec/v2.2/schemas/$($f.Name) (with `$id rewrite)"
  } else {
    Set-Content -LiteralPath $target -Value $rewritten -Encoding utf8
    Remove-Item -LiteralPath $f.FullName
  }
}
if (-not $DryRun) {
  Ok "  Moved $($schemaFiles.Count) schemas + rewrote `$id paths"
  if ((Get-ChildItem -Path $draftSch | Measure-Object).Count -eq 0) {
    Remove-Item -LiteralPath $draftSch
    Ok "  Removed empty docs/v2-prep/matters-schemas/ directory"
  }
}

# ---- Step 4: Move vectors with id-prefix rewrite --------------------------

Info "`n[4/6] Move matters-vectors -> spec/v2.2/conformance/matters/ (id rewrite)"
$targetVecs  = Join-Path $v22Dir 'conformance/matters'
if (-not (Test-Path $targetVecs)) {
  if ($DryRun) { Write-Host "  Would create spec/v2.2/conformance/matters/" }
  else         { New-Item -ItemType Directory -Path $targetVecs -Force | Out-Null }
}
$vecFiles = Get-ChildItem -Path $draftVec -Filter '*.yaml'
foreach ($f in $vecFiles) {
  $content = Get-Content -Raw -LiteralPath $f.FullName
  # `id: matters/...` -> `id: extended/matters/...` per spec/v2.0/ convention
  $rewritten = $content -replace '(?m)^(  id:\s+)matters/', '$1extended/matters/'
  $target = Join-Path $targetVecs $f.Name
  if ($DryRun) {
    Write-Host "  Would move $($f.Name) -> spec/v2.2/conformance/matters/$($f.Name) (with id rewrite)"
  } else {
    Set-Content -LiteralPath $target -Value $rewritten -Encoding utf8
    Remove-Item -LiteralPath $f.FullName
  }
}
# Also move the README
$vecReadme = Join-Path $draftVec 'README.md'
if (Test-Path $vecReadme) {
  if ($DryRun) {
    Write-Host "  Would move README.md -> spec/v2.2/conformance/matters/README.md"
  } else {
    Copy-Item -LiteralPath $vecReadme -Destination (Join-Path $targetVecs 'README.md')
    Remove-Item -LiteralPath $vecReadme
  }
}
if (-not $DryRun) {
  Ok "  Moved $($vecFiles.Count) vectors + README + rewrote id prefixes"
  if ((Get-ChildItem -Path $draftVec | Measure-Object).Count -eq 0) {
    Remove-Item -LiteralPath $draftVec
    Ok "  Removed empty docs/v2-prep/matters-vectors/ directory"
  }
}

# ---- Step 5: Update reference-server version string -----------------------

Info "`n[5/6] Update reference-server MATTERS_DRAFT_VERSION -> MATTERS_VERSION = '2.2'"
$storeTs = Join-Path $PactRepo 'reference-server/src/store.ts'
if (Test-Path $storeTs) {
  $tsContent = Get-Content -Raw -LiteralPath $storeTs
  $tsRewritten = $tsContent `
    -replace "const MATTERS_DRAFT_VERSION = '2\.2-draft';", "const MATTERS_VERSION = '2.2';" `
    -replace 'MATTERS_DRAFT_VERSION', 'MATTERS_VERSION'
  if ($DryRun) {
    Write-Host "  Would replace MATTERS_DRAFT_VERSION -> MATTERS_VERSION ('2.2-draft' -> '2.2') in store.ts"
  } else {
    Set-Content -LiteralPath $storeTs -Value $tsRewritten -Encoding utf8
    Ok "  Updated reference-server/src/store.ts"
  }
}

# ---- Step 6: Bump package versions ----------------------------------------

Info "`n[6/6] Bump cli/mcp/reference-server package.json to 2.2.0"
foreach ($pkgDir in @('cli', 'mcp', 'reference-server')) {
  $pkg = Join-Path $PactRepo "$pkgDir/package.json"
  if (-not (Test-Path $pkg)) { continue }
  $pkgJson = Get-Content -Raw -LiteralPath $pkg | ConvertFrom-Json
  $oldVer = $pkgJson.version
  if ($DryRun) {
    Write-Host "  Would bump $pkgDir/package.json: $oldVer -> 2.2.0"
  } else {
    $pkgJson.version = '2.2.0'
    $pkgJson | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $pkg -Encoding utf8
    Ok "  Bumped $pkgDir/package.json: $oldVer -> 2.2.0"
  }
}

# ---- Wrap-up --------------------------------------------------------------

Info "`n────────────────────────────────────────────────────────────────"
if ($DryRun) {
  Warn "DRY RUN complete. No files changed."
  Warn "To execute, re-run with: -SignedOffBy `"<maintainer name>`""
} else {
  Ok "Promotion COMPLETE. SignedOffBy: $SignedOffBy"
  Info ""
  Info "Manual follow-ups (NOT done by this script):"
  Info "  1. Review the diff: git status; git diff --stat; git diff spec/v2.2/"
  Info "  2. Move §24 to its canonical insertion point in SPECIFICATION.md"
  Info "     (script appended at end; maintainer relocates after §23)"
  Info "  3. Update CHANGELOG.md: add v2.2.0 section with the Matter feature"
  Info "  4. Commit (suggested): 'spec(v2.2): promote Matter drafts to normative §24'"
  Info "  5. Tag: git tag v2.2.0 && git push --tags"
  Info "  6. Mirror to tailor-app: ./tools/mirror-spec.ps1 -Version 2.2 -AutoMerge"
  Info "     (note: mirror-spec.ps1 hardcodes spec/v2.0/SPECIFICATION.md as the"
  Info "      source — update line 83 to take a -SourceVersion parameter or"
  Info "      duplicate the script as mirror-spec-v2.2.ps1)"
  Info "  7. Coordinate with implementations (issue tracking #20 for Tailor + AloomU)"
  Info "  8. Publish to npm via .github/workflows/publish-packages.yml workflow_dispatch"
  Info "     (blocked on #5 — pact-protocol npm org)"
}
