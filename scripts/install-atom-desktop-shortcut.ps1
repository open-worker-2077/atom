param(
  [string]$DesktopDirectory = [Environment]::GetFolderPath('Desktop'),
  [string]$ShortcutName = 'Atom.lnk'
)

$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetFileName($ShortcutName) -ne $ShortcutName -or [IO.Path]::GetExtension($ShortcutName) -ine '.lnk') {
  throw 'ATOM_SHORTCUT_NAME_INVALID: Expected a desktop .lnk filename.'
}
$launcher = Join-Path $PSScriptRoot 'start-atom-graph.ps1'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'ATOM_LAUNCHER_MISSING' }
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $launcher
$shortcutPath = Join-Path $DesktopDirectory $ShortcutName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if (Test-Path -LiteralPath $shortcutPath) {
  if ($shortcut.TargetPath -ine $powershell -or $shortcut.Arguments -cne $arguments) {
    throw "ATOM_SHORTCUT_EXISTS: Refusing to replace $shortcutPath"
  }
  Write-Output "Atom desktop shortcut already installed: $shortcutPath"
  return
}
$shortcut.TargetPath = $powershell
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$shortcut.Description = 'Check and start Atom, then open its Web view'
$shortcut.IconLocation = "$powershell,0"
$shortcut.Save()
Write-Output "Atom desktop shortcut installed: $shortcutPath"
