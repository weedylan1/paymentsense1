# Docker Setup

## What runs in containers

- `web`: React app served by nginx on port `5173`
- `api`: .NET API on port `5157`
- Postgres stays on the existing Docker container for now and is reached from the API via `host.docker.internal:5432`

## Start

```powershell
docker compose up -d --build
```

Or:

```powershell
.\scripts\start-docker-stack.ps1
```

## Stop

```powershell
docker compose down
```

Or:

```powershell
.\scripts\stop-docker-stack.ps1
```

## URLs

- Frontend: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:5157/health`

For LAN access, swap `127.0.0.1` for your PC IP.

## Backups and rollback

A pre-Docker backup was created under `backups\`.

To roll the source back to the latest pre-Docker snapshot:

```powershell
.\scripts\rollback-pre-docker.ps1
```

To restore source files from a backup:

```powershell
.\scripts\restore-backup.ps1 -BackupPath .\backups\pre-docker-YYYYMMDD-HHMMSS
```

To restore source files and the `myapp` database:

```powershell
.\scripts\restore-backup.ps1 -BackupPath .\backups\pre-docker-YYYYMMDD-HHMMSS -RestoreDatabase
```

The restore script copies the backed-up project files back into the workspace and can optionally pipe the saved `pg_dump` back into the running Postgres container.
