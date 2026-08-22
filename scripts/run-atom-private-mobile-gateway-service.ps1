param(
  [string]$AllowedLogin,
  [string]$AllowedSource,
  [string]$HostAddress = "127.0.0.1",
  [string]$Target = "http://127.0.0.1:4784",
  [int]$Port = 4785,
  [int]$PollSeconds = 2
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gatewayScript = Join-Path $projectRoot "work-engine\atom-language\private-mobile-gateway.mjs"
$nodeCommand = Get-Command node.exe -ErrorAction Stop

if (-not (Test-Path -LiteralPath $gatewayScript)) {
  throw "PRIVATE_GATEWAY_MISSING: $gatewayScript"
}
if ([string]::IsNullOrWhiteSpace($AllowedLogin) -and [string]::IsNullOrWhiteSpace($AllowedSource)) {
  throw "PRIVATE_GATEWAY_ALLOWLIST_REQUIRED"
}

$gatewayArguments = @($gatewayScript)
if (-not [string]::IsNullOrWhiteSpace($AllowedLogin)) {
  $gatewayArguments += @("--allowed-login", $AllowedLogin)
}
if (-not [string]::IsNullOrWhiteSpace($AllowedSource)) {
  $gatewayArguments += @("--allowed-source", $AllowedSource)
}
$gatewayArguments += @("--host", $HostAddress, "--target", $Target, "--port", [string]$Port)

Push-Location $projectRoot
try {
  while ($true) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($null -ne $listener) {
      Start-Sleep -Seconds $PollSeconds
      continue
    }

    & $nodeCommand.Source @gatewayArguments
    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  Pop-Location
}
