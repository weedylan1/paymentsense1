create table if not exists paymentsense_core.customer_business_type_links (
  id bigserial primary key,
  customer_id bigint not null references paymentsense_core.customers(id) on delete cascade,
  business_type_id bigint null references paymentsense_core.business_types(id) on delete cascade,
  sic_code text null references paymentsense_core.company_sic_codes(code) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_customer_business_type_links_exactly_one_reference
    check (((business_type_id is not null)::int + (sic_code is not null)::int) = 1)
);

create unique index if not exists uq_customer_business_type_links_business_type
  on paymentsense_core.customer_business_type_links (customer_id, business_type_id)
  where business_type_id is not null;

create unique index if not exists uq_customer_business_type_links_sic_code
  on paymentsense_core.customer_business_type_links (customer_id, sic_code)
  where sic_code is not null;

create index if not exists ix_customer_business_type_links_customer_id
  on paymentsense_core.customer_business_type_links (customer_id);
