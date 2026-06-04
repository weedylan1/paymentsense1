alter table paymentsense_core.leads
  drop constraint if exists leads_source_shape_check;

alter table paymentsense_core.leads
  add constraint leads_source_shape_check
  check (
    (source_type = 'customer' and customer_id is not null)
    or
    (source_type = 'quote' and source_quote_id is not null)
    or
    (source_type = 'prospect' and primary_prospect_id is not null)
  );

create unique index if not exists ux_leads_primary_prospect_source
  on paymentsense_core.leads (primary_prospect_id)
  where source_type = 'prospect' and primary_prospect_id is not null;
