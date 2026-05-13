create table if not exists paymentsense_core.campaigns (
  id bigserial primary key,
  name text not null,
  description text,
  objective text,
  start_date date,
  end_date date,
  target_audience text,
  budget numeric(12,2),
  product_service text,
  status text not null default 'Draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists paymentsense_core.campaign_waves (
  id bigserial primary key,
  campaign_id bigint not null references paymentsense_core.campaigns(id) on delete cascade,
  name text not null,
  wave_number integer not null,
  channel text not null,
  scheduled_date date,
  status text not null default 'Planned',
  assigned_team_or_user text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaigns_status on paymentsense_core.campaigns(status);
create index if not exists idx_campaign_waves_campaign_id on paymentsense_core.campaign_waves(campaign_id, wave_number);
