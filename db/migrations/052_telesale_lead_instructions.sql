create table if not exists paymentsense_core.telesale_lead_instructions (
  id bigserial primary key,
  campaign_wave_id bigint not null references paymentsense_core.campaign_waves(id) on delete cascade,
  lead_id bigint not null references paymentsense_core.leads(id) on delete cascade,
  instruction_text text not null,
  priority text not null default 'medium' check (priority in ('very_low', 'low', 'medium', 'high', 'urgent')),
  created_by_user_id bigint null references paymentsense_core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz null,
  acknowledged_by_user_id bigint null references paymentsense_core.users(id) on delete set null
);

create index if not exists idx_telesale_lead_instructions_wave_lead
  on paymentsense_core.telesale_lead_instructions (campaign_wave_id, lead_id, created_at desc, id desc);

create index if not exists idx_telesale_lead_instructions_unacknowledged
  on paymentsense_core.telesale_lead_instructions (campaign_wave_id, lead_id)
  where acknowledged_at is null;
