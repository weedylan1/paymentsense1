create table if not exists paymentsense_core.users (
  id bigserial primary key,
  full_name text not null,
  initials text not null,
  phone text null,
  email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_users_full_name
  on paymentsense_core.users (full_name);
