alter table paymentsense_core.users
  add column if not exists user_type text null,
  add column if not exists password_hash text null;

alter table paymentsense_core.users
  drop constraint if exists users_user_type_check;

alter table paymentsense_core.users
  add constraint users_user_type_check
  check (user_type is null or user_type in ('External', 'Telesale'));
