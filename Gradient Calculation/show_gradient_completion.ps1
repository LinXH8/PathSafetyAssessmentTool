param(
    [Parameter(Mandatory = $true)]
    [string]$MetadataPath
)

if (-not (Test-Path -LiteralPath $MetadataPath)) {
    throw "Metadata file not found: $MetadataPath"
}

$metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json

if (-not $metadata.profile_point_count -or -not $metadata.valid_gradient_count -and $metadata.valid_gradient_count -ne 0) {
    throw "Metadata file is missing profile_point_count or valid_gradient_count"
}

$profilePointCount = [double]$metadata.profile_point_count
$validGradientCount = [double]$metadata.valid_gradient_count
$validElevationCount = 0
$rejectedStepJumpCount = 0

if ($null -ne $metadata.valid_elevation_count) {
    $validElevationCount = [double]$metadata.valid_elevation_count
}

if ($null -ne $metadata.rejected_step_jump_count) {
    $rejectedStepJumpCount = [double]$metadata.rejected_step_jump_count
}

$usableGradientCompletionPct = [math]::Round(($validGradientCount / $profilePointCount) * 100, 2)
$elevationHitCoveragePct = [math]::Round(($validElevationCount / $profilePointCount) * 100, 2)
$stepJumpRejectPct = [math]::Round(($rejectedStepJumpCount / $profilePointCount) * 100, 2)

Write-Output "Path: $($metadata.display_name)"
Write-Output "Profile points: $($metadata.profile_point_count)"
Write-Output "Valid gradients: $($metadata.valid_gradient_count)"
Write-Output "Usable gradient completion: $usableGradientCompletionPct%"
Write-Output "Elevation-hit coverage: $elevationHitCoveragePct%"
Write-Output "Step-jump rejection rate: $stepJumpRejectPct%"