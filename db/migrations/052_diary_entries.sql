create table if not exists paymentsense_core.diary_entry_types (
  id bigserial primary key,
  name text not null,
  code text not null,
  description text,
  can_schedule_job boolean not null default false,
  default_job_type text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diary_entry_types_code_unique unique (code),
  constraint diary_entry_types_code_check check (code = lower(code) and code ~ '^[a-z0-9_]+$'),
  constraint diary_entry_types_job_check check (
    can_schedule_job = false
    or nullif(btrim(default_job_type), '') is not null
  )
);

insert into paymentsense_core.diary_entry_types (name, code, description, can_schedule_job, default_job_type, sort_order)
values
  ('General note', 'general_note', 'General diary note or reminder.', false, null, 10),
  ('Call', 'call', 'Call activity or planned call.', false, null, 20),
  ('Meeting', 'meeting', 'Meeting activity or planned meeting.', false, null, 30),
  ('Follow-up', 'follow_up', 'Follow-up activity or reminder.', false, null, 40),
  ('Housekeeping job', 'housekeeping_job', 'Diary entry intended to schedule a housekeeping job.', true, 'housekeeping', 90)
on conflict (code) do nothing;

create table if not exists paymentsense_core.diary_entries (
  id bigserial primary key,
  entry_type_id bigint not null references paymentsense_core.diary_entry_types(id) on delete restrict,
  title text not null,
  description text,
  owner_user_id bigint null references paymentsense_core.users(id) on delete set null,
  created_by_user_id bigint null references paymentsense_core.users(id) on delete set null,
  updated_by_user_id bigint null references paymentsense_core.users(id) on delete set null,
  scope text not null default 'user',
  status text not null default 'open',
  starts_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  priority text not null default 'normal',
  trigger_type text,
  trigger_json jsonb not null default '{}'::jsonb,
  job_type text,
  job_payload_json jsonb not null default '{}'::jsonb,
  queued_job_id bigint null references paymentsense_core.queued_jobs(id) on delete set null,
  source_entity_type text,
  source_entity_id bigint,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diary_entries_scope_check check (scope in ('user', 'system')),
  constraint diary_entries_status_check check (status in ('open', 'scheduled', 'queued', 'running', 'completed', 'cancelled', 'failed')),
  constraint diary_entries_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint diary_entries_system_owner_check check (scope <> 'system' or owner_user_id is null),
  constraint diary_entries_user_owner_check check (scope <> 'user' or owner_user_id is not null),
  constraint diary_entries_job_payload_check check (
    queued_job_id is null
    or nullif(btrim(coalesce(job_type, '')), '') is not null
  )
);

create index if not exists ix_diary_entries_due
  on paymentsense_core.diary_entries (status, due_at, id)
  where status in ('open', 'scheduled');

create index if not exists ix_diary_entries_owner
  on paymentsense_core.diary_entries (owner_user_id, due_at desc, id desc);

create index if not exists ix_diary_entries_scope
  on paymentsense_core.diary_entries (scope, due_at desc, id desc);

create index if not exists ix_diary_entries_created
  on paymentsense_core.diary_entries (created_at desc, id desc);

create index if not exists ix_diary_entries_source
  on paymentsense_core.diary_entries (source_entity_type, source_entity_id, created_at desc)
  where source_entity_type is not null and source_entity_id is not null;

create index if not exists ix_diary_entries_queued_job
  on paymentsense_core.diary_entries (queued_job_id)
  where queued_job_id is not null;
