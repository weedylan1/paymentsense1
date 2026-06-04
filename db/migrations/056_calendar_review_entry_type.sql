insert into paymentsense_core.calendar_entry_types (
  label,
  normalized_label,
  should_notify_user,
  priority,
  overdue_priority,
  sort_order
)
values ('Review', 'review', true, 'medium', 'high', 50)
on conflict (normalized_label) do update
set
  label = excluded.label,
  should_notify_user = true,
  is_active = true,
  updated_at = now();
