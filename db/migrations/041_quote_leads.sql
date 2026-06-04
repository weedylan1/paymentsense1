alter table paymentsense_core.sales_quotes
  add column if not exists is_bookmarked boolean not null default false;

alter table paymentsense_core.leads
  alter column customer_id drop not null;

alter table paymentsense_core.leads
  drop constraint if exists leads_customer_id_key;

create unique index if not exists ux_leads_customer_id_present
  on paymentsense_core.leads (customer_id)
  where customer_id is not null;

alter table paymentsense_core.leads
  add column if not exists source_type text not null default 'customer';

alter table paymentsense_core.leads
  add column if not exists created_from_quote boolean not null default false;

alter table paymentsense_core.leads
  add column if not exists source_quote_id text references paymentsense_core.sales_quotes(quote_id) on delete set null;

alter table paymentsense_core.leads
  drop constraint if exists leads_lead_status_check;

alter table paymentsense_core.leads
  add constraint leads_lead_status_check
  check (lead_status in ('open', 'contacted', 'qualified', 'unqualified', 'closed', 'quote'));

alter table paymentsense_core.leads
  drop constraint if exists leads_source_shape_check;

alter table paymentsense_core.leads
  add constraint leads_source_shape_check
  check (
    (source_type = 'customer' and customer_id is not null)
    or
    (source_type = 'quote' and source_quote_id is not null)
  );

create index if not exists idx_sales_quotes_is_bookmarked
  on paymentsense_core.sales_quotes (is_bookmarked)
  where is_bookmarked;

create index if not exists idx_leads_source_type
  on paymentsense_core.leads (source_type, created_at desc);

create unique index if not exists ux_leads_source_quote_id
  on paymentsense_core.leads (source_quote_id)
  where source_quote_id is not null;

insert into paymentsense_core.lead_statuses (name, normalized_name, sort_order)
values ('quote', 'quote', 25)
on conflict (normalized_name) do nothing;
