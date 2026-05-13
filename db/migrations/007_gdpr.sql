create table if not exists paymentsense_core.gdpr (
  id bigserial primary key,
  email_address text,
  normalized_email text,
  name text,
  normalized_name text,
  address text,
  normalized_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gdpr_normalized_email
  on paymentsense_core.gdpr (normalized_email)
  where normalized_email is not null;

create index if not exists idx_gdpr_normalized_name
  on paymentsense_core.gdpr (normalized_name)
  where normalized_name is not null;

create index if not exists idx_gdpr_normalized_address
  on paymentsense_core.gdpr (normalized_address)
  where normalized_address is not null;
