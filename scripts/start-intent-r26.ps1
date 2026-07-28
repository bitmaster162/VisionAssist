param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$env:VISIONASSIST_PROFILE = "intent-r26"

if (-not $env:HOST) {
    $env:HOST = "127.0.0.1"
}

if (-not $env:PORT) {
    $env:PORT = "8787"
}

Write-Host "VisionAssist Intent R26"
Write-Host "Console: http://$($env:HOST):$($env:PORT)/intent-r26"

& (Join-Path $PSScriptRoot "start-edge.ps1") -RepoRoot $RepoRoot
