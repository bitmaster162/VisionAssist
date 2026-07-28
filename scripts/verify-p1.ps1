param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source

function Invoke-Checked {
    param(
        [string]$WorkingDirectory,
        [string]$Executable,
        [string[]]$Arguments
    )

    Push-Location $WorkingDirectory
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Executable failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

$benchmarkRoot = Join-Path $RepoRoot "benchmarks\chart-intent-r26"
$edgeRoot = Join-Path $RepoRoot "services\edge"
$sourceProofRoot = Join-Path $RepoRoot "docs\research\intent-contract-r26-proof"

Write-Host "1/10 R33 handoff intake contract"
Invoke-Checked $RepoRoot $node @(
    "--test",
    ".\contracts\handoff-r33\test\handoff.test.mjs"
)

Write-Host "2/10 R29 lineage and portfolio contract"
Invoke-Checked $RepoRoot $node @(
    "--test",
    ".\contracts\lineage-r29\test\lineage.test.mjs"
)

Write-Host "3/10 Benchmark contract, lifecycle, corpus intake, AI runner, and metrics"
Invoke-Checked $benchmarkRoot $node @(
    "--test",
    ".\test\ai-runner.test.js",
    ".\test\contract.test.js",
    ".\test\custody-snapshot.test.js",
    ".\test\human-prior.test.js",
    ".\test\intake.test.js",
    ".\test\lifecycle.test.js",
    ".\test\market-corpus.test.js",
    ".\test\metrics.test.js",
    ".\test\visual-corpus.test.js"
)

Write-Host "4/10 Frozen market corpus and custodian commitments"
Invoke-Checked $benchmarkRoot $node @(
    ".\tools\benchmark.js",
    "verify-market-corpus"
)

Write-Host "5/10 Frozen synthetic visual-control corpus and custodian commitments"
Invoke-Checked $benchmarkRoot $node @(
    ".\tools\benchmark.js",
    "verify-visual-corpus"
)

Write-Host "6/10 Local custody snapshot"
Invoke-Checked $benchmarkRoot $node @(
    ".\tools\benchmark.js",
    "verify-custody"
)

Write-Host "7/10 Intent R26 runtime"
Invoke-Checked $edgeRoot $node @("--test")

Write-Host "8/10 Canonical Intent R26 record"
Invoke-Checked $edgeRoot $node @(".\tools\validate-intent-record.js")

Write-Host "9/10 Preserved source proof"
Invoke-Checked $sourceProofRoot $python @(
    "-m",
    "unittest",
    "discover",
    "-s",
    "tests"
)

Write-Host "10/10 Real corpus status"
Invoke-Checked $benchmarkRoot $node @(".\tools\benchmark.js", "status")

Write-Host "P1 harness verification complete. Corpus completion is reported separately above."
