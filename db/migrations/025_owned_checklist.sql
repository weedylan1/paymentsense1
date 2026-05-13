create table if not exists paymentsense_core.owned_checklist (
  id bigserial primary key,
  business_name text not null,
  normalized_business_name text not null,
  contact_name text null,
  normalized_contact_name text null,
  contact_email text null,
  normalized_contact_email text null,
  owner_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days')
);

create index if not exists ix_owned_checklist_expires_at
  on paymentsense_core.owned_checklist (expires_at);

create index if not exists ix_owned_checklist_normalized_business_name
  on paymentsense_core.owned_checklist (normalized_business_name);

create index if not exists ix_owned_checklist_normalized_contact_email
  on paymentsense_core.owned_checklist (normalized_contact_email);

create index if not exists ix_owned_checklist_normalized_contact_name
  on paymentsense_core.owned_checklist (normalized_contact_name);
