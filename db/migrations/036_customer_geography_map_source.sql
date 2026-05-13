alter table paymentsense_core.customer_geography_maps
  add column if not exists map_source text not null default 'customers',
  add column if not exists lead_ids bigint[] not null default '{}';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_geography_maps_map_source_check'
  ) then
    alter table paymentsense_core.customer_geography_maps
      add constraint customer_geography_maps_map_source_check
      check (map_source in ('customers', 'leads'));
  end if;
end $$;

update paymentsense_core.customer_geography_maps maps
set
  map_source = 'leads',
  lead_ids = coalesce((
    select array_agg(leads.id order by leads.id)
    from paymentsense_core.leads leads
    where leads.customer_id = any(maps.customer_ids)
  ), '{}')
where maps.map_source = 'customers'
  and lower(maps.name) like '%lead%';
