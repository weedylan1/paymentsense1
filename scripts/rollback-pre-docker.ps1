$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$marker = Join-Path $root "backups\\latest-pre-docker.txt"

if (-not (Test-Path $marker)) {
    throw "Latest backup marker not found: $marker"
}

$backupPath = (Get-Content -Raw $marker).Trim()

if ([string]::IsNullOrWhiteSpace($backupPath)) {
    throw "Latest backup marker is empty: $marker"
}

& (Join-Path $PSScriptRoot "restore-backup.ps1") -BackupPath $backupPath
