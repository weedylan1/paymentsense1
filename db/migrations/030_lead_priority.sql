alter table paymentsense_core.leads
  add column if not exists lead_priority text not null default 'medium';

update paymentsense_core.leads
set lead_priority = 'medium'
where lead_priority is null
   or lead_priority not in ('very_low', 'low', 'medium', 'high', 'urgent');

alter table paymentsense_core.leads
  drop constraint if exists chk_leads_priority;

alter table paymentsense_core.leads
  add constraint chk_leads_priority
  check (lead_priority in ('very_low', 'low', 'medium', 'high', 'urgent'));
