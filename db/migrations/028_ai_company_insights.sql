create table if not exists paymentsense_core.app_settings (
  setting_key text primary key,
  value_text text null,
  updated_at timestamptz not null default now()
);

create table if not exists paymentsense_core.ai_company_insights (
  id bigserial primary key,
  search_name text not null,
  search_location text null,
  company_name text not null,
  company_number text not null,
  status text null,
  insight_json jsonb not null,
  created_by_user_id bigint null references paymentsense_core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_ai_company_insights_company_number unique (company_number)
);

create index if not exists ix_ai_company_insights_company_name
  on paymentsense_core.ai_company_insights (company_name);

create index if not exists ix_ai_company_insights_status
  on paymentsense_core.ai_company_insights (status);

create index if not exists ix_ai_company_insights_created_at
  on paymentsense_core.ai_company_insights (created_at desc);

create index if not exists ix_ai_company_insights_insight_json
  on paymentsense_core.ai_company_insights using gin (insight_json);
