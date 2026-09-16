param(
  [switch]$NoBrowser,
  [switch]$NoFailureDialog,
  [string]$RuntimeTaskName = 'Atom Graph Runtime',
  [int]$StartupTimeoutSeconds = 300,
  [int]$PollMilliseconds = 1000
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

function Show-AtomGraphFailure {
  param([string]$Message)

  if ($NoFailureDialog) { return }

  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup($Message, 0, 'Atom startup failed', 16)
  } catch {
    # The original failure remains authoritative when a desktop dialog is unavailable.
  }
}

function Start-AtomGraphFallback {
  $node = Get-Command node -ErrorAction Stop
  return Start-Process `
    -FilePath $node.Source `
    -ArgumentList @('work-engine\atom-language\graph-server.mjs') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru
}

try {
  $server = $null

  if (-not (Test-AtomGraphHealth)) {
    $runtimeTask = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
      $_.TaskName -eq $RuntimeTaskName
    }) | Select-Object -First 1
    if ($null -ne $runtimeTask) {
      if ([string]$runtimeTask.State -ne 'Running') {
        Start-ScheduledTask -TaskName $RuntimeTaskName
        Write-Output "Starting the supervised Atom runtime..."
      } else {
        Write-Output "The supervised Atom runtime is already starting; waiting for health..."
      }
    } else {
      Write-Output "The supervised Atom runtime task is unavailable; starting the local fallback..."
      $server = Start-AtomGraphFallback
    }

    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      if (Test-AtomGraphHealth) { break }
      if (($null -ne $server) -and $server.HasExited) {
        throw "ATOM_GRAPH_STARTUP_EXITED: Atom Graph exited before becoming healthy (exit code $($server.ExitCode))."
      }
      $remainingSeconds = [Math]::Max(0, [Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds))
      Write-Progress -Activity 'Starting Atom' -Status "Waiting for the Web service ($remainingSeconds seconds remaining)..."
      Start-Sleep -Milliseconds $PollMilliseconds
    }
  }

  Write-Progress -Activity 'Starting Atom' -Completed

  if (-not (Test-AtomGraphHealth)) {
    throw "ATOM_GRAPH_STARTUP_TIMEOUT: Atom Graph did not become healthy on port 4784 within $StartupTimeoutSeconds seconds."
  }

  if (-not $NoBrowser) {
    Start-Process $WebUrl
  }

  Write-Output "Atom Graph ready: $WebUrl"
} catch {
  Write-Progress -Activity 'Starting Atom' -Completed
  Show-AtomGraphFailure -Message $_.Exception.Message
  throw
}
