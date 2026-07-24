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
  Flattened survey `in/` directory produced by flatten_survey_data.ps1.
  Omit to build a drive with no survey data.

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

# ── Space check ──────────────────────────────────────────────────────────────
Head "Planning"
$bundleBytes = Size $Bundle
$seedBytes   = if ($SeedData -and -not $SkipSeed) { Size $SeedData } else { 0 }
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

# ── Survey data ──────────────────────────────────────────────────────────────
if ($SeedData -and -not $SkipSeed) {
    if (-not (Test-Path $SeedData)) { Die "seed data not found: $SeedData" }
    Head "Copying survey data (this is the long part)"
    Info ("{0:N2} GB from {1}" -f ($seedBytes / 1GB), $SeedData)
    $null = robocopy $SeedData (Join-Path $Drive "seed-data") /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
    if ($LASTEXITCODE -ge 8) { Die "seed data copy failed (robocopy $LASTEXITCODE)" }
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

if ($seedBytes -gt 0) {
    $seedOk = (Size (Join-Path $Drive "seed-data")) -eq $seedBytes
    Info ("seed bytes match   : {0}" -f $seedOk)
    if (-not $seedOk) { Die "seed data size mismatch after copy" }
    Info ("road folders       : {0:N0}" -f (Get-ChildItem -Directory (Join-Path $Drive "seed-data") -ErrorAction SilentlyContinue).Count)
}

Write-Host "`n=== Done ===" -ForegroundColor Green
Info ("elapsed: {0:N1} min" -f ((Get-Date) - $started).TotalMinutes)
Write-Host ""
Write-Host "Now run the full check (it RUNS the copied interpreter):" -ForegroundColor Cyan
Write-Host "    pwsh $Drive`verify_drive.ps1 -Drive $Drive -Source $Bundle\.." -ForegroundColor Cyan
Write-Host ""
Write-Host "Then on each machine: double-click 'Install PSAT.bat'" -ForegroundColor Cyan
