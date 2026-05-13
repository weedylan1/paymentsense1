create table if not exists paymentsense_core.customer_geography_maps (
  id bigserial primary key,
  name text not null,
  customer_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
