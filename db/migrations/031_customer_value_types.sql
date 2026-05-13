create table if not exists paymentsense_core.customer_value_types (
  id bigint generated always as identity primary key,
  shield_order int not null unique check (shield_order between 1 and 5),
  shield_key text not null unique,
  image_file_name text not null,
  label text,
  decimal_value numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into paymentsense_core.customer_value_types (shield_order, shield_key, image_file_name, label, decimal_value)
values
  (1, 'bronze', 'shield_1_bronze.png', 'Bronze', 0.00),
  (2, 'silver', 'shield_2_silver.png', 'Silver', 0.00),
  (3, 'gold', 'shield_3_gold.png', 'Gold', 0.00),
  (4, 'platinum', 'shield_4_platinum.png', 'Platinum', 0.00),
  (5, 'blue', 'shield_5_blue.png', 'Blue', 0.00)
on conflict (shield_order) do update
set
  shield_key = excluded.shield_key,
  image_file_name = excluded.image_file_name,
  updated_at = now();

alter table paymentsense_core.customers
  add column if not exists customer_value_type_id bigint references paymentsense_core.customer_value_types(id);

create index if not exists ix_customers_customer_value_type_id
  on paymentsense_core.customers (customer_value_type_id);
