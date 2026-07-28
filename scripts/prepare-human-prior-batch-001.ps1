param(
    [Parameter(Mandatory = $true)]
    [string]$AnalystWorkRoot,
    [string]$RepoRoot
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
$node = (Get-Command node -ErrorAction Stop).Source
$benchmarkRoot = Join-Path $RepoRoot "benchmarks\chart-intent-r26"
$casesRoot = [System.IO.Path]::GetFullPath((Join-Path $benchmarkRoot "cases"))
$vaultRoot = [System.IO.Path]::GetFullPath((Join-Path $benchmarkRoot "outcome-vault"))
$workRoot = [System.IO.Path]::GetFullPath($AnalystWorkRoot)

function Test-IsInside {
    param(
        [string]$Candidate,
        [string]$Container
    )

    $prefix = $Container.TrimEnd('\') + '\'
    return $Candidate.StartsWith(
        $prefix,
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

if ((Test-IsInside $workRoot $casesRoot) -or
    (Test-IsInside $workRoot $vaultRoot) -or
    $workRoot -eq $casesRoot -or
    $workRoot -eq $vaultRoot) {
    throw "AnalystWorkRoot must remain outside cases and outcome-vault."
}

New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
$caseIds = @("MKT-001", "MKT-002", "MKT-003", "VIS-001", "VIS-002")

foreach ($caseId in $caseIds) {
    $caseDirectory = Join-Path $casesRoot $caseId
    $draftPath = Join-Path $workRoot "$caseId.human-prior.json"
    Push-Location $benchmarkRoot
    try {
        & $node ".\tools\benchmark.js" `
            "draft-human-prior" `
            $caseDirectory `
            $draftPath
        if ($LASTEXITCODE -ne 0) {
            throw "Draft preparation failed for $caseId."
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Prepared 5 incomplete blind drafts in $workRoot"
Write-Host "No human prior has been submitted or frozen."
