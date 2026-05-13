create table if not exists paymentsense_core.dashboard_statistics_snapshots (
  id bigserial primary key,
  calculated_at timestamptz not null default now(),
  snapshot_json jsonb not null
);

create index if not exists ix_dashboard_statistics_snapshots_calculated_at
  on paymentsense_core.dashboard_statistics_snapshots (calculated_at desc);
