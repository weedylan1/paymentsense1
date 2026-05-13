create table if not exists paymentsense_core.lead_statuses (
  id bigserial primary key,
  name text not null,
  normalized_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_lead_statuses_normalized_name unique (normalized_name)
);

insert into paymentsense_core.lead_statuses (name, normalized_name, sort_order)
values
  ('GDPR', 'gdpr', 10),
  ('open', 'open', 20),
  ('contacted', 'contacted', 30),
  ('qualified', 'qualified', 40),
  ('unqualified', 'unqualified', 50),
  ('closed', 'closed', 60)
on conflict (normalized_name) do nothing;
