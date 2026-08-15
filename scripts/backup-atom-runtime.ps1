param(
  [Parameter(Mandatory = $true)]
  [string]$WorldDirectory,

  [Parameter(Mandatory = $true)]
  [string]$BackupRepository,

  [string]$Branch = "runtime-data"
)

$ErrorActionPreference = "Stop"
$sourceRoot = [System.IO.Path]::GetFullPath($WorldDirectory)
$repositoryRoot = [System.IO.Path]::GetFullPath($BackupRepository)
$snapshotRoot = Join-Path $repositoryRoot "runtime-data"
$logDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "AtomGraph"
$logFile = Join-Path $logDirectory "private-backup.log"

New-Item -ItemType Directory -Force -Path $snapshotRoot, $logDirectory | Out-Null

function Write-BackupLog([string]$Message) {
  Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $Message) -Encoding UTF8
}

if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot ".git"))) {
  throw "BackupRepository must be an initialized private Git repository"
}

$names = @("atom.json", "submissions.jsonl")
$copied = 0
foreach ($name in $names) {
  $source = Join-Path $sourceRoot $name
  if (-not (Test-Path -LiteralPath $source)) { continue }
  Copy-Item -LiteralPath $source -Destination (Join-Path $snapshotRoot $name) -Force
  $copied += 1
}

git -C $repositoryRoot add -- "runtime-data"
if ($LASTEXITCODE -ne 0) { throw "git add failed" }

git -C $repositoryRoot diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
  git -C $repositoryRoot commit -m "backup: Atom runtime $stamp"
  if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
}

git -C $repositoryRoot push origin $Branch
if ($LASTEXITCODE -ne 0) {
  Write-BackupLog "WARN local recovery commit retained; private push will retry"
  exit 2
}
Write-BackupLog "OK private backup current ($copied files)"
