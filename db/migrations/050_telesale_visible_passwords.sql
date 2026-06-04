alter table paymentsense_core.users
  add column if not exists telesale_password text null;

update paymentsense_core.users
set telesale_password = 'makemoney99$'
where user_type = 'Telesale'
  and username = 'Teletest'
  and telesale_password is null;
