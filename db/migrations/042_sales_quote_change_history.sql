alter table paymentsense_core.sales_quotes
  add column if not exists latest_change_at timestamptz,
  add column if not exists latest_change_search_run_id bigint references paymentsense_raw.search_runs(id) on delete set null,
  add column if not exists latest_change_summary text,
  add column if not exists latest_change_field_count integer not null default 0;

create index if not exists idx_sales_quotes_latest_change_at
  on paymentsense_core.sales_quotes (latest_change_at desc nulls last);

create table if not exists paymentsense_core.sales_quote_change_history (
  id bigint generated always as identity primary key,
  quote_id text not null references paymentsense_core.sales_quotes(quote_id) on delete cascade,
  search_run_id bigint references paymentsense_raw.search_runs(id) on delete set null,
  changed_at timestamptz not null default now(),
  change_source text not null,
  field_names text[] not null,
  previous_values jsonb not null,
  new_values jsonb not null
);

create index if not exists idx_sales_quote_change_history_quote_changed
  on paymentsense_core.sales_quote_change_history (quote_id, changed_at desc);

create index if not exists idx_sales_quote_change_history_search_run
  on paymentsense_core.sales_quote_change_history (search_run_id);
