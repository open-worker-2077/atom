param(
  [string]$RuntimeTaskName = "Atom Graph Runtime"
)

$ErrorActionPreference = "Stop"
$stateDirectory = Join-Path $env:LOCALAPPDATA "AtomGraph"
$markerFile = Join-Path $stateDirectory "private-access.json"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$settingsScript = Join-Path $PSScriptRoot "atom-long-running-task.ps1"
$runtimeScript = Join-Path $PSScriptRoot "run-atom-graph-service.ps1"
$gatewaySupervisor = Join-Path $PSScriptRoot "run-atom-private-mobile-gateway-service.ps1"
$healthUrl = "http://127.0.0.1:4784/__spatial/api/health"
$runtimeDescription = "Atom Graph runtime supervisor [atom.graph-runtime/1]"

. $settingsScript

if (-not (Test-Path -LiteralPath $markerFile)) {
  throw "PRIVATE_ACCESS_MARKER_MISSING: install private mobile access first"
}
$marker = Get-Content -Raw -LiteralPath $markerFile | ConvertFrom-Json
if ([string]$marker.contract -ne "atom.private-access") {
  throw "PRIVATE_ACCESS_MARKER_INVALID: refusing to repair an unowned configuration"
}
if (-not (Test-Path -LiteralPath $runtimeScript)) {
  throw "ATOM_RUNTIME_SUPERVISOR_MISSING: $runtimeScript"
}
if (-not (Test-Path -LiteralPath $gatewaySupervisor)) {
  throw "PRIVATE_GATEWAY_SUPERVISOR_MISSING: $gatewaySupervisor"
}

$powerShellCommand = Get-Command powershell.exe -ErrorAction Stop
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$settings = New-AtomLongRunningTaskSettings

$existingRuntime = Get-ScheduledTask -TaskName $RuntimeTaskName -ErrorAction SilentlyContinue
if ($null -ne $existingRuntime) {
  $description = [string]$existingRuntime.Description
  if ($description -ne $runtimeDescription) {
    throw "ATOM_RUNTIME_TASK_EXISTS: refusing to replace an unowned task"
  }
}

$runtimeArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $runtimeScript
$runtimeAction = New-ScheduledTaskAction `
  -Execute $powerShellCommand.Source `
  -Argument $runtimeArguments `
  -WorkingDirectory $projectRoot
$runtimeTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$runtimePrincipal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited
Register-ScheduledTask `
  -TaskName $RuntimeTaskName `
  -Action $runtimeAction `
  -Trigger $runtimeTrigger `
  -Principal $runtimePrincipal `
  -Settings $settings `
  -Description $runtimeDescription `
  -Force | Out-Null

$gatewayDefinitions = @([pscustomobject]@{
  Name = [string]$marker.taskName
  Description = "Local identity gate for private Atom mobile access; owns no Atom data."
  Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -AllowedLogin "{1}" -Target "{2}" -Port {3}' -f `
    $gatewaySupervisor, [string]$marker.allowedLogin, "http://127.0.0.1:4784", [int]$marker.gatewayPort
})
if (-not [string]::IsNullOrWhiteSpace([string]$marker.directTaskName)) {
  $gatewayDefinitions += [pscustomobject]@{
    Name = [string]$marker.directTaskName
    Description = "Tailnet-IP-only Atom mobile gateway; accepts only the approved phone Tailscale address."
    Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -AllowedSource "{1}" -HostAddress "{2}" -Target "{3}" -Port {4}' -f `
      $gatewaySupervisor, [string]$marker.directAllowedSource, `
      ([uri][string]$marker.directGatewayUrl).Host, "http://127.0.0.1:4784", `
      ([uri][string]$marker.directGatewayUrl).Port
  }
}
$gatewayTaskNames = @()
foreach ($definition in $gatewayDefinitions) {
  $task = Get-ScheduledTask -TaskName $definition.Name -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    throw "PRIVATE_GATEWAY_TASK_MISSING: $($definition.Name)"
  }
  $gatewayAction = New-ScheduledTaskAction `
    -Execute $powerShellCommand.Source `
    -Argument $definition.Arguments `
    -WorkingDirectory $projectRoot
  Register-ScheduledTask `
    -TaskName $definition.Name `
    -Action $gatewayAction `
    -Trigger $runtimeTrigger `
    -Principal $runtimePrincipal `
    -Settings $settings `
    -Description $definition.Description `
    -Force | Out-Null
  $gatewayTaskNames += $definition.Name
}

foreach ($taskName in $gatewayTaskNames) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
$taskStopDeadline = (Get-Date).AddSeconds(10)
do {
  $runningGatewayTasks = @($gatewayTaskNames | Where-Object {
    (Get-ScheduledTask -TaskName $_).State -eq "Running"
  })
  if ($runningGatewayTasks.Count -eq 0) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $taskStopDeadline)
if ($runningGatewayTasks.Count -ne 0) {
  throw "PRIVATE_GATEWAY_TASK_STOP_TIMEOUT: $($runningGatewayTasks -join ', ')"
}

Start-ScheduledTask -TaskName $RuntimeTaskName
$deadline = (Get-Date).AddSeconds(30)
do {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok -eq $true) { break }
  } catch {}
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
if ($null -eq $health -or $health.ok -ne $true) {
  throw "ATOM_GRAPH_UNAVAILABLE: runtime supervisor did not produce a healthy 4784 service"
}

foreach ($taskName in $gatewayTaskNames) {
  Start-ScheduledTask -TaskName $taskName
}

$gatewayUrl = [string]$marker.gatewayUrl
$allowedLogin = [string]$marker.allowedLogin
$deadline = (Get-Date).AddSeconds(20)
$gatewayReady = $false
do {
  try {
    Invoke-WebRequest `
      -UseBasicParsing `
      -Uri $gatewayUrl `
      -Headers @{ "Tailscale-User-Login" = $allowedLogin } `
      -TimeoutSec 2 | Out-Null
    $gatewayReady = $true
    break
  } catch {}
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
if (-not $gatewayReady) {
  throw "PRIVATE_GATEWAY_UNAVAILABLE: $gatewayUrl"
}

$marker | Add-Member -NotePropertyName runtimeTaskName -NotePropertyValue $RuntimeTaskName -Force
$marker | Add-Member -NotePropertyName repairedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString("o")) -Force
$marker | ConvertTo-Json | Set-Content -LiteralPath $markerFile -Encoding utf8

Write-Output ([pscustomobject]@{
  ok = $true
  runtimeTask = $RuntimeTaskName
  gatewayTasks = $gatewayTaskNames
  gateway = $gatewayUrl
})
