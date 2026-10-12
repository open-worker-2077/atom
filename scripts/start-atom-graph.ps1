param(
  [switch]$NoBrowser,
  [switch]$NoFailureDialog,
  [string]$RuntimeTaskName = 'Atom Graph Runtime',
  [int]$StartupTimeoutSeconds = 300,
  [int]$PollMilliseconds = 1000,
  [string]$LogDirectory = (Join-Path $env:LOCALAPPDATA 'AtomGraph\startup-logs'),
  [string]$MutexName = 'Local\AtomGraphDesktopStartup'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$WebUrl = 'http://127.0.0.1:4784/'
$HealthUrl = 'http://127.0.0.1:4784/__spatial/api/health'
$startupMutex = $null
$ownsStartupMutex = $false
$logFile = Join-Path $LogDirectory ('startup-{0}-{1}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [guid]::NewGuid().ToString('N'))

function Write-AtomStartupLog([string]$Message) {
  try {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    Add-Content -LiteralPath $logFile -Value ('{0} {1}' -f (Get-Date).ToString('o'), $Message) -Encoding UTF8
  } catch { Write-Warning 'Atom startup log could not be written.' }
}

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
    -RedirectStandardOutput "$logFile.stdout.log" `
    -RedirectStandardError "$logFile.stderr.log" `
    -PassThru
}

try {
  Write-AtomStartupLog 'Checking Atom service; waiting for other startup requests if needed.'
  $startupMutex = [System.Threading.Mutex]::new($false, $MutexName)
  try { $ownsStartupMutex = $startupMutex.WaitOne([Math]::Max(0, $StartupTimeoutSeconds) * 1000) }
  catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
  if (-not $ownsStartupMutex) { throw 'ATOM_GRAPH_STARTUP_BUSY: Another startup is still in progress.' }
  $server = $null

  if (-not (Test-AtomGraphHealth)) {
    $runtimeTask = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
      $_.TaskName -eq $RuntimeTaskName
    }) | Select-Object -First 1
    if ($null -ne $runtimeTask) {
      if ([string]$runtimeTask.State -ne 'Running') {
        Start-ScheduledTask -TaskName $RuntimeTaskName
        Write-AtomStartupLog 'Started the supervised runtime.'
        Write-Output "Starting the supervised Atom runtime..."
      } else {
        Write-Output "The supervised Atom runtime is already starting; waiting for health..."
      }
    } else {
      Write-Output "The supervised Atom runtime task is unavailable; starting the local fallback..."
      $server = Start-AtomGraphFallback
      Write-AtomStartupLog "Started local fallback PID $($server.Id)."
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

  Write-AtomStartupLog "Atom Graph ready: $WebUrl; browser=$(-not $NoBrowser)"
  Write-Output "Atom Graph ready: $WebUrl"
} catch {
  Write-Progress -Activity 'Starting Atom' -Completed
  $failureMessage = "$($_.Exception.Message) Startup log: $logFile"
  Write-AtomStartupLog $failureMessage
  Show-AtomGraphFailure -Message $failureMessage
  throw $failureMessage
} finally {
  if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
  if ($null -ne $startupMutex) { $startupMutex.Dispose() }
}
