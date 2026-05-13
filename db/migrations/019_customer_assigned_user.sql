alter table paymentsense_core.customers
  add column if not exists assigned_user_id bigint null
  references paymentsense_core.users (id) on delete set null;

create index if not exists ix_customers_assigned_user_id
  on paymentsense_core.customers (assigned_user_id);
