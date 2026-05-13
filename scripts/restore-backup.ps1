param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [switch]$RestoreDatabase
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupPath)) {
    throw "Backup path not found: $BackupPath"
}

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $BackupPath "source"
$dbDumpPath = Join-Path $BackupPath "database\\myapp.sql"

if (-not (Test-Path $sourcePath)) {
    throw "Source backup not found: $sourcePath"
}

$sourceItems = @("apps", "db", "docs", "scripts", "package.json", "package-lock.json", "README.md", ".gitignore")
$dockerItems = @(
    ".dockerignore",
    "docker-compose.yml",
    "apps\\api\\Dockerfile",
    "apps\\api\\.dockerignore",
    "apps\\web\\Dockerfile",
    "apps\\web\\.dockerignore",
    "apps\\web\\nginx.conf"
)

foreach ($item in $dockerItems) {
    $targetItem = Join-Path $root $item
    if (Test-Path $targetItem) {
        Remove-Item -LiteralPath $targetItem -Recurse -Force
    }
}

foreach ($item in $sourceItems) {
    $backupItem = Join-Path $sourcePath $item
    $targetItem = Join-Path $root $item

    if (-not (Test-Path $backupItem)) {
        continue
    }

    if (Test-Path $targetItem) {
        Remove-Item -LiteralPath $targetItem -Recurse -Force
    }

    Copy-Item -LiteralPath $backupItem -Destination $targetItem -Recurse -Force
}

if ($RestoreDatabase) {
    if (-not (Test-Path $dbDumpPath)) {
        throw "Database dump not found: $dbDumpPath"
    }

    Get-Content -Raw $dbDumpPath | docker exec -i dockerdata-postgres-1 psql -U postgres -d myapp
}

Write-Output "Restore complete from $BackupPath"
