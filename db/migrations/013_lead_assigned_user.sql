alter table paymentsense_core.leads
  add column if not exists assigned_user_id bigint null
  references paymentsense_core.users (id) on delete set null;

create index if not exists ix_leads_assigned_user_id
  on paymentsense_core.leads (assigned_user_id);
