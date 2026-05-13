create table if not exists paymentsense_core.customer_ai_company_insights (
  customer_id bigint not null references paymentsense_core.customers(id) on delete cascade,
  ai_company_insight_id bigint not null references paymentsense_core.ai_company_insights(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_id, ai_company_insight_id)
);

create index if not exists ix_customer_ai_company_insights_customer_id_updated_at
  on paymentsense_core.customer_ai_company_insights (customer_id, updated_at desc);

create index if not exists ix_customer_ai_company_insights_ai_company_insight_id
  on paymentsense_core.customer_ai_company_insights (ai_company_insight_id);
