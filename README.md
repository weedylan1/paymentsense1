# Website Automation Playwright

A small Playwright workspace for testing and automating a website.

## Setup

```powershell
npm install
npx playwright install
```

Copy `.env.example` to `.env` and change `TARGET_URL` to the site you want to automate.

## Commands

```powershell
npm test
npm run test:headed
npm run test:ui
npm run auth:paymentsense
npm run test:paymentsense
npm run test:paymentsense-search
npm run automation:demo
npm run automation:jsonquiky
npm run automation:paymentsense-search
```

## Where To Build

- Put test coverage in `tests/`.
- Put reusable automation scripts in `scripts/`.
- Use `TARGET_URL` for the site under automation so the same scripts can run against staging, production, or local environments.
- The React manual testing UI lives in `apps/web`.
- The .NET service layer lives in `apps/api`.
- The Postgres migrations live in `db/migrations`.

## Match Lab App

Start the API with a local `DATABASE_URL` environment variable:

```powershell
$env:DATABASE_URL="Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=..."
npm run api:dev
```

Start the React app:

```powershell
npm run web:dev
```

The UI includes a `Seed Example` action that inserts a sample prospect/customer match into the persistent schema for manual testing.

## Database Migrations

Schema changes are stored as forward-only SQL files in `db/migrations`. Do not edit migrations that have already shipped; add a new numbered file instead.

Before a production upgrade, take a database backup. Then run the migrator in plan mode:

```powershell
$env:DATABASE_URL="Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=..."
npm run db:migrate:plan
```

For an existing database that already has the current schema, run the baseline command once. This creates migration history and marks the current migration files as applied, but it does not execute the migration SQL:

```powershell
npm run db:migrate:baseline
```

After the database has been baselined, future releases can apply only new migration files:

```powershell
npm run db:migrate
```

If the plan shows unexpected pending migrations on an existing database, stop and investigate before running `db:migrate`.

## JSON Quiky Automation

`tests/jsonquiky.spec.ts` opens `https://jester.click/jsonquiky/`, imports fixture JSON, checks Grid mode, edits the JSON in Raw mode, verifies Form mode, and confirms Export downloads a JSON file.

`npm run automation:jsonquiky` runs the same workflow as a standalone script and saves the exported JSON to `automation-output/jsonquiky-export.json`.

## Paymentsense Search

Run `npm run auth:paymentsense` to open a headed browser and sign in manually. After sign-in completes, Playwright saves the browser session to `playwright/.auth/paymentsense.json`.

Run `npm run test:paymentsense` to reuse that saved session and verify the search app opens without returning to the sign-in landing page.

Set `PAYMENTSENSE_SEARCH_TERM` in `.env` to drive a search without hardcoding sensitive data. Then run `npm run automation:paymentsense-search`; it enters the term and reports row counts without printing result contents.
