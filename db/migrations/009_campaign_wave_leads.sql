create table if not exists paymentsense_core.campaign_wave_leads (
  id bigserial primary key,
  campaign_wave_id bigint not null references paymentsense_core.campaign_waves(id) on delete cascade,
  lead_id bigint not null references paymentsense_core.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (campaign_wave_id, lead_id)
);

create index if not exists idx_campaign_wave_leads_wave_id
  on paymentsense_core.campaign_wave_leads(campaign_wave_id);

create index if not exists idx_campaign_wave_leads_lead_id
  on paymentsense_core.campaign_wave_leads(lead_id);
