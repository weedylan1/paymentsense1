create index if not exists ix_customer_business_type_links_business_type_id
  on paymentsense_core.customer_business_type_links (business_type_id)
  where business_type_id is not null;

create index if not exists ix_customer_business_type_links_sic_code
  on paymentsense_core.customer_business_type_links (sic_code)
  where sic_code is not null;
