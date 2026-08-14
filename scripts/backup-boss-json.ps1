param(
  [Parameter(Mandatory = $true)]
  [string]$BossDirectory,

  [Parameter(Mandatory = $true)]
  [string]$BackupRepository,

  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$sourceRoot = [System.IO.Path]::GetFullPath($BossDirectory)
$repositoryRoot = [System.IO.Path]::GetFullPath($BackupRepository)
$snapshotRoot = Join-Path $repositoryRoot "graph-data"
$logDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Graph4D"
$logFile = Join-Path $logDirectory "windows-backup.log"

New-Item -ItemType Directory -Force -Path $snapshotRoot, $logDirectory | Out-Null

function Write-BackupLog([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "catalog.json"))) {
  Write-BackupLog "SKIP catalog.json missing at source; existing backup retained"
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot ".git"))) {
  throw "BackupRepository must already be an initialized private Git repository: $repositoryRoot"
}

$sourceFiles = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Filter "*.json"
foreach ($sourceFile in $sourceFiles) {
  $relative = $sourceFile.FullName.Substring($sourceRoot.TrimEnd("\").Length).TrimStart("\")
  $destination = Join-Path $snapshotRoot $relative
  $destinationDirectory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  Copy-Item -LiteralPath $sourceFile.FullName -Destination $destination -Force
}

# Intentionally never remove destination files. If the interaction-side source is
# accidentally deleted, the last Git-backed copy remains available for recovery.
git -C $repositoryRoot add -- "graph-data"
if ($LASTEXITCODE -ne 0) { throw "git add failed" }

git -C $repositoryRoot diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  git -C $repositoryRoot rev-list --count "origin/$Branch..HEAD" | ForEach-Object {
    $pendingCommits = [int]$_
  }
  if ($LASTEXITCODE -ne 0) { throw "git pending-commit check failed" }
  if ($pendingCommits -gt 0) {
    git -C $repositoryRoot push origin $Branch
    if ($LASTEXITCODE -ne 0) {
      Write-BackupLog "WARN $pendingCommits local commit(s) still await GitHub push"
      exit 2
    }
    Write-BackupLog "OK pushed $pendingCommits pending local commit(s)"
    exit 0
  }
  Write-BackupLog "OK no JSON changes"
  exit 0
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
git -C $repositoryRoot commit -m "backup: graph JSON $stamp"
if ($LASTEXITCODE -ne 0) { throw "git commit failed" }

git -C $repositoryRoot push origin $Branch
if ($LASTEXITCODE -ne 0) {
  Write-BackupLog "WARN local commit created; GitHub push failed and will be retried next run"
  exit 2
}

Write-BackupLog "OK committed and pushed $($sourceFiles.Count) JSON files"
