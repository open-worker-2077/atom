param(
  [string]$RuntimeTaskName = "Atom Graph Runtime",
  [string]$WatchdogTaskName = "Atom Graph Runtime Health Watchdog",
  [int]$IntervalMinutes = 1
)

$ErrorActionPreference = "Stop"
$watchdogDescription = "Atom Graph runtime health watchdog [atom.graph-runtime-health/1]"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$watchdogScript = Join-Path $PSScriptRoot "watch-atom-runtime-health.ps1"

if ($IntervalMinutes -lt 1) {
  throw "ATOM_RUNTIME_WATCHDOG_INTERVAL_INVALID: IntervalMinutes must be positive"
}
if (-not (Test-Path -LiteralPath $watchdogScript)) {
  throw "ATOM_RUNTIME_WATCHDOG_SCRIPT_MISSING: $watchdogScript"
}

$runtimeTask = Get-ScheduledTask -TaskName $RuntimeTaskName -ErrorAction SilentlyContinue
if ($null -eq $runtimeTask) {
  throw "ATOM_RUNTIME_TASK_MISSING: $RuntimeTaskName"
}
$runtimeAction = @($runtimeTask.Actions)[0]
$runtimeExecute = [string]$runtimeAction.Execute
$runtimeArguments = [string]$runtimeAction.Arguments
if ([IO.Path]::GetFileName($runtimeExecute) -ine "node.exe" -or $runtimeArguments -notmatch "graph-server\.mjs") {
  throw "ATOM_RUNTIME_TASK_NOT_DIRECT_NODE: refusing to supervise an unknown runtime action"
}

$existing = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue
if ($null -ne $existing -and [string]$existing.Description -ne $watchdogDescription) {
  throw "ATOM_RUNTIME_WATCHDOG_TASK_EXISTS: refusing to replace an unowned task"
}

$powershell = Get-Command powershell.exe -ErrorAction Stop
$watchdogArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -TaskName "{1}"' -f `
  $watchdogScript, $RuntimeTaskName
$action = New-ScheduledTaskAction `
  -Execute $powershell.Source `
  -Argument $watchdogArguments `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At ((Get-Date).AddMinutes($IntervalMinutes)) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

Register-ScheduledTask `
  -TaskName $WatchdogTaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description $watchdogDescription `
  -Force | Out-Null

Write-Output ([pscustomobject]@{
  ok = $true
  runtimeTask = $RuntimeTaskName
  watchdogTask = $WatchdogTaskName
  intervalMinutes = $IntervalMinutes
})
