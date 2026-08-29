param(
  [string]$TaskName = "Atom Graph Runtime",
  [string]$HealthUrl = "http://127.0.0.1:4784/__spatial/api/health",
  [string]$StatePath = (Join-Path $env:LOCALAPPDATA "AtomGraph\runtime-health-watchdog.json"),
  [string]$MutexName = "Local\AtomGraphRuntimeHealthWatchdog",
  [int]$StartupGraceSeconds = 120,
  [int]$CooldownSeconds = 120,
  [int]$WaitTimeoutSeconds = 30,
  [int]$PollMilliseconds = 300
)

$ErrorActionPreference = "Stop"
$mutex = [System.Threading.Mutex]::new($false, $MutexName)
$acquired = $false

function Test-AtomRuntimeHealth {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

function Wait-AtomRuntimeHealth {
  $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
  do {
    if (Test-AtomRuntimeHealth) { return $true }
    if ((Get-Date) -ge $deadline) { return $false }
    Start-Sleep -Milliseconds $PollMilliseconds
  } while ($true)
}

function Read-AtomWatchdogState {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return [pscustomobject]@{ unhealthySince = $null; lastRecoveryAt = $null }
  }
  try {
    $state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
    return [pscustomobject]@{
      unhealthySince = if ($null -eq $state.unhealthySince) { $null } else { [string]$state.unhealthySince }
      lastRecoveryAt = if ($null -eq $state.lastRecoveryAt) { $null } else { [string]$state.lastRecoveryAt }
    }
  } catch {
    throw "ATOM_RUNTIME_WATCHDOG_STATE_INVALID: $StatePath"
  }
}

function Write-AtomWatchdogState($State) {
  $directory = Split-Path -Parent $StatePath
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $temporary = "$StatePath.tmp-$PID"
  $State | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporary -Encoding ascii
  Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}

function ConvertFrom-AtomWatchdogTime([string]$Value) {
  [DateTime]::Parse(
    $Value,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind
  )
}

function Test-AtomRecoveryCoolingDown($State, [DateTime]$Now) {
  if ([string]::IsNullOrWhiteSpace([string]$State.lastRecoveryAt)) { return $false }
  $lastRecovery = ConvertFrom-AtomWatchdogTime $State.lastRecoveryAt
  return ($Now.ToUniversalTime() - $lastRecovery.ToUniversalTime()).TotalSeconds -lt $CooldownSeconds
}

function Wait-AtomTaskStopped {
  $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
  do {
    if ([string](Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State -ne "Running") {
      return $true
    }
    if ((Get-Date) -ge $deadline) { return $false }
    Start-Sleep -Milliseconds $PollMilliseconds
  } while ($true)
}

try {
  $acquired = $mutex.WaitOne(0)
  if (-not $acquired) {
    Write-Output ([pscustomobject]@{ ok = $true; action = "skipped"; reason = "concurrent-run" })
    return
  }

  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $state = Read-AtomWatchdogState
  $now = Get-Date
  if ([string]$task.State -ne "Running") {
    if (Test-AtomRecoveryCoolingDown $state $now) {
      Write-AtomWatchdogState $state
      Write-Output ([pscustomobject]@{
        ok = $false; action = "cooldown"; healthy = $false; task = $TaskName; statePath = $StatePath
      })
      return
    }
    $state.lastRecoveryAt = $now.ToUniversalTime().ToString("o")
    Write-AtomWatchdogState $state
    Start-ScheduledTask -TaskName $TaskName
    $healthy = Wait-AtomRuntimeHealth
    if ($healthy) {
      $state.unhealthySince = $null
      $state.lastRecoveryAt = $null
      Write-AtomWatchdogState $state
    }
    Write-Output ([pscustomobject]@{
      ok = $healthy
      action = "started"
      healthy = $healthy
      task = $TaskName
      statePath = $StatePath
    })
    return
  }

  $healthy = Test-AtomRuntimeHealth
  if ($healthy) {
    $state.unhealthySince = $null
    $state.lastRecoveryAt = $null
    Write-AtomWatchdogState $state
    Write-Output ([pscustomobject]@{
      ok = $true; action = "none"; healthy = $true; task = $TaskName; statePath = $StatePath
    })
    return
  }
  if ([string]::IsNullOrWhiteSpace([string]$state.unhealthySince)) {
    $state.unhealthySince = $now.ToUniversalTime().ToString("o")
    Write-AtomWatchdogState $state
    Write-Output ([pscustomobject]@{
      ok = $false; action = "grace"; healthy = $false; task = $TaskName; statePath = $StatePath
    })
    return
  }
  $unhealthySince = ConvertFrom-AtomWatchdogTime $state.unhealthySince
  if (($now.ToUniversalTime() - $unhealthySince.ToUniversalTime()).TotalSeconds -lt $StartupGraceSeconds) {
    Write-AtomWatchdogState $state
    Write-Output ([pscustomobject]@{
      ok = $false; action = "grace"; healthy = $false; task = $TaskName; statePath = $StatePath
    })
    return
  }
  if (Test-AtomRecoveryCoolingDown $state $now) {
    Write-AtomWatchdogState $state
    Write-Output ([pscustomobject]@{
      ok = $false; action = "cooldown"; healthy = $false; task = $TaskName; statePath = $StatePath
    })
    return
  }
  $state.lastRecoveryAt = $now.ToUniversalTime().ToString("o")
  Write-AtomWatchdogState $state
  Stop-ScheduledTask -TaskName $TaskName
  if (-not (Wait-AtomTaskStopped)) {
    throw "ATOM_RUNTIME_WATCHDOG_STOP_TIMEOUT: $TaskName"
  }
  Start-ScheduledTask -TaskName $TaskName
  $healthy = Wait-AtomRuntimeHealth
  if ($healthy) {
    $state.unhealthySince = $null
    $state.lastRecoveryAt = $null
    Write-AtomWatchdogState $state
  }
  Write-Output ([pscustomobject]@{
    ok = $healthy
    action = "restarted"
    healthy = $healthy
    task = $TaskName
    statePath = $StatePath
  })
} finally {
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
