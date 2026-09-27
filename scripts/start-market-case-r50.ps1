[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8790,
  [string]$DataDir = "",
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $repoRoot "apps\market-case-capture\server.js"
$node = Get-Command node -ErrorAction Stop

if (-not $DataDir) {
  $DataDir = Join-Path $env:LOCALAPPDATA "VisionAssist\R50-Operator"
}
$DataDir = [IO.Path]::GetFullPath($DataDir)

$drive = Get-PSDrive -Name C
$nodeProcesses = @(Get-Process -Name node -ErrorAction SilentlyContinue)
$nodePrivateBytes = [int64](($nodeProcesses | Measure-Object PrivateMemorySize64 -Sum).Sum)
if ($drive.Free -lt 15GB) {
  throw "R50 resource gate: C: has less than 15 GiB free."
}
if ($nodeProcesses.Count -gt 20) {
  throw "R50 resource gate: more than 20 Node processes are active."
}
if ($nodePrivateBytes -gt 2GB) {
  throw "R50 resource gate: aggregate Node private memory exceeds 2 GiB."
}

$writerOverlap = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -match "MAWorld|R49B|CODEX03" -and
      $_.ProcessId -ne $PID
    }
)
if ($writerOverlap.Count -gt 0) {
  throw "R50 phase gate: an MAWorld/R49B writer appears active."
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$logPath = Join-Path $env:TEMP "VisionAssist-R50-Operator-$Port.log"
$arguments = @(
  "`"$serverPath`"",
  "--host",
  "127.0.0.1",
  "--port",
  "$Port",
  "--data-dir",
  "`"$DataDir`""
)

$process = Start-Process `
  -FilePath $node.Source `
  -ArgumentList $arguments `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError "$logPath.error"

$url = "http://127.0.0.1:$Port"
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if ($process.HasExited) {
      throw "VisionAssist R50 runtime exited early. See $logPath.error"
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/status" -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) {
    throw "VisionAssist R50 runtime did not become ready."
  }

  Write-Host "VisionAssist R50 is ready: $url"
  Write-Host "Local data: $DataDir"
  Write-Host "Log: $logPath"
  Write-Host "Press Ctrl+C to stop the local runtime."
  if (-not $NoBrowser) {
    Start-Process $url
  }
  Wait-Process -Id $process.Id
} finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
}
