create table if not exists paymentsense_raw.prospect_search_cache (
  id bigserial primary key,
  query_text text not null,
  normalized_query text not null,
  search_url text not null,
  rows_json jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists ux_prospect_search_cache_normalized_query
  on paymentsense_raw.prospect_search_cache (normalized_query);

create index if not exists ix_prospect_search_cache_expires_at
  on paymentsense_raw.prospect_search_cache (expires_at);
