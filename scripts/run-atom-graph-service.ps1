param(
  [int]$PollSeconds = 2
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverScript = Join-Path $projectRoot "work-engine\atom-language\graph-server.mjs"
$healthUrl = "http://127.0.0.1:4784/__spatial/api/health"
$nodeCommand = Get-Command node.exe -ErrorAction Stop

if (-not (Test-Path -LiteralPath $serverScript)) {
  throw "ATOM_GRAPH_SERVER_MISSING: $serverScript"
}

function Test-AtomGraphHealth {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

Push-Location $projectRoot
try {
  while ($true) {
    if (Test-AtomGraphHealth) {
      Start-Sleep -Seconds $PollSeconds
      continue
    }

    & $nodeCommand.Source $serverScript
    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  Pop-Location
}
