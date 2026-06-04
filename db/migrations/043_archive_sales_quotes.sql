alter table paymentsense_core.sales_quotes
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_user_id bigint references paymentsense_core.users(id) on delete set null;

create index if not exists idx_sales_quotes_is_archived
  on paymentsense_core.sales_quotes (is_archived, last_status_change_at desc nulls last);
