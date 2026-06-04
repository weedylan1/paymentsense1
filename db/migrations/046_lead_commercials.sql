create table if not exists paymentsense_core.lead_commercials (
  lead_id bigint primary key references paymentsense_core.leads(id) on delete cascade,
  credit_card_value numeric(18,2),
  value_period text check (value_period in ('monthly', 'yearly')),
  current_charge_percent numeric(9,4),
  proposed_charge_percent numeric(9,4),
  customer_value_type_id bigint references paymentsense_core.customer_value_types(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
