alter table paymentsense_core.lead_contact_history
  add column if not exists reason text;

alter table paymentsense_core.lead_contact_history
  add column if not exists who_by text;

alter table paymentsense_core.lead_contact_history
  add column if not exists response_status text;
