param(
  [switch]$NoBrowser,
  [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$WebUrl = 'http://127.0.0.1:4784/'
$HealthUrl = 'http://127.0.0.1:4784/__spatial/api/health'

function Test-AtomGraphHealth {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 1
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

if (-not (Test-AtomGraphHealth)) {
  $node = Get-Command node -ErrorAction Stop
  $server = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @('work-engine\atom-language\graph-server.mjs') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru

  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-AtomGraphHealth) { break }
    if ($server.HasExited) {
      throw "Atom Graph server exited before becoming healthy (exit code $($server.ExitCode))."
    }
    Start-Sleep -Milliseconds 300
  }
}

if (-not (Test-AtomGraphHealth)) {
  throw "Atom Graph did not become healthy on port 4784 within $StartupTimeoutSeconds seconds."
}

if (-not $NoBrowser) {
  Start-Process $WebUrl
}

Write-Output "Atom Graph ready: $WebUrl"
