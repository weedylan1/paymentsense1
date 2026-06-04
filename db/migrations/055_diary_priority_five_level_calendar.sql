alter table paymentsense_core.diary_entries
  drop constraint if exists diary_entries_priority_check;

alter table paymentsense_core.diary_entries
  add constraint diary_entries_priority_check
  check (priority in ('very_low', 'low', 'normal', 'medium', 'high', 'urgent'));
