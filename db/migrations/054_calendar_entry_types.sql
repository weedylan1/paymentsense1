create table if not exists paymentsense_core.calendar_entry_types (
  id bigserial primary key,
  label text not null,
  normalized_label text not null,
  should_notify_user boolean not null default false,
  priority text not null default 'medium',
  overdue_priority text not null default 'high',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_entry_types_label_unique unique (normalized_label),
  constraint calendar_entry_types_priority_check check (priority in ('very_low', 'low', 'medium', 'high', 'urgent')),
  constraint calendar_entry_types_overdue_priority_check check (overdue_priority in ('very_low', 'low', 'medium', 'high', 'urgent'))
);

insert into paymentsense_core.calendar_entry_types (
  label,
  normalized_label,
  should_notify_user,
  priority,
  overdue_priority,
  sort_order
)
values
  ('General', 'general', false, 'medium', 'high', 10),
  ('Call', 'call', true, 'medium', 'high', 20),
  ('Meeting', 'meeting', true, 'high', 'urgent', 30),
  ('Follow-up', 'follow up', true, 'high', 'urgent', 40),
  ('System Activity', 'system activity', false, 'low', 'medium', 90)
on conflict (normalized_label) do nothing;

alter table paymentsense_core.diary_entries
  add column if not exists calendar_entry_type_id bigint null references paymentsense_core.calendar_entry_types(id) on delete set null;

create index if not exists ix_diary_entries_calendar_entry_type
  on paymentsense_core.diary_entries (calendar_entry_type_id)
  where calendar_entry_type_id is not null;

create index if not exists ix_calendar_entry_types_active_sort
  on paymentsense_core.calendar_entry_types (is_active, sort_order, label);
