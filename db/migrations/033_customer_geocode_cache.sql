create table if not exists paymentsense_core.customer_geocode_cache (
  customer_id bigint primary key references paymentsense_core.customers(id) on delete cascade,
  address_key text not null,
  query_text text not null,
  latitude double precision,
  longitude double precision,
  accuracy text not null default 'unknown',
  status text not null default 'pending',
  provider text not null default 'nominatim',
  error_text text,
  looked_up_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_geocode_cache_address_key
  on paymentsense_core.customer_geocode_cache(address_key);
