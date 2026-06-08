create table if not exists paymentsense_core.user_dashboard_telesales_settings (
  user_id bigint primary key references paymentsense_core.users(id) on delete cascade,
  visible_kinds text[] not null default array[
    'instruction_started',
    'instruction_added',
    'instruction_reply',
    'interaction',
    'state_update',
    'follow_up'
  ]::text[],
  updated_at timestamptz not null default now()
);
