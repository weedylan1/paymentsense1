create table if not exists paymentsense_core.customer_activity_statuses (
  id bigserial primary key,
  name text not null,
  normalized_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_customer_activity_statuses_normalized_name unique (normalized_name)
);

insert into paymentsense_core.customer_activity_statuses (name, normalized_name, sort_order)
values
  ('Active', 'active', 10),
  ('Not Active', 'not active', 20),
  ('Quarantined', 'quarantined', 30)
on conflict (normalized_name) do nothing;

alter table paymentsense_core.customers
  add column if not exists customer_activity_status_id bigint null
  references paymentsense_core.customer_activity_statuses(id) on delete set null;

update paymentsense_core.customers
set customer_activity_status_id = (
  select id
  from paymentsense_core.customer_activity_statuses
  where normalized_name = 'active'
  limit 1
)
where customer_activity_status_id is null;

create index if not exists ix_customers_customer_activity_status_id
  on paymentsense_core.customers (customer_activity_status_id);
