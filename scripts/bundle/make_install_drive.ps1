<#
.SYNOPSIS
  Assemble a complete PSAT install drive: app bundle + installer tooling + survey data.

.DESCRIPTION
  Produces the drive that gets carried to each machine:

      <drive>\
        PSAT\               the app bundle
        Install PSAT.bat    double-click to install
        install_psat.ps1
        Uninstall PSAT.bat  for reinstall/test cycles
        uninstall_psat.ps1
        verify_drive.ps1
        RUNBOOK.md
        seed-data\          flattened survey data (road folders)

  Survey data is copied LOOSE rather than zipped. A quarter is ~129 GB of JPEGs,
  which barely compress, so zipping would cost hours and save almost nothing in
  size. Loose also means robocopy can RESUME - which matters, because an
  interrupted copy to removable media has already bitten this project once (it
  left the frozen Python env missing files and looked exactly like a code bug).

  The trade-off is install speed: reading ~500k small files from USB is far
  slower than one sequential archive. If per-machine install time becomes the
  bottleneck, archiving the seed data is the optimisation to reach for - the
  installer already accepts `seed-data.zip` as an alternative.

  Safe to re-run: robocopy skips files that are already identical, so an
  interrupted run resumes rather than starting over.

.PARAMETER Drive
  Target drive root, e.g. F:\

.PARAMETER Bundle
  Built bundle produced by build_bundle.ps1.

.PARAMETER SeedData
  Seed DATA ROOT produced by flatten_survey_data.ps1 + preprune_seed_data.ps1 —
  the directory that contains `in/` (pruned survey frames) and `data/` (the
  pre-created projects). BOTH are shipped: a pruned `in/` folder without its
  project is broken (a new project made from it would resample thinned frames and
  undercount). Omit to build a drive with no survey data.

.EXAMPLE
  pwsh scripts\bundle\make_install_drive.ps1 -Drive F:\ `
      -Bundle D:\PSAT-build\PSAT -SeedData D:\PSAT-seed\in
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Drive,
    [string]$Bundle   = "D:\PSAT-build\PSAT",
    [string]$SeedData = "",
    [switch]$SkipSeed
)

$ErrorActionPreference = "Stop"
$started = Get-Date
$ScriptDir = $PSScriptRoot

function Head($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Die($m)  { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

function Size($p) {
    if (-not (Test-Path $p)) { return 0 }
    (Get-ChildItem -Recurse -File $p -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum
}

$Drive = $Drive.TrimEnd('\') + '\'
if (-not (Test-Path $Drive))  { Die "drive not found: $Drive" }
if (-not (Test-Path (Join-Path $Bundle "PSAT.bat"))) { Die "not a built bundle: $Bundle" }

# ── Resolve the seed sub-folders (in/ + data/) ───────────────────────────────
$seedIn = ""; $seedProjects = ""
if ($SeedData -and -not $SkipSeed) {
    if (-not (Test-Path $SeedData)) { Die "seed data root not found: $SeedData" }
    $seedIn = Join-Path $SeedData "in"
    if (-not (Test-Path $seedIn)) { Die "no in/ under seed root: $SeedData" }
    $seedProjects = Join-Path $SeedData "data"   # the pre-created projects
    if (-not (Test-Path $seedProjects)) {
        Write-Host "    WARNING: no data/ (projects) under $SeedData." -ForegroundColor Yellow
        Write-Host "    Shipping in/ WITHOUT projects gives wrong segment counts. Run preprune_seed_data.ps1 first." -ForegroundColor Yellow
        $seedProjects = ""
    }
}

# ── Space check ──────────────────────────────────────────────────────────────
Head "Planning"
$bundleBytes = Size $Bundle
$seedBytes   = if ($seedIn) { (Size $seedIn) + (Size $seedProjects) } else { 0 }
$needed      = ($bundleBytes + $seedBytes) * 1.02

$free = (Get-PSDrive -Name $Drive.TrimEnd(':\').Substring(0,1)).Free
Info ("bundle    : {0,7:N2} GB" -f ($bundleBytes / 1GB))
Info ("seed data : {0,7:N2} GB" -f ($seedBytes / 1GB))
Info ("total     : {0,7:N2} GB" -f ($needed / 1GB))
Info ("drive free: {0,7:N2} GB" -f ($free / 1GB))
if ($free -lt $needed) {
    Die ("not enough space on {0} - need {1:N1} GB, have {2:N1} GB" -f $Drive, ($needed / 1GB), ($free / 1GB))
}

# ── App bundle ───────────────────────────────────────────────────────────────
Head "Copying application bundle"
$null = robocopy $Bundle (Join-Path $Drive "PSAT") /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
if ($LASTEXITCODE -ge 8) { Die "bundle copy failed (robocopy $LASTEXITCODE)" }
Info "done"

# ── Installer tooling ────────────────────────────────────────────────────────
Head "Copying installer tooling"
foreach ($f in @("Install PSAT.bat", "install_psat.ps1",
                 "Uninstall PSAT.bat", "uninstall_psat.ps1",
                 "verify_drive.ps1", "RUNBOOK.md")) {
    $src = Join-Path $ScriptDir $f
    if (Test-Path $src) { Copy-Item $src $Drive -Force; Info $f }
    else { Write-Host "    WARNING: missing $f" -ForegroundColor Yellow }
}

# ── Survey data + projects ───────────────────────────────────────────────────
# Ships into <drive>\seed\{in,data} so the installer can lay both down under the
# data root. Copied loose (not zipped): the pruned set is small enough, and loose
# lets robocopy resume an interrupted copy.
if ($seedIn) {
    Head "Copying survey data + projects (the long part)"
    Info ("in/   {0:N2} GB" -f ((Size $seedIn) / 1GB))
    $null = robocopy $seedIn (Join-Path $Drive "seed\in") /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
    if ($LASTEXITCODE -ge 8) { Die "seed in/ copy failed (robocopy $LASTEXITCODE)" }
    if ($seedProjects) {
        Info ("data/ {0:N2} GB (projects)" -f ((Size $seedProjects) / 1GB))
        $null = robocopy $seedProjects (Join-Path $Drive "seed\data") /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
        if ($LASTEXITCODE -ge 8) { Die "seed data/ copy failed (robocopy $LASTEXITCODE)" }
    }
    Info "done"
} else {
    Head "Survey data"
    Info "skipped - drive will install with no survey folders"
}

# ── Verify ───────────────────────────────────────────────────────────────────
# Never hand over a drive that has only been *written to*; a partial copy looks
# exactly like an application bug on the target machine.
Head "Verifying"
$bundleOk = (Size (Join-Path $Drive "PSAT")) -eq $bundleBytes
Info ("bundle bytes match : {0}" -f $bundleOk)
if (-not $bundleOk) { Die "bundle size mismatch after copy" }

if ($seedIn) {
    $inOk = (Size (Join-Path $Drive "seed\in")) -eq (Size $seedIn)
    Info ("seed in/ bytes match : {0}" -f $inOk)
    if (-not $inOk) { Die "seed in/ size mismatch after copy" }
    Info ("road folders         : {0:N0}" -f (Get-ChildItem -Directory (Join-Path $Drive "seed\in") -ErrorAction SilentlyContinue).Count)
    if ($seedProjects) {
        $dataOk = (Size (Join-Path $Drive "seed\data")) -eq (Size $seedProjects)
        Info ("seed data/ bytes match: {0}" -f $dataOk)
        if (-not $dataOk) { Die "seed data/ size mismatch after copy" }
        Info ("projects             : {0:N0}" -f (Get-ChildItem -Directory (Join-Path $Drive "seed\data") -ErrorAction SilentlyContinue).Count)
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Green
Info ("elapsed: {0:N1} min" -f ((Get-Date) - $started).TotalMinutes)
Write-Host ""
Write-Host "Now run the full check (it RUNS the copied interpreter):" -ForegroundColor Cyan
Write-Host ("    pwsh {0} -Drive {1}" -f (Join-Path $Drive "verify_drive.ps1"), $Drive) -ForegroundColor Cyan
Write-Host ""
Write-Host "Then on each machine: double-click 'Install PSAT.bat'" -ForegroundColor Cyan
