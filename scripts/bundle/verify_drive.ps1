<#
.SYNOPSIS
  Verify an install drive is complete and usable BEFORE carrying it to a machine.

.DESCRIPTION
  Copying ~80,000 files to removable media is the least reliable step in the whole
  deployment, and a partial copy fails in a way that looks like a code bug: an
  interrupted copy left the frozen environment missing _distutils_hack, win32 and
  Lib\urllib, which surfaced as three unrelated-looking "module not found" errors.

  This checks the drive against the source and, most importantly, actually RUNS
  the copied interpreter. A file count alone would not have caught that failure.

.EXAMPLE
  pwsh scripts\bundle\verify_drive.ps1 -Drive E:\ -Source D:\PSAT-USB
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Drive,
    # Optional: a staging folder to compare file count/size against. Leave unset for
    # the normal check — the real test is booting the copied interpreter, which runs
    # regardless. (A stale default here once produced a misleading FAIL.)
    [string]$Source = ""
)

$ErrorActionPreference = "Stop"
$fail = @()
function Ok($m)   { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:fail += $m }
function Head($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

$Drive = $Drive.TrimEnd('\') + '\'

Head "Required files"
$required = @(
    "PSAT\PSAT.bat",
    "PSAT\python\python.exe",
    "PSAT\python\Lib\urllib",
    "PSAT\python\Lib\site-packages\_distutils_hack",
    "PSAT\python\Lib\site-packages\win32",
    "PSAT\python\Library\share\proj",
    "PSAT\python\Library\share\gdal",
    "PSAT\backend\app.py",
    "PSAT\backend\version.json",
    "PSAT\backend\app\services\data\cyclerap_v214_model.json",
    "PSAT\backend\app\services\data\stm_v214_treatments.json",
    "PSAT\backend\app\api\profiles",
    "PSAT\backend\models",
    "PSAT\backend\shapefiles",
    "PSAT\webui\index.html",
    "PSAT\launcher\launch_psat.py",
    "install_psat.ps1",
    "Install PSAT.bat"
)
foreach ($rel in $required) {
    if (Test-Path (Join-Path $Drive $rel)) { Ok $rel } else { Bad "missing: $rel" }
}

Head "File count vs source"
function Payload($root) {
    $items = @()
    if (Test-Path (Join-Path $root "PSAT")) {
        $items += Get-ChildItem -Recurse -File (Join-Path $root "PSAT") -ErrorAction SilentlyContinue
    }
    foreach ($f in @("seed-data.zip", "install_psat.ps1", "Install PSAT.bat", "RUNBOOK.md")) {
        $p = Join-Path $root $f
        if (Test-Path $p) { $items += Get-Item $p }
    }
    [pscustomobject]@{ Count = $items.Count; Bytes = ($items | Measure-Object -Sum Length).Sum }
}
if ($Source -and (Test-Path $Source)) {
    $s = Payload $Source
    $d = Payload $Drive
    "  source : {0,7:N0} files  {1,6:N2} GB" -f $s.Count, ($s.Bytes / 1GB) | Write-Host
    "  drive  : {0,7:N0} files  {1,6:N2} GB" -f $d.Count, ($d.Bytes / 1GB) | Write-Host
    if ($d.Count -eq $s.Count) { Ok "file count matches" }
    else { Bad "file count differs (missing $($s.Count - $d.Count))" }
    # Exact byte equality: a size mismatch means truncation somewhere.
    if ($d.Bytes -eq $s.Bytes) { Ok "total size matches exactly" }
    else { Bad ("size differs by {0:N1} MB" -f (($s.Bytes - $d.Bytes) / 1MB)) }
} else {
    Write-Host "  (no -Source given; skipping file-count comparison — the interpreter boot below is the real test)"
}

Head "Copied interpreter actually runs"
# The real test. Everything above is metadata; this executes the environment the
# user will run, with the imports that a partial copy silently breaks.
$py = Join-Path $Drive "PSAT\python\python.exe"
if (Test-Path $py) {
    $probe = 'import urllib.request, distutils, win32api, numpy, torch, geopandas, fiona; ' +
             'from pyproj import CRS, Transformer; ' +
             't = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_epsg(3414), always_xy=True); ' +
             'assert [round(v, 3) for v in t.transform(103.82, 1.35)] == [26517.791, 36901.661]; ' +
             'print("IMPORTS_OK")'
    $out = & $py -c $probe 2>&1
    if (($out -join "`n") -match "IMPORTS_OK") {
        Ok "urllib / distutils / pywin32 / numpy / torch / geopandas / fiona import"
        Ok "PROJ transform returns the expected SVY21 coordinates"
    } else {
        Bad "interpreter failed to import: $($out -join ' | ')"
    }

    $app = & $py -c "import sys; sys.path.insert(0, r'$($Drive)PSAT\backend'); from app import create_app; create_app(); print('APP_OK')" 2>&1
    if (($app -join "`n") -match "APP_OK") { Ok "backend imports cleanly (create_app)" }
    else { Bad "backend failed to import: $(($app | Select-Object -Last 3) -join ' | ')" }
} else {
    Bad "python.exe not on the drive - cannot run the real test"
}

Head "Seed data + projects"
$seedIn   = Join-Path $Drive "seed\in"
$seedData = Join-Path $Drive "seed\data"
if (Test-Path $seedIn) {
    $roads = (Get-ChildItem -Directory $seedIn -ErrorAction SilentlyContinue).Count
    if ($roads -gt 0) { Ok "seed\in present ($roads road folders)" } else { Bad "seed\in is empty" }

    # A pruned in/ WITHOUT its projects is the broken state - flag loudly.
    if (Test-Path $seedData) {
        $projects = (Get-ChildItem -Directory $seedData -ErrorAction SilentlyContinue).Count
        if ($projects -gt 0) { Ok "seed\data present ($projects projects)" } else { Bad "seed\data is empty" }
    } else {
        Bad "seed\data (projects) MISSING - pruned frames without projects give wrong segment counts"
    }
} elseif (Test-Path (Join-Path $Drive "seed-data.zip")) {
    Write-Host "  (legacy seed-data.zip layout - in/ only, no projects)"
} else {
    Write-Host "  (no seed data - PSAT will install with no survey folders)"
}

Write-Host ""
if ($fail.Count) {
    Write-Host "DRIVE NOT READY - $($fail.Count) problem(s)" -ForegroundColor Red
    $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host "DRIVE VERIFIED - safe to take to a machine" -ForegroundColor Green
exit 0
