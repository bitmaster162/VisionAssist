param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$edgeRoot = Join-Path $RepoRoot "services\edge"

$candidateNodes = @()

if ($env:VISIONASSIST_NODE_EXE) {
    $candidateNodes += $env:VISIONASSIST_NODE_EXE
}

$candidateNodes += @(
    (Join-Path $env:TEMP "visionassist-node-v22.22.1-win-x64\node.exe"),
    (Join-Path $env:TEMP "bitevo-node-v22.22.1\node.exe")
)

$pathNode = Get-Command node -ErrorAction SilentlyContinue
if ($pathNode) {
    $candidateNodes += $pathNode.Source
}

$nodeExe = $null
foreach ($candidate in $candidateNodes) {
    if (-not $candidate) {
        continue
    }

    if (($candidate -eq "node") -or (Test-Path $candidate)) {
        try {
            & $candidate --version | Out-Null
            $nodeExe = $candidate
            break
        } catch {
            continue
        }
    }
}

if (-not $nodeExe) {
    throw "Node.js was not found. Install Node 18+ or restore the temporary runtime."
}

Write-Host "Starting VisionAssist edge from $edgeRoot"
Write-Host "Using Node runtime: $nodeExe"
Push-Location $edgeRoot
try {
    & $nodeExe ".\src\server.js"
} finally {
    Pop-Location
}
