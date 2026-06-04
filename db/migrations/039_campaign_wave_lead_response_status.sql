alter table paymentsense_core.campaign_wave_leads
  add column if not exists response_status text;

create index if not exists idx_campaign_wave_leads_response_status
  on paymentsense_core.campaign_wave_leads(response_status);
