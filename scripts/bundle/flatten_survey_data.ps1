<#
.SYNOPSIS
  Flatten a region-nested PathWatcher survey delivery into the flat layout PSAT expects.

.DESCRIPTION
  Deliveries arrive grouped by map region:

      <delivery>\NE1\ANCHORVALE LINK\*.jpeg
      <delivery>\SE2\MACPHERSON ROAD\*.jpeg

  PSAT's `in/` expects road folders FLAT, with images directly inside:

      in\ANCHORVALE LINK_1Q2026\*.jpeg

  So the region level has to be flattened away. The catch: a long road crosses
  region boundaries and therefore appears in several region folders (274 of them
  in the Mar-2026 delivery, e.g. MACPHERSON ROAD in SE1+SE2+SE3). A naive copy
  would have each region overwrite the last and silently lose frames, so those
  roads are MERGED - every region's frames end up in the one road folder.

  Repeated frame names during a merge are classified by content hash, not assumed:
  in the Mar-2026 delivery 344 were byte-identical duplicates (safely collapsed)
  but 15 were DIFFERENT images sharing a name. Letting those overwrite each other
  would have silently destroyed frames, so every distinct version is kept - the
  first under its own name, the rest suffixed `__<REGION>`.

  Timestamps are preserved (robocopy /COPY:DAT). This matters: PSAT derives the
  survey quarter from file mtime, so resetting them to copy-time would mislabel
  the whole delivery.

.PARAMETER Source
  Delivery root containing the region folders.

.PARAMETER Dest
  Output `in/` directory. Created if missing.

.PARAMETER Quarter
  Quarter suffix appended to each road folder, e.g. 1Q2026. PSAT auto-appends this
  itself on first view; pre-naming avoids it renaming thousands of folders at
  runtime. Verify it matches the delivery's file mtimes before using.

.PARAMETER Regions
  Optional subset of region folders (for testing on one region first).

.EXAMPLE
  pwsh scripts\bundle\flatten_survey_data.ps1 `
      -Source "D:\LIGHTHAUS MAR 2026\LIGHTHAUS MAR 2026" `
      -Dest   "D:\PSAT-seed\in" -Quarter 1Q2026
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Dest,
    [string]$Quarter = "1Q2026",
    [string[]]$Regions,
    [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"
$started = Get-Date

function Head($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }

if (-not (Test-Path $Source)) { Write-Host "ERROR: source not found: $Source" -ForegroundColor Red; exit 1 }

Head "Scanning delivery"
$allRegions = Get-ChildItem -Directory $Source -ErrorAction Stop
$regionDirs = $allRegions
if ($Regions) {
    # `pwsh -File` collapses `-Regions A,B,C` into the single string "A,B,C",
    # so split it back out rather than silently matching nothing.
    $wanted = @($Regions | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $regionDirs = $allRegions | Where-Object { $wanted -contains $_.Name }
    $missing = @($wanted | Where-Object { $allRegions.Name -notcontains $_ })
    if ($missing) { Write-Host "ERROR: no such region(s): $($missing -join ', ')" -ForegroundColor Red; exit 1 }
}
Info "regions: $($regionDirs.Count) ($(($regionDirs | Select-Object -ExpandProperty Name) -join ', '))"

# A run that copies nothing must never report success - that is how empty data
# gets shipped believing it was verified.
if ($regionDirs.Count -eq 0) { Write-Host "ERROR: no regions matched - nothing to do" -ForegroundColor Red; exit 1 }

# road name -> list of source directories (more than one = crosses regions)
$roadMap = [ordered]@{}
foreach ($region in $regionDirs) {
    foreach ($road in Get-ChildItem -Directory $region.FullName -ErrorAction SilentlyContinue) {
        if (-not $roadMap.Contains($road.Name)) { $roadMap[$road.Name] = @() }
        $roadMap[$road.Name] += $road.FullName
    }
}
$multi = @($roadMap.GetEnumerator() | Where-Object { $_.Value.Count -gt 1 })
Info "unique roads      : $($roadMap.Count)"
Info "spanning >1 region: $($multi.Count)  (will be merged)"

if ($WhatIfOnly) {
    Head "WhatIf - nothing copied"
    $multi | Select-Object -First 10 | ForEach-Object {
        Info ("{0} <- {1}" -f $_.Key, (($_.Value | Split-Path -Parent | Split-Path -Leaf) -join ', '))
    }
    exit 0
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

Head "Flattening"
$done = 0; $merged = 0; $deduped = 0; $preserved = 0; $failed = @()
foreach ($entry in $roadMap.GetEnumerator()) {
    $roadName = $entry.Key
    $sources  = $entry.Value
    $target   = Join-Path $Dest ("{0}_{1}" -f $roadName, $Quarter)

    # Only multi-region roads can collide, so only they need the (slower)
    # filename pre-check. Single-region roads copy straight across.
    # Files that must be placed under a disambiguated name after the merge.
    $extraCopies = @()

    if ($sources.Count -gt 1) {
        $merged++

        # Group every frame name across the regions this road appears in.
        $byName = @{}
        foreach ($s in $sources) {
            foreach ($f in Get-ChildItem -File $s -ErrorAction SilentlyContinue) {
                if (-not $byName.ContainsKey($f.Name)) { $byName[$f.Name] = @() }
                $byName[$f.Name] += $f
            }
        }

        foreach ($name in @($byName.Keys)) {
            $group = $byName[$name]
            if ($group.Count -le 1) { continue }

            # The delivery repeats overlap frames where a road crosses a region
            # boundary, so a repeated name is USUALLY the same image twice and
            # collapsing it is a dedupe. But not always: a minority are different
            # images that happen to share a name, and letting those overwrite each
            # other silently destroys frames. So classify by content hash and keep
            # every DISTINCT version - the first under its own name, the rest
            # suffixed with their region.
            $seenHashes = @{}
            $isFirst = $true
            foreach ($f in $group) {
                $h = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
                if ($seenHashes.ContainsKey($h)) { $deduped++; continue }
                $seenHashes[$h] = $true
                if ($isFirst) { $isFirst = $false; continue }

                $region  = Split-Path (Split-Path $f.FullName -Parent) -Parent | Split-Path -Leaf
                $newName = "{0}__{1}{2}" -f [IO.Path]::GetFileNameWithoutExtension($name),
                                            $region,
                                            [IO.Path]::GetExtension($name)
                $extraCopies += [pscustomobject]@{ From = $f.FullName; ToName = $newName }
                $preserved++
            }
        }
    }

    foreach ($s in $sources) {
        # /COPY:DAT (default) preserves timestamps - required for quarter detection.
        $null = robocopy $s $target /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
        if ($LASTEXITCODE -ge 8) { $failed += "$roadName <- $s (robocopy $LASTEXITCODE)" }
    }

    # Re-place the distinct versions that the merge above would have overwritten.
    foreach ($e in $extraCopies) {
        $to = Join-Path $target $e.ToName
        Copy-Item -LiteralPath $e.From -Destination $to -Force
        # Carry the original timestamp across: PSAT reads mtime for the quarter.
        (Get-Item -LiteralPath $to).LastWriteTime = (Get-Item -LiteralPath $e.From).LastWriteTime
    }

    $done++
    if ($done % 250 -eq 0) {
        Info ("{0,5} / {1} roads ... ({2:N0} min elapsed)" -f $done, $roadMap.Count, ((Get-Date) - $started).TotalMinutes)
    }
}

Head "Verifying output"
$outDirs  = Get-ChildItem -Directory $Dest -ErrorAction SilentlyContinue
$outFiles = Get-ChildItem -File -Recurse $Dest -ErrorAction SilentlyContinue
$srcFiles = 0
foreach ($entry in $roadMap.GetEnumerator()) {
    foreach ($s in $entry.Value) {
        $srcFiles += (Get-ChildItem -File $s -ErrorAction SilentlyContinue).Count
    }
}
$expectedFiles = $srcFiles - $deduped
Info ("road folders : {0:N0}  (expected {1:N0})" -f $outDirs.Count, $roadMap.Count)
Info ("files        : {0:N0} out, {1:N0} in source" -f $outFiles.Count, $srcFiles)
Info ("duplicates   : {0:N0} identical frames deduped across region overlaps" -f $deduped)
Info ("preserved    : {0:N0} same-name/different-content frames kept under __<REGION> names" -f $preserved)
Info ("expected out : {0:N0}" -f $expectedFiles)
Info ("size         : {0:N1} GB" -f (($outFiles | Measure-Object -Sum Length).Sum / 1GB))

# Quarter sanity: PSAT reads mtime, so a folder whose frames are not all in the
# named quarter would be mislabeled. Report rather than guess.
$badQuarter = $outFiles | Group-Object { "{0}Q{1}" -f ([math]::Floor(($_.LastWriteTime.Month - 1) / 3) + 1), $_.LastWriteTime.Year } |
              Where-Object { $_.Name -ne $Quarter }
if ($badQuarter) {
    Write-Host "    WARNING: files outside $Quarter :" -ForegroundColor Yellow
    $badQuarter | ForEach-Object { Write-Host ("      {0}: {1:N0} files" -f $_.Name, $_.Count) -ForegroundColor Yellow }
} else {
    Info "quarter      : all files fall in $Quarter"
}

Head "Result"
$problem = $false
if ($outDirs.Count -ne $roadMap.Count) { Write-Host "  FAIL: folder count mismatch" -ForegroundColor Red; $problem = $true }
if ($outFiles.Count -ne $expectedFiles) { Write-Host ("  FAIL: file count mismatch (expected {0:N0}, got {1:N0})" -f $expectedFiles, $outFiles.Count) -ForegroundColor Red; $problem = $true }
if ($failed.Count) {
    Write-Host "  FAIL: $($failed.Count) copy failure(s)" -ForegroundColor Red; $problem = $true
    $failed | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
}
Info ("merged roads : {0}" -f $merged)
Info ("elapsed      : {0:N1} min" -f ((Get-Date) - $started).TotalMinutes)

if ($outFiles.Count -eq 0) { Write-Host "  FAIL: no files copied" -ForegroundColor Red; $problem = $true }
if ($problem) { Write-Host "`nFLATTEN INCOMPLETE - do not ship this" -ForegroundColor Red; exit 1 }
Write-Host "`nFLATTEN OK - $Dest is ready to seed" -ForegroundColor Green
exit 0
