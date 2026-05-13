create table if not exists paymentsense_core.activity_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  entity_type text not null,
  entity_id bigint null,
  actor_user_id bigint null references paymentsense_core.users(id) on delete set null,
  actor_name_snapshot text null,
  title text not null,
  description text not null,
  is_notifiable boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_activity_events_created_at
  on paymentsense_core.activity_events (created_at desc, id desc);

create index if not exists ix_activity_events_entity
  on paymentsense_core.activity_events (entity_type, entity_id, created_at desc);
