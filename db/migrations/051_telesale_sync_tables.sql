create table if not exists paymentsense_core.telesale_lead_states (
  export_id bigint not null references paymentsense_core.telesale_wave_exports(id) on delete cascade,
  lead_id bigint not null,
  telesale_user_id bigint not null references paymentsense_core.users(id) on delete cascade,
  priority text null,
  status text null,
  response_status text null,
  notes text null,
  is_interaction_complete boolean not null default false,
  completion_reason text null,
  updated_at timestamptz not null default now(),
  primary key (export_id, lead_id, telesale_user_id)
);

create index if not exists idx_telesale_lead_states_user_export
  on paymentsense_core.telesale_lead_states (telesale_user_id, export_id);

create table if not exists paymentsense_core.telesale_interactions (
  id bigserial primary key,
  export_id bigint not null references paymentsense_core.telesale_wave_exports(id) on delete cascade,
  lead_id bigint not null,
  telesale_user_id bigint not null references paymentsense_core.users(id) on delete cascade,
  client_interaction_id bigint null,
  interaction_type text not null,
  outcome text null,
  notes text null,
  interacted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (export_id, lead_id, telesale_user_id, client_interaction_id)
);

create index if not exists idx_telesale_interactions_user_export_lead
  on paymentsense_core.telesale_interactions (telesale_user_id, export_id, lead_id, interacted_at desc);

create table if not exists paymentsense_core.telesale_followups (
  id bigserial primary key,
  export_id bigint not null references paymentsense_core.telesale_wave_exports(id) on delete cascade,
  lead_id bigint not null,
  telesale_user_id bigint not null references paymentsense_core.users(id) on delete cascade,
  client_followup_id bigint null,
  scheduled_at timestamptz not null,
  notes text null,
  completed boolean not null default false,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (export_id, lead_id, telesale_user_id, client_followup_id)
);

create index if not exists idx_telesale_followups_user_export_lead
  on paymentsense_core.telesale_followups (telesale_user_id, export_id, lead_id, scheduled_at);

create index if not exists idx_telesale_followups_completion
  on paymentsense_core.telesale_followups (telesale_user_id, completed, scheduled_at);
