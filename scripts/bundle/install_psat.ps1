<#
.SYNOPSIS
  Install PSAT for the current user. No admin rights required.

.DESCRIPTION
  Run from the thumbdrive via "Install PSAT.bat". Copies the app into the user's
  own program folder, optionally seeds a quarter of survey data, and creates
  shortcuts.

  Per-user install is deliberate: it needs no administrator, and the updater must
  be able to replace app files without a UAC prompt every time.

  Expected layout on the drive:
      PSAT\             the app bundle
      seed-data.zip     (optional) survey data, zipped -- preferred
      seed-data\        (optional) survey data as loose folders -- slower
      Install PSAT.bat  runs this script

.NOTES
  Data lives OUTSIDE the app folder. Updates replace the app wholesale, so
  anything stored inside it would be destroyed on the next update.
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\Programs\PSAT",
    [string]$DataRoot    = "",
    [switch]$NoPrompt
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say($m)  { Write-Host $m }
function Head($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Die($m)  { Write-Host "`nERROR: $m" -ForegroundColor Red; Read-Host "`nPress Enter to close"; exit 1 }

function Get-FreeBytes($path) {
    $qualifier = Split-Path -Qualifier $path
    try { (Get-PSDrive -Name $qualifier.TrimEnd(':')).Free } catch { $null }
}

function Copy-Tree($from, $to, $label) {
    Say "  copying $label ..."
    $null = robocopy $from $to /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
    # robocopy uses <8 for success; >=8 is a genuine failure
    if ($LASTEXITCODE -ge 8) { Die "copy failed for $label (robocopy $LASTEXITCODE)" }
}

Write-Host "======================================================================"
Write-Host "  PSAT installer"
Write-Host "======================================================================"

# ── Locate the bundle ────────────────────────────────────────────────────────
$bundle = Join-Path $Source "PSAT"
if (-not (Test-Path (Join-Path $bundle "PSAT.bat"))) {
    Die "Could not find the PSAT app folder next to this installer.`n  Expected: $bundle"
}
$bundleBytes = (Get-ChildItem -Recurse -File $bundle | Measure-Object -Sum Length).Sum

# ── Where should data live? ──────────────────────────────────────────────────
# Survey data is far larger than the app (~45 GB per quarter), and many machines
# cannot spare that on C:. Ask rather than assume.
$defaultData = "$env:LOCALAPPDATA\PSAT\data"
if (-not $DataRoot) {
    if ($NoPrompt) {
        $DataRoot = $defaultData
    } else {
        Head "Where should PSAT store projects and survey images?"
        Say "  Survey data can be tens of gigabytes. Put it on a drive with room."
        Say "  Press Enter to accept the default."
        Say ""
        Say "  Default: $defaultData"
        $answer = Read-Host "  Data folder"
        $DataRoot = if ([string]::IsNullOrWhiteSpace($answer)) { $defaultData } else { $answer.Trim('"') }
    }
}

# ── Seed data (optional) ─────────────────────────────────────────────────────
# Current model: <drive>\seed\{in,data} — survey frames AND their pre-created
# projects. Both must be laid down: a pruned in/ folder without its project would
# resample thinned frames and undercount. Legacy seed-data.zip / seed-data\
# (in/ only) is still honoured for older drives.
$seedRoot     = Join-Path $Source "seed"
$seedIn       = Join-Path $seedRoot "in"
$seedProjects = Join-Path $seedRoot "data"
$seedZip      = Join-Path $Source "seed-data.zip"      # legacy, in/ only
$seedDir      = Join-Path $Source "seed-data"          # legacy, in/ only
$seedBytes = 0
if (Test-Path $seedIn) {
    $seedBytes = (Get-ChildItem -Recurse -File $seedRoot -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum
} elseif (Test-Path $seedZip) {
    $seedBytes = (Get-Item $seedZip).Length * 3   # rough decompressed estimate
} elseif (Test-Path $seedDir) {
    $seedBytes = (Get-ChildItem -Recurse -File $seedDir -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum
}

# ── Disk preflight ───────────────────────────────────────────────────────────
# The fleet's free space cannot be surveyed in advance, so refuse clearly up
# front rather than dying halfway through a multi-GB copy.
Head "Checking disk space"
$needApp  = $bundleBytes * 1.05
$needData = $seedBytes * 1.05
foreach ($pair in @(@($InstallRoot, $needApp, "application"), @($DataRoot, $needData, "survey data"))) {
    $target, $need, $label = $pair
    if ($need -le 0) { continue }
    $free = Get-FreeBytes $target
    if ($null -eq $free) { continue }
    "  {0,-14} needs {1,7:N1} GB, drive has {2,7:N1} GB free" -f $label, ($need/1GB), ($free/1GB) | Write-Host
    if ($free -lt $need) {
        Die ("Not enough free space for the $label.`n" +
             "  Needs {0:N1} GB, but the drive holding`n  $target`n  has only {1:N1} GB free.`n`n" +
             "  Free up space, or re-run and choose a different folder." -f ($need/1GB), ($free/1GB))
    }
}

# ── Install the app ──────────────────────────────────────────────────────────
Head "Installing the application"
if (Test-Path $InstallRoot) {
    Say "  existing install found - replacing app files (your data is untouched)"
    Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Tree $bundle $InstallRoot "PSAT ($([math]::Round($bundleBytes/1GB,2)) GB)"

# Record the chosen data folder. Read by launch_psat.py; deliberately NOT part of
# any update component, so updates cannot overwrite it.
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
# WriteAllText, not Set-Content -Encoding UTF8: Windows PowerShell 5.1 writes a
# BOM with the latter, which corrupts the path when the launcher reads it.
[System.IO.File]::WriteAllText((Join-Path $InstallRoot "data_dir.txt"), $DataRoot)

# ── Seed survey data + projects ──────────────────────────────────────────────
if (Test-Path $seedIn) {
    Head "Installing survey data + projects"
    $inDir = Join-Path $DataRoot "in"
    New-Item -ItemType Directory -Force -Path $inDir | Out-Null
    Copy-Tree $seedIn $inDir "survey data (in/)"
    $n = (Get-ChildItem -Directory $inDir -ErrorAction SilentlyContinue).Count
    Say "  $n survey folders installed"

    if (Test-Path $seedProjects) {
        # The pre-created projects. They ship in the shared (legacy) data\ root;
        # the user pulls them into their profile on first launch with the
        # "Move Shared Projects" button (a fast same-volume move).
        $dataDir = Join-Path $DataRoot "data"
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
        Copy-Tree $seedProjects $dataDir "projects (data/)"
        $p = (Get-ChildItem -Directory $dataDir -ErrorAction SilentlyContinue).Count
        Say "  $p projects installed (pull them in via 'Move Shared Projects' on first launch)"
    } else {
        Say "  WARNING: survey frames present but no projects - segment counts will be wrong."
    }
} elseif (Test-Path $seedZip) {
    Head "Installing survey data (legacy zip, no projects)"
    $inDir = Join-Path $DataRoot "in"
    New-Item -ItemType Directory -Force -Path $inDir | Out-Null
    Say "  extracting seed-data.zip ..."
    Expand-Archive -Path $seedZip -DestinationPath $inDir -Force
    Say "  $((Get-ChildItem -Directory $inDir -ErrorAction SilentlyContinue).Count) survey folders installed"
} elseif (Test-Path $seedDir) {
    Head "Installing survey data (legacy folder, no projects)"
    $inDir = Join-Path $DataRoot "in"
    New-Item -ItemType Directory -Force -Path $inDir | Out-Null
    Copy-Tree $seedDir $inDir "survey data"
} else {
    Head "Survey data"
    Say "  none found on this drive - PSAT will start with no projects."
    Say "  Add folders later to: $DataRoot\in\"
}

# ── Shortcuts ────────────────────────────────────────────────────────────────
Head "Creating shortcuts"
$target = Join-Path $InstallRoot "PSAT.bat"
$icon   = Join-Path $InstallRoot "PSAT Logo.ico"
$shell  = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'),
                   (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"))) {
    try {
        $lnk = $shell.CreateShortcut((Join-Path $dir "PSAT.lnk"))
        $lnk.TargetPath       = $target
        $lnk.WorkingDirectory = $InstallRoot
        if (Test-Path $icon) { $lnk.IconLocation = $icon }
        $lnk.Description      = "Path Safety Assessment Tool"
        $lnk.Save()
        Say "  $dir\PSAT.lnk"
    } catch {
        Say "  could not create shortcut in $dir ($($_.Exception.Message))"
    }
}

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "  PSAT installed" -ForegroundColor Green
Write-Host "======================================================================"
Say ""
Say "  Application : $InstallRoot"
Say "  Your data   : $DataRoot"
Say ""
Say "  Start it from the Desktop shortcut, or run:"
Say "    $target"
Say ""
Say "  Updates download themselves; PSAT will tell you when one is ready."
Write-Host ""
if (-not $NoPrompt) { Read-Host "Press Enter to close" }
