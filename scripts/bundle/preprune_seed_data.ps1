<#
.SYNOPSIS
  Shrink flattened survey data by pre-creating one project per road, which makes
  PSAT prune the frames no project needs.

.DESCRIPTION
  A quarter of raw survey imagery is ~129 GB, which is more than the office
  machines can be relied on to have free. Frames CANNOT simply be thinned - PSAT
  samples a frame roughly every 10 m, so removing frames silently undercounts
  segments and road length (measured: keeping half lost 31% of segments).

  The one safe reduction is the app's own pruning, which deletes exactly the
  frames no project references. That requires a project to exist, so this script
  creates one per road. Critically the project's geometry is computed from the
  FULL frame set BEFORE anything is deleted, so the project stays accurate while
  the folder shrinks - measured 255 frames/32 MB -> 59 frames/7.1 MB with the
  segment count unchanged at 59.

  Run this ONCE on the build machine. The resulting (much smaller) data ships to
  every machine, so the per-machine cost is paid here rather than 11 times.

  The projects MUST ship with the pruned data. A pruned folder without its
  project is the broken state: creating a new project from it would resample the
  thinned frames and undercount.

.PARAMETER DataRoot
  Data root containing `in/` (as produced by flatten_survey_data.ps1). Projects
  are written to its `data/` directory.

.PARAMETER Bundle
  Built PSAT bundle, used to run the backend.

.PARAMETER Limit
  Process only the first N roads. Use to sample before committing to a full run.

.PARAMETER Port
  Port for the temporary backend instance.

.EXAMPLE
  # sample 25 roads first to get real numbers
  pwsh scripts\bundle\preprune_seed_data.ps1 -DataRoot D:\PSAT-seed -Limit 25

.EXAMPLE
  pwsh scripts\bundle\preprune_seed_data.ps1 -DataRoot D:\PSAT-seed
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [string]$Bundle = "D:\PSAT-build\PSAT",
    [int]$Limit = 0,
    [int]$Port = 8040
)

$ErrorActionPreference = "Stop"
$started = Get-Date

function Head($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Die($m)  { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

$py = Join-Path $Bundle "python\python.exe"
$app = Join-Path $Bundle "backend\app.py"
if (-not (Test-Path $py))  { Die "bundled python not found: $py" }
if (-not (Test-Path $app)) { Die "bundled backend not found: $app" }
$inDir = Join-Path $DataRoot "in"
if (-not (Test-Path $inDir)) { Die "no in/ directory under $DataRoot" }

$roads = Get-ChildItem -Directory $inDir | Sort-Object Name
if ($Limit -gt 0) { $roads = $roads | Select-Object -First $Limit }
if (-not $roads) { Die "no road folders found in $inDir" }

Head "Plan"
Info "data root : $DataRoot"
Info "roads     : $($roads.Count)"
$sizeBefore = (Get-ChildItem -Recurse -File $inDir | Measure-Object -Sum Length).Sum
Info ("size now  : {0:N2} GB" -f ($sizeBefore / 1GB))

# ── Start a temporary backend against this data root ─────────────────────────
Head "Starting backend"
$env:PSAT_DATA_DIR = $DataRoot
$env:PSAT_PORT     = "$Port"
$env:PSAT_HOST     = "127.0.0.1"
$proc = Start-Process -FilePath $py -ArgumentList "`"$app`"" `
        -WorkingDirectory (Join-Path $Bundle "backend") -PassThru -WindowStyle Hidden

$base = "http://127.0.0.1:$Port"
$up = $false
foreach ($i in 1..90) {
    try {
        if ((Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $up = $true; break }
    } catch { Start-Sleep -Milliseconds 2000 }
}
if (-not $up) { try { $proc | Stop-Process -Force } catch {}; Die "backend did not start on $base" }
Info "up on $base"

# ── Create one project per road ──────────────────────────────────────────────
Head "Creating projects (this is what triggers pruning)"
$done = 0; $ok = 0; $skipped = 0; $freed = 0.0; $errors = @()

foreach ($road in $roads) {
    # Project names cannot contain underscores, and the folder carries a
    # `_1Q2026` suffix - so name the project after the road itself.
    $projectName = ($road.Name -replace '_[1-4]Q\d{4}$', '').Trim()

    $body = @{ project_name = $projectName; folder_name = $road.Name } | ConvertTo-Json -Compress
    try {
        $res = Invoke-WebRequest -Uri "$base/api/projects/folders" -Method POST -Body $body `
               -ContentType "application/json" -UseBasicParsing -TimeoutSec 1800
        $j = $res.Content | ConvertFrom-Json
        foreach ($p in $j.pruned_sources) { $freed += [double]$p.bytes_freed }
        $ok++
    } catch {
        $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        # An already-existing project is not a failure: the script is re-runnable.
        if ($msg -match 'already exists') { $skipped++ }
        else { $errors += "$($road.Name): $msg" }
    }

    $done++
    if ($done % 50 -eq 0) {
        $mins = ((Get-Date) - $started).TotalMinutes
        $rate = if ($mins -gt 0) { $done / $mins } else { 0 }
        Info ("{0,5} / {1}  ({2:N1} GB freed, {3:N0} roads/min)" -f $done, $roads.Count, ($freed / 1GB), $rate)
    }
}

# ── Stop the backend ─────────────────────────────────────────────────────────
Head "Stopping backend"
try { $proc | Stop-Process -Force; Info "stopped" } catch { Info "already stopped" }
Start-Sleep -Seconds 2

# ── Report ───────────────────────────────────────────────────────────────────
Head "Result"
$sizeAfter = (Get-ChildItem -Recurse -File $inDir | Measure-Object -Sum Length).Sum
$projDir = Join-Path $DataRoot "data"
$projSize = if (Test-Path $projDir) { (Get-ChildItem -Recurse -File $projDir -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum } else { 0 }

Info ("projects created : {0:N0}   (skipped existing: {1:N0})" -f $ok, $skipped)
Info ("survey data      : {0:N2} GB -> {1:N2} GB  ({2:N0}% smaller)" -f `
      ($sizeBefore / 1GB), ($sizeAfter / 1GB), (100 * (1 - $sizeAfter / [double]$sizeBefore)))
Info ("project data     : {0:N2} GB" -f ($projSize / 1GB))
Info ("TOTAL to ship    : {0:N2} GB" -f (($sizeAfter + $projSize) / 1GB))
Info ("elapsed          : {0:N1} min" -f ((Get-Date) - $started).TotalMinutes)

if ($errors.Count) {
    Write-Host "`n  $($errors.Count) road(s) failed:" -ForegroundColor Yellow
    $errors | Select-Object -First 15 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Host "`nPRE-PRUNE COMPLETED WITH ERRORS - review before shipping" -ForegroundColor Yellow
    exit 1
}
Write-Host "`nPRE-PRUNE OK" -ForegroundColor Green
Write-Host "Ship BOTH in\ and data\ - a pruned folder without its project is broken." -ForegroundColor Cyan
exit 0
