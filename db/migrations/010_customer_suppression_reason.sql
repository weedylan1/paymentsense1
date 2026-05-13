alter table paymentsense_core.customers
  add column if not exists suppression_reason text;
