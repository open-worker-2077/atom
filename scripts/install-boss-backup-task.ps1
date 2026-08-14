param(
  [Parameter(Mandatory = $true)]
  [string]$BossDirectory,

  [Parameter(Mandatory = $true)]
  [string]$BackupRepository,

  [string]$TaskName = "Graph4D JSON Safety Backup",
  [int]$Minutes = 15
)

$ErrorActionPreference = "Stop"
if ($Minutes -lt 1) { throw "Minutes must be at least 1" }

$backupScript = Join-Path $PSScriptRoot "backup-boss-json.ps1"
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -BossDirectory "{1}" -BackupRepository "{2}"' -f `
  $backupScript, `
  ([System.IO.Path]::GetFullPath($BossDirectory)), `
  ([System.IO.Path]::GetFullPath($BackupRepository))

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$startup = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$repeating = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($startup, $repeating) `
  -Principal $principal `
  -Settings $settings `
  -Description "Runs at user logon and on a timer; copies Graph4D JSON without propagating source deletions, commits locally, and pushes to private GitHub." `
  -Force
