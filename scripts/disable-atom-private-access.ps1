param(
  [string]$TaskName = "Atom Private Mobile Gateway"
)

$ErrorActionPreference = "Stop"
$markerFile = Join-Path (Join-Path $env:LOCALAPPDATA "AtomGraph") "private-access.json"
if (-not (Test-Path -LiteralPath $markerFile)) {
  Write-Output ([pscustomobject]@{ ok = $true; alreadyDisabled = $true })
  exit 0
}

$marker = Get-Content -Raw -LiteralPath $markerFile | ConvertFrom-Json
if ([string]$marker.contract -ne "atom.private-access") {
  throw "PRIVATE_ACCESS_MARKER_INVALID: refusing to remove an unowned configuration"
}

$tailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
$tailscaleExecutable = if ($tailscaleCommand) {
  $tailscaleCommand.Source
} else {
  Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
}
if (Test-Path -LiteralPath $tailscaleExecutable) {
  & $tailscaleExecutable serve --https=443 off | Out-Null
}

Stop-ScheduledTask -TaskName ([string]$marker.taskName) -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName ([string]$marker.taskName) -Confirm:$false -ErrorAction SilentlyContinue
if ($marker.processId) {
  Stop-Process -Id ([int]$marker.processId) -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $markerFile -Force
Write-Output ([pscustomobject]@{ ok = $true; disabled = $true; taskName = $TaskName })
