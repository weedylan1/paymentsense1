insert into paymentsense_core.diary_entry_types (name, code, description, can_schedule_job, default_job_type, sort_order)
values
  ('Calendar item', 'calendar_item', 'Calendar booking or scheduled activity.', false, null, 15)
on conflict (code) do nothing;

create table if not exists paymentsense_core.diary_entry_calendar_users (
  diary_entry_id bigint not null references paymentsense_core.diary_entries(id) on delete cascade,
  user_id bigint not null references paymentsense_core.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (diary_entry_id, user_id)
);

insert into paymentsense_core.diary_entry_calendar_users (diary_entry_id, user_id)
select de.id, de.owner_user_id
from paymentsense_core.diary_entries de
where de.scope = 'user'
  and de.owner_user_id is not null
on conflict do nothing;

create index if not exists ix_diary_entry_calendar_users_user
  on paymentsense_core.diary_entry_calendar_users (user_id, diary_entry_id);

create index if not exists ix_diary_entries_calendar_range
  on paymentsense_core.diary_entries (scope, starts_at, due_at, id)
  where starts_at is not null or due_at is not null;
