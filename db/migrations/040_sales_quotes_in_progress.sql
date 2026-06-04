alter table paymentsense_raw.extracted_records
  drop constraint if exists extracted_records_record_type_check;

alter table paymentsense_raw.extracted_records
  add constraint extracted_records_record_type_check
  check (record_type in (
    'prospect',
    'lead',
    'customer',
    'paymentsense_customer',
    'prospect_detail',
    'sales_quote',
    'sales_quote_prospect_detail'
  ));

create table if not exists paymentsense_core.sales_quotes (
  id bigint generated always as identity primary key,
  quote_id text not null unique,
  prospect_id text not null,
  business_name text,
  normalized_business_name text,
  primary_contact_first_name text,
  primary_contact_last_name text,
  primary_contact_name text,
  status text not null,
  owner_name text,
  is_completed boolean,
  ltv numeric(18,4),
  commission_base numeric(18,4),
  commission numeric(18,4),
  ltv_currency_code text,
  commission_currency_code text,
  underwriting_case_status text,
  quote_created_at timestamptz,
  last_status_change_at timestamptz,
  quote_url text,
  prospect_url text,
  raw_record_id bigint references paymentsense_raw.extracted_records(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_quotes_prospect_id
  on paymentsense_core.sales_quotes (prospect_id);

create index if not exists idx_sales_quotes_status_last_change
  on paymentsense_core.sales_quotes (status, last_status_change_at desc);

create index if not exists idx_sales_quotes_business_name
  on paymentsense_core.sales_quotes (normalized_business_name);

create table if not exists paymentsense_core.sales_quote_prospect_details (
  id bigint generated always as identity primary key,
  prospect_id text not null unique,
  business_name text,
  normalized_business_name text,
  channel text,
  origin text,
  created_on date,
  owner_name text,
  has_paymentsense_customer_match boolean,
  address_line1 text,
  address_line2 text,
  town text,
  county text,
  postcode text,
  normalized_postcode text,
  country text,
  contact_name text,
  normalized_contact_name text,
  contact_phone text,
  normalized_contact_phone text,
  contact_email text,
  normalized_contact_email text,
  source_url text,
  raw_record_id bigint references paymentsense_raw.extracted_records(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_quote_prospect_details_postcode
  on paymentsense_core.sales_quote_prospect_details (normalized_postcode);

create index if not exists idx_sales_quote_prospect_details_business_name
  on paymentsense_core.sales_quote_prospect_details (normalized_business_name);
