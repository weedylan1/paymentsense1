alter table paymentsense_core.users
  add column if not exists username text null;

update paymentsense_core.users
set username = regexp_replace(coalesce(nullif(initials, ''), full_name), '\s+', '', 'g')
where user_type = 'Telesale'
  and username is null;

create unique index if not exists idx_users_username_lower
  on paymentsense_core.users (lower(username))
  where username is not null;

alter table paymentsense_core.users
  drop constraint if exists users_telesale_username_required;

alter table paymentsense_core.users
  add constraint users_telesale_username_required
  check (
    user_type is distinct from 'Telesale'
    or (
      username is not null
      and username = btrim(username)
      and username !~ '\s'
      and username <> ''
    )
  );
