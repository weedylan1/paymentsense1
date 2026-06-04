create table if not exists paymentsense_core.response_statuses (
  id bigserial primary key,
  name text not null,
  normalized_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_response_statuses_normalized_name unique (normalized_name)
);

insert into paymentsense_core.response_statuses (name, normalized_name, sort_order)
values
  ('Suppressed', 'suppressed', 10),
  ('Scheduled', 'scheduled', 20),
  ('Sent', 'sent', 30),
  ('Called', 'called', 40),
  ('Visited', 'visited', 50),
  ('Responded', 'responded', 60),
  ('Interested', 'interested', 70),
  ('Converted', 'converted', 80),
  ('Not interested', 'not interested', 90),
  ('Failed', 'failed', 100),
  ('Removed', 'removed', 110),
  ('Dead Lead', 'dead lead', 120)
on conflict (normalized_name) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    updated_at = now();
