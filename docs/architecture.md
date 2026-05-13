# Paymentsense Match Lab Architecture

## Direction

The application has three layers:

- React frontend in `apps/web` for manual test pages and review workflows.
- .NET API in `apps/api` as the service boundary over Postgres.
- Postgres schemas in `myapp` for raw captures and hardened persistent data.

## Data Flow

1. Manual pages prove the concepts against stored data.
2. Playwright automations search Paymentsense, open relevant records, and save raw extracted payloads.
3. A hardening step normalizes useful fields into `paymentsense_core`.
4. Matching logic creates `match_candidates`.
5. The UI reviews, confirms, rejects, or enriches those candidates.

## Database Schemas

- `paymentsense_raw` stores search runs and extracted records with source payloads.
- `paymentsense_core` stores durable organisations, prospects, customers, contacts, addresses, references, and match candidates.

The core schema is expected to evolve as we learn more fields from the Paymentsense pages.

## Local Development

Set `DATABASE_URL` before starting the API. Keep credentials out of committed files.

```powershell
$env:DATABASE_URL="Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=..."
npm run api:dev
npm run web:dev
```
