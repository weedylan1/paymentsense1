create table if not exists paymentsense_core.telesale_wave_exports (
  id bigserial primary key,
  campaign_wave_id bigint not null references paymentsense_core.campaign_waves(id) on delete cascade,
  export_json text not null,
  sent_by_user_id bigint null references paymentsense_core.users(id) on delete set null,
  lead_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_telesale_wave_exports_wave_created
  on paymentsense_core.telesale_wave_exports (campaign_wave_id, created_at desc);

create table if not exists paymentsense_core.telesale_wave_export_users (
  export_id bigint not null references paymentsense_core.telesale_wave_exports(id) on delete cascade,
  user_id bigint not null references paymentsense_core.users(id) on delete cascade,
  primary key (export_id, user_id)
);

create index if not exists idx_telesale_wave_export_users_user
  on paymentsense_core.telesale_wave_export_users (user_id);
