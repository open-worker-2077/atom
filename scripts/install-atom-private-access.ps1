param(
  [string]$AllowedLogin,
  [int]$GatewayPort = 4785,
  [string]$TaskName = "Atom Private Mobile Gateway"
)

$ErrorActionPreference = "Stop"
$atomUrl = "http://127.0.0.1:4784"
$gatewayUrl = "http://127.0.0.1:$GatewayPort"
$stateDirectory = Join-Path $env:LOCALAPPDATA "AtomGraph"
$markerFile = Join-Path $stateDirectory "private-access.json"
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$gatewayScript = Join-Path $repositoryRoot "work-engine\atom-language\private-mobile-gateway.mjs"
$serveOwned = $false
$gatewayProcess = $null

function Get-ObjectEntryCount($Value, [string]$PropertyName) {
  if ($null -eq $Value) { return 0 }
  $property = $Value.PSObject.Properties[$PropertyName]
  if ($null -eq $property -or $null -eq $property.Value) { return 0 }
  if ($property.Value -is [System.Array]) { return $property.Value.Count }
  return @($property.Value.PSObject.Properties).Count
}

function Resolve-CurrentLogin($Status) {
  if (-not [string]::IsNullOrWhiteSpace($AllowedLogin)) { return $AllowedLogin.Trim().ToLowerInvariant() }
  $selfUserId = [string]$Status.Self.UserID
  $user = $Status.User.PSObject.Properties[$selfUserId].Value
  if ($null -eq $user -or [string]::IsNullOrWhiteSpace([string]$user.LoginName)) {
    throw "TAILSCALE_LOGIN_REQUIRED: 无法从 Tailscale 状态确定当前登录身份"
  }
  return ([string]$user.LoginName).Trim().ToLowerInvariant()
}

function Resolve-TailscaleCommand {
  $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }
  $installed = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $installed) { return $installed }
  throw "TAILSCALE_NOT_INSTALLED: 未找到 Tailscale 客户端"
}

if (Test-Path -LiteralPath $markerFile) {
  $existing = Get-Content -Raw -LiteralPath $markerFile | ConvertFrom-Json
  Write-Output ([pscustomobject]@{
    ok = $true
    alreadyConfigured = $true
    gateway = $existing.gatewayUrl
    login = $existing.allowedLogin
  })
  exit 0
}

$tailscaleExecutable = Resolve-TailscaleCommand
$nodeCommand = Get-Command node.exe -ErrorAction Stop
if (-not (Test-Path -LiteralPath $gatewayScript)) { throw "PRIVATE_GATEWAY_MISSING: $gatewayScript" }

$tailscaleStatusText = & $tailscaleExecutable status --json
if ($LASTEXITCODE -ne 0) { throw "TAILSCALE_NOT_RUNNING: 请先登录 Tailscale" }
$tailscaleStatus = $tailscaleStatusText | ConvertFrom-Json
if ([string]$tailscaleStatus.BackendState -ne "Running") { throw "TAILSCALE_NOT_RUNNING: 请先登录 Tailscale" }
$resolvedLogin = Resolve-CurrentLogin $tailscaleStatus
if ($resolvedLogin -notmatch '^[a-z0-9._%+@-]+$') { throw "INVALID_TAILSCALE_LOGIN: 登录名包含不受支持的字符" }

Invoke-WebRequest -UseBasicParsing -Uri $atomUrl -TimeoutSec 5 | Out-Null

$serveStatusText = & $tailscaleExecutable serve status --json 2>$null
$serveStatus = if ([string]::IsNullOrWhiteSpace(($serveStatusText -join ""))) { $null } else { ($serveStatusText | ConvertFrom-Json) }
$existingServeEntries = (Get-ObjectEntryCount $serveStatus "TCP") + (Get-ObjectEntryCount $serveStatus "Web")
if ($existingServeEntries -gt 0) {
  throw "SERVE_CONFIG_NOT_EMPTY: existing Tailscale Serve 配置不属于 Atom，已停止以避免覆盖"
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
  throw "PRIVATE_GATEWAY_TASK_EXISTS: 同名计划任务不属于本次安装，已停止以避免覆盖"
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$taskArguments = '"{0}" --allowed-login "{1}" --target "{2}" --port {3}' -f `
  $gatewayScript, $resolvedLogin, $atomUrl, $GatewayPort
$taskAction = New-ScheduledTaskAction -Execute $nodeCommand.Source -Argument $taskArguments
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Principal $taskPrincipal `
    -Settings $taskSettings `
    -Description "Local identity gate for private Atom mobile access; owns no Atom data." | Out-Null

  $gatewayProcess = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList $taskArguments `
    -WindowStyle Hidden `
    -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    try {
      Invoke-WebRequest `
        -UseBasicParsing `
        -Uri $gatewayUrl `
        -Headers @{ "Tailscale-User-Login" = $resolvedLogin } `
        -TimeoutSec 2 | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) { throw "PRIVATE_GATEWAY_UNAVAILABLE: $gatewayUrl" }

  & $tailscaleExecutable serve --bg --https=443 $gatewayUrl
  if ($LASTEXITCODE -ne 0) { throw "TAILSCALE_SERVE_FAILED" }
  $serveOwned = $true

  $marker = [ordered]@{
    contract = "atom.private-access"
    version = 1
    allowedLogin = $resolvedLogin
    gatewayUrl = $gatewayUrl
    gatewayPort = $GatewayPort
    httpsPort = 443
    taskName = $TaskName
    processId = $gatewayProcess.Id
    configuredAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $marker | ConvertTo-Json | Set-Content -LiteralPath $markerFile -Encoding utf8
  Write-Output ([pscustomobject]@{ ok = $true; gateway = $gatewayUrl; login = $resolvedLogin })
} catch {
  if ($serveOwned) { & $tailscaleExecutable serve --https=443 off | Out-Null }
  if ($gatewayProcess -and -not $gatewayProcess.HasExited) { Stop-Process -Id $gatewayProcess.Id -Force }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  throw
}
