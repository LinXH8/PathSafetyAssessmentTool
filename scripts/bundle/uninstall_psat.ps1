<#
.SYNOPSIS
  Uninstall PSAT for the current user.

.DESCRIPTION
  Removes the application and its shortcuts. **Survey data and projects are kept
  by default** and must be deleted deliberately with -IncludeData.

  That default is not politeness: the data folder can hold a quarter of survey
  imagery (~45 GB) plus every project anyone has coded, none of which is
  recoverable from the install drive. Reinstalling is cheap; re-coding is not.

  Written mainly for install/reinstall test cycles, where the app needs to go
  away cleanly but the data usually should not.

.PARAMETER IncludeData
  ALSO delete projects, profiles and survey images. Irreversible. Prompts with
  the exact path and size unless -Force is given.

.PARAMETER Force
  Skip confirmation prompts. For scripted test loops.

.EXAMPLE
  # normal: remove the app, keep all data
  pwsh scripts\bundle\uninstall_psat.ps1

.EXAMPLE
  # full wipe for a clean reinstall test
  pwsh scripts\bundle\uninstall_psat.ps1 -IncludeData
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\Programs\PSAT",
    [switch]$IncludeData,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Head($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }

function Get-DirSize($path) {
    if (-not (Test-Path $path)) { return 0 }
    (Get-ChildItem -Recurse -File $path -ErrorAction SilentlyContinue |
        Measure-Object -Sum Length).Sum
}

Write-Host "======================================================================"
Write-Host "  PSAT uninstaller"
Write-Host "======================================================================"

# ── Work out what is actually installed ──────────────────────────────────────
$appPresent = Test-Path $InstallRoot

# The data folder is chosen at install time, so read it from the install rather
# than assuming the default -- otherwise -IncludeData could miss the real data
# (or, worse, point somewhere unrelated).
$dataRoot = "$env:LOCALAPPDATA\PSAT\data"
$dataDirFile = Join-Path $InstallRoot "data_dir.txt"
if (Test-Path $dataDirFile) {
    try {
        $recorded = [System.IO.File]::ReadAllText($dataDirFile).Trim([char]0xFEFF, ' ', "`r", "`n", "`t")
        if ($recorded) { $dataRoot = $recorded }
    } catch { }
}

Head "Found"
if ($appPresent) {
    Info ("application : {0}  ({1:N2} GB)" -f $InstallRoot, ((Get-DirSize $InstallRoot) / 1GB))
} else {
    Info "application : not installed at $InstallRoot"
}
$dataPresent = Test-Path $dataRoot
$dataBytes = if ($dataPresent) { Get-DirSize $dataRoot } else { 0 }
if ($dataPresent) {
    Info ("data        : {0}  ({1:N2} GB)" -f $dataRoot, ($dataBytes / 1GB))
} else {
    Info "data        : none at $dataRoot"
}

if (-not $appPresent -and -not $dataPresent) {
    Write-Host "`nNothing to uninstall." -ForegroundColor Yellow
    if (-not $Force) { Read-Host "`nPress Enter to close" }
    exit 0
}

# ── Confirm ──────────────────────────────────────────────────────────────────
Head "Will remove"
if ($appPresent) { Info "- the application and its shortcuts" }
if ($IncludeData -and $dataPresent) {
    Write-Host "    - ALL projects, profiles and survey images:" -ForegroundColor Red
    Write-Host ("      {0}  ({1:N2} GB)  THIS CANNOT BE UNDONE" -f $dataRoot, ($dataBytes / 1GB)) -ForegroundColor Red
} elseif ($dataPresent) {
    Info "- (your data is KEPT at $dataRoot)"
}

if (-not $Force) {
    if ($IncludeData -and $dataPresent) {
        # Deleting coded work deserves more friction than a y/n.
        Write-Host ""
        $typed = Read-Host "  To delete the data as well, type DELETE DATA exactly"
        if ($typed -ne "DELETE DATA") {
            Write-Host "`n  Not confirmed - keeping data. Removing the application only." -ForegroundColor Yellow
            $IncludeData = $false
        }
    } else {
        $yn = Read-Host "`n  Continue? (y/N)"
        if ($yn -notmatch '^(y|yes)$') { Write-Host "`nCancelled."; exit 0 }
    }
}

# ── Stop a running instance ──────────────────────────────────────────────────
# Files cannot be deleted while the server is using them.
Head "Stopping PSAT if it is running"
$stopped = 0
Get-Process -Name python, pythonw -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        if ($_.Path -and $_.Path.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $_.Id -Force
            $stopped++
        }
    } catch { }
}
Info $(if ($stopped) { "stopped $stopped PSAT process(es)" } else { "not running" })
if ($stopped) { Start-Sleep -Seconds 2 }   # let file handles close

# ── Shortcuts ────────────────────────────────────────────────────────────────
Head "Removing shortcuts"
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'),
                   (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"))) {
    $lnk = Join-Path $dir "PSAT.lnk"
    if (Test-Path $lnk) {
        try {
            # Only remove shortcuts that point at THIS install, so a second
            # install elsewhere is left alone.
            $target = $shell.CreateShortcut($lnk).TargetPath
            if ($target -and $target.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase)) {
                [System.IO.File]::Delete($lnk)
                Info "removed $lnk"
            } else {
                Info "left alone (points elsewhere): $lnk"
            }
        } catch { Info "could not check $lnk" }
    }
}

# ── Application ──────────────────────────────────────────────────────────────
if ($appPresent) {
    Head "Removing the application"
    try {
        Remove-Item -Recurse -Force $InstallRoot -ErrorAction Stop
        Info "removed $InstallRoot"
    } catch {
        Write-Host "    Could not fully remove $InstallRoot" -ForegroundColor Yellow
        Write-Host "    $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "    Close PSAT (and any window open in that folder) and run this again." -ForegroundColor Yellow
    }
}

# ── Data ─────────────────────────────────────────────────────────────────────
if ($IncludeData -and $dataPresent) {
    Head "Removing data"
    try {
        Remove-Item -Recurse -Force $dataRoot -ErrorAction Stop
        Info "removed $dataRoot"
    } catch {
        Write-Host "    Could not remove $dataRoot : $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "  PSAT uninstalled" -ForegroundColor Green
Write-Host "======================================================================"
if (-not $IncludeData -and $dataPresent) {
    Info ""
    Info "Your projects and survey data are still at:"
    Info "  $dataRoot"
    Info "A fresh install will pick them up again."
    Info "To delete them too, re-run with -IncludeData."
}
Write-Host ""
if (-not $Force) { Read-Host "Press Enter to close" }
