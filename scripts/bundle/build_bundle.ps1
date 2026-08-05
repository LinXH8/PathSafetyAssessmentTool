<#
.SYNOPSIS
  Build the portable PSAT bundle for Windows deployment.

.DESCRIPTION
  Produces a self-contained folder that runs on a machine with no Python, Node,
  conda or Git. Everything here must be repeatable and unattended: the
  clean-machine acceptance test has to be runnable in one sitting, and re-runnable
  after a fix without redoing manual steps.

  Layout produced:
      <OutDir>/PSAT/
        python/    frozen, relocated CPython + all deps (conda-pack + conda-unpack)
        backend/   app code + models/ + shapefiles/
        webui/     built React bundle
        launcher/  launch_psat.py
        PSAT.bat   double-click entry point

  Writable state is NOT here: it lives in %LOCALAPPDATA%\PSAT\data at runtime
  (see backend/app/services/paths.py).

.PARAMETER OutDir
  Staging directory. Needs ~10 GB free.

.PARAMETER SkipEnv
  Reuse an already-packed python/ (the slow step, ~4 GB). Use while iterating.

.PARAMETER SkipFrontend
  Reuse an existing frontend/dist.

.EXAMPLE
  pwsh scripts/bundle/build_bundle.ps1 -OutDir D:\PSAT-build
#>
[CmdletBinding()]
param(
    [string]$OutDir = "D:\PSAT-build",
    [string]$CondaEnv = "$env:USERPROFILE\miniconda3\envs\psat",
    [switch]$SkipEnv,
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$RepoRoot   = (Resolve-Path "$PSScriptRoot\..\..").Path
$BundleRoot = Join-Path $OutDir "PSAT"

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" }
function Die($msg)  { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function Get-DirSize($path) {
    if (-not (Test-Path $path)) { return 0 }
    (Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue $path |
        Measure-Object -Sum Length).Sum
}

# ── Preflight ────────────────────────────────────────────────────────────────
Step "Preflight"
if (-not (Test-Path $CondaEnv))  { Die "conda env not found: $CondaEnv" }
if (-not (Test-Path "$RepoRoot\backend\app.py")) { Die "repo root looks wrong: $RepoRoot" }

$shapefiles = "$RepoRoot\backend\shapefiles"
$models     = "$RepoRoot\backend\models"
if (-not (Test-Path $shapefiles)) { Die "missing GIS shapefiles: $shapefiles" }
if (-not (Test-Path $models))     { Die "missing YOLO models: $models" }

Info "Repo:    $RepoRoot"
Info "Bundle:  $BundleRoot"
New-Item -ItemType Directory -Force -Path $BundleRoot | Out-Null

# ── 1. Frontend ──────────────────────────────────────────────────────────────
Step "Frontend build"
if ($SkipFrontend -and (Test-Path "$RepoRoot\frontend\dist\index.html")) {
    Info "skipped (reusing frontend/dist)"
} else {
    Push-Location "$RepoRoot\frontend"
    try {
        # npm run build = tsc -b && vite build. A type error must fail the bundle
        # rather than silently shipping a stale dist.
        & npm run build
        if ($LASTEXITCODE -ne 0) { Die "frontend build failed" }
    } finally { Pop-Location }
}
if (-not (Test-Path "$RepoRoot\frontend\dist\index.html")) { Die "no frontend/dist/index.html after build" }

# ── 2. Frozen Python ─────────────────────────────────────────────────────────
Step "Frozen Python environment"
$pythonDir = Join-Path $BundleRoot "python"
if ($SkipEnv -and (Test-Path "$pythonDir\python.exe")) {
    Info "skipped (reusing $pythonDir)"
} else {
    if (Test-Path $pythonDir) { Info "removing previous env..."; Remove-Item -Recurse -Force $pythonDir }
    $condaPack = Join-Path $CondaEnv "Scripts\conda-pack.exe"
    if (-not (Test-Path $condaPack)) { Die "conda-pack not installed in $CondaEnv (pip install conda-pack)" }

    Info "packing (several minutes, ~4 GB)..."
    & $condaPack -p $CondaEnv --format no-archive -o $pythonDir --n-threads -1
    if ($LASTEXITCODE -ne 0) { Die "conda-pack failed" }

    # Rewrites prefixes baked in at build time so the env works from any path.
    # Without this, PROJ/GDAL data lookups still point at the build machine.
    Info "running conda-unpack (rebases absolute paths)..."
    Push-Location $pythonDir
    try {
        & ".\Scripts\conda-unpack.exe"
        if ($LASTEXITCODE -ne 0) { Die "conda-unpack failed" }
    } finally { Pop-Location }
}

# ── 3. Backend ───────────────────────────────────────────────────────────────
Step "Backend"
$backendDst = Join-Path $BundleRoot "backend"
if (Test-Path $backendDst) { Remove-Item -Recurse -Force $backendDst }
New-Item -ItemType Directory -Force -Path $backendDst | Out-Null

# Ship code + config + version only. User data (data/, profiles/, in/,
# temp_uploads/) must never be baked into the bundle - it belongs in
# %LOCALAPPDATA%. tests/ and caches are dead weight on a user machine.
#
# IMPORTANT: these MUST be full paths, not bare names. robocopy /XD with a bare
# name excludes every directory with that name at ANY depth. Using bare names
# here silently stripped backend/app/services/data/ (the entire v2.14 CycleRAP
# scoring + STM treatment model) and backend/app/api/profiles/ (the whole
# profile system), producing a bundle that could not even import.
$excludeDirs = @(
    "$RepoRoot\backend\data",
    "$RepoRoot\backend\profiles",
    "$RepoRoot\backend\in",
    "$RepoRoot\backend\temp_uploads",
    "$RepoRoot\backend\temp",
    "$RepoRoot\backend\tests",
    "$RepoRoot\backend\venv",
    "$RepoRoot\backend\.venv",
    "$RepoRoot\backend\.pytest_cache"
)
# __pycache__ is the one name safe to exclude at any depth.
robocopy "$RepoRoot\backend" $backendDst /E /NFL /NDL /NJH /NJS /NP `
    /XD $excludeDirs "__pycache__" /XF "*.pyc" "*.log" "*_log.txt" | Out-Null
if ($LASTEXITCODE -ge 8) { Die "robocopy backend failed ($LASTEXITCODE)" }

# ── 4. webui ─────────────────────────────────────────────────────────────────
Step "Web UI"
$webuiDst = Join-Path $BundleRoot "webui"
if (Test-Path $webuiDst) { Remove-Item -Recurse -Force $webuiDst }
robocopy "$RepoRoot\frontend\dist" $webuiDst /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Die "robocopy webui failed ($LASTEXITCODE)" }

# ── 5. Launcher ──────────────────────────────────────────────────────────────
Step "Launcher"
$launcherDst = Join-Path $BundleRoot "launcher"
New-Item -ItemType Directory -Force -Path $launcherDst | Out-Null
Copy-Item "$PSScriptRoot\launch_psat.py" $launcherDst -Force

# Entry point. Uses pythonw-free python.exe so the console stays visible: if
# start-up fails, the user has something to screenshot.
@'
@echo off
cd /d "%~dp0"
"%~dp0python\python.exe" "%~dp0launcher\launch_psat.py" %*
if errorlevel 1 pause
'@ | Set-Content -Path (Join-Path $BundleRoot "PSAT.bat") -Encoding ASCII

# ── 5b. Shortcut icon ────────────────────────────────────────────────────────
# The installer sets the desktop/Start-menu shortcut icon to
# "$InstallRoot\PSAT Logo.ico" but only "if (Test-Path $icon)". If the icon is
# not shipped inside the bundle it never reaches the install root, and the
# shortcut silently falls back to the default .bat icon. Copy it in here.
Step "Shortcut icon"
$iconSrc = Join-Path $RepoRoot "PSAT Logo.ico"
if (Test-Path $iconSrc) {
    Copy-Item $iconSrc (Join-Path $BundleRoot "PSAT Logo.ico") -Force
    Info "PSAT Logo.ico"
} else {
    Die "missing shortcut icon: $iconSrc"
}

# ── 6. Verify ────────────────────────────────────────────────────────────────
# A bundle that is merely "assembled" is not a bundle that works. An earlier
# version of this script silently dropped the scoring model and the profiles
# blueprint; nothing noticed until the app was launched. These checks make that
# class of failure impossible to ship.
Step "Verify"

$required = @(
    "python\python.exe",
    "python\Library\share\proj",
    "python\Library\share\gdal",
    "backend\app.py",
    "backend\version.json",
    "backend\app\services\data\cyclerap_v214_model.json",  # CycleRAP v2.14 scoring tables
    "backend\app\services\data\stm_v214_treatments.json",  # STM treatment model
    "backend\app\api\profiles",                            # profile system blueprint
    "backend\app\api\tiles.py",
    "backend\app\services\paths.py",
    "backend\models",
    "backend\shapefiles",
    "webui\index.html",
    "webui\assets",
    "launcher\launch_psat.py",
    "PSAT.bat",
    "PSAT Logo.ico"                                        # shortcut icon
)
$missing = @()
foreach ($rel in $required) {
    if (-not (Test-Path (Join-Path $BundleRoot $rel))) { $missing += $rel }
}
if ($missing.Count) {
    Write-Host "Missing from bundle:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Die "bundle is incomplete"
}
Info "all required paths present"

# The strongest check available without a browser: import the whole app inside
# the FROZEN interpreter. Catches any missing module or data file at once.
$smoke = & (Join-Path $BundleRoot "python\python.exe") -c @"
import sys
sys.path.insert(0, r'$BundleRoot\backend')
from app import create_app
create_app()
import os
print('SMOKE_OK', os.environ.get('GDAL_DATA') is not None)
"@ 2>&1
if ($LASTEXITCODE -ne 0 -or ($smoke -join "`n") -notmatch "SMOKE_OK") {
    Write-Host ($smoke -join "`n") -ForegroundColor Red
    Die "frozen interpreter could not import the app"
}
Info "frozen interpreter imports the app cleanly"
if (($smoke -join "`n") -match "SMOKE_OK True") { Info "GDAL_DATA bound from the bundled env" }
else { Write-Host "    WARNING: GDAL_DATA was not bound" -ForegroundColor Yellow }

# ── Report ───────────────────────────────────────────────────────────────────
Step "Result"
$parts = [ordered]@{
    "python (frozen env)" = Get-DirSize $pythonDir
    "backend/shapefiles"  = Get-DirSize (Join-Path $backendDst "shapefiles")
    "backend/models"      = Get-DirSize (Join-Path $backendDst "models")
    "backend (code)"      = (Get-DirSize $backendDst) - (Get-DirSize (Join-Path $backendDst "shapefiles")) - (Get-DirSize (Join-Path $backendDst "models"))
    "webui"               = Get-DirSize $webuiDst
}
$total = 0
foreach ($k in $parts.Keys) {
    "{0,-22} {1,8:N0} MB" -f $k, ($parts[$k] / 1MB) | Write-Host
    $total += $parts[$k]
}
"{0,-22} {1,8:N0} MB  ({2:N2} GB)" -f "TOTAL", ($total / 1MB), ($total / 1GB) | Write-Host -ForegroundColor Green
Write-Host "`nBundle ready: $BundleRoot"
Write-Host "Test it with:  $BundleRoot\PSAT.bat"
