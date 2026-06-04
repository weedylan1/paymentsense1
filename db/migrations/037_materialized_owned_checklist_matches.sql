alter table paymentsense_core.customers
  add column if not exists has_owned_checklist_match boolean not null default false,
  add column if not exists owned_checklist_match_updated_at timestamptz;

create table if not exists paymentsense_core.customer_owned_checklist_matches (
  customer_id bigint not null references paymentsense_core.customers(id) on delete cascade,
  owned_checklist_id bigint not null references paymentsense_core.owned_checklist(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (customer_id, owned_checklist_id)
);

create index if not exists ix_customer_owned_checklist_matches_customer_id
  on paymentsense_core.customer_owned_checklist_matches (customer_id);

create index if not exists ix_customer_owned_checklist_matches_expires_at
  on paymentsense_core.customer_owned_checklist_matches (expires_at);

create index if not exists ix_contacts_organisation_normalized_email
  on paymentsense_core.contacts (organisation_id, normalized_email)
  where normalized_email is not null;

create index if not exists ix_contacts_organisation_normalized_name
  on paymentsense_core.contacts (organisation_id, normalized_name)
  where normalized_name is not null;

insert into paymentsense_core.customer_owned_checklist_matches (
  customer_id,
  owned_checklist_id,
  reason,
  expires_at
)
select
  c.id,
  oc.id,
  case
    when oc.normalized_contact_email is not null and exists (
      select 1
      from paymentsense_core.contacts ct
      where ct.organisation_id = o.id
        and ct.normalized_email = oc.normalized_contact_email
    ) then 'Matched contact email'
    when oc.normalized_business_name is not null
      and char_length(oc.normalized_business_name) >= 6
      and (
        oc.normalized_business_name = o.normalized_name
        or oc.normalized_business_name = c.normalized_trading_name
        or o.normalized_name like '%' || oc.normalized_business_name || '%'
        or oc.normalized_business_name like '%' || o.normalized_name || '%'
        or (
          c.normalized_trading_name is not null
          and (
            c.normalized_trading_name like '%' || oc.normalized_business_name || '%'
            or oc.normalized_business_name like '%' || c.normalized_trading_name || '%'
          )
        )
      ) then 'Matched business name'
    when oc.normalized_contact_name is not null and exists (
      select 1
      from paymentsense_core.contacts ct
      where ct.organisation_id = o.id
        and char_length(oc.normalized_contact_name) >= 6
        and ct.normalized_name is not null
        and (
          ct.normalized_name = oc.normalized_contact_name
          or ct.normalized_name like '%' || oc.normalized_contact_name || '%'
          or oc.normalized_contact_name like '%' || ct.normalized_name || '%'
        )
    ) then 'Matched contact name'
    else 'Possible fuzzy match'
  end,
  oc.expires_at
from paymentsense_core.customers c
join paymentsense_core.organisations o on o.id = c.organisation_id
join paymentsense_core.owned_checklist oc on oc.expires_at > now()
where (
  oc.normalized_contact_email is not null
  and exists (
    select 1
    from paymentsense_core.contacts ct
    where ct.organisation_id = o.id
      and ct.normalized_email = oc.normalized_contact_email
  )
)
or (
  oc.normalized_business_name is not null
  and char_length(oc.normalized_business_name) >= 6
  and (
    oc.normalized_business_name = o.normalized_name
    or oc.normalized_business_name = c.normalized_trading_name
    or o.normalized_name like '%' || oc.normalized_business_name || '%'
    or oc.normalized_business_name like '%' || o.normalized_name || '%'
    or (
      c.normalized_trading_name is not null
      and (
        c.normalized_trading_name like '%' || oc.normalized_business_name || '%'
        or oc.normalized_business_name like '%' || c.normalized_trading_name || '%'
      )
    )
  )
)
or (
  oc.normalized_contact_name is not null
  and char_length(oc.normalized_contact_name) >= 6
  and exists (
    select 1
    from paymentsense_core.contacts ct
    where ct.organisation_id = o.id
      and ct.normalized_name is not null
      and (
        ct.normalized_name = oc.normalized_contact_name
        or ct.normalized_name like '%' || oc.normalized_contact_name || '%'
        or oc.normalized_contact_name like '%' || ct.normalized_name || '%'
      )
  )
)
on conflict (customer_id, owned_checklist_id) do update
set reason = excluded.reason,
    expires_at = excluded.expires_at;

with current_flags as (
  select
    c.id,
    exists (
      select 1
      from paymentsense_core.customer_owned_checklist_matches match
      where match.customer_id = c.id
        and match.expires_at > now()
    ) as next_value
  from paymentsense_core.customers c
)
update paymentsense_core.customers c
set has_owned_checklist_match = current_flags.next_value,
    owned_checklist_match_updated_at = now()
from current_flags
where current_flags.id = c.id
  and c.has_owned_checklist_match is distinct from current_flags.next_value;
