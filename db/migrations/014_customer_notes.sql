create table if not exists paymentsense_core.customer_notes (
  id bigserial primary key,
  customer_id bigint not null references paymentsense_core.customers (id) on delete cascade,
  note_text text not null,
  created_by_user_id bigint null references paymentsense_core.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ix_customer_notes_customer_id_created_at
  on paymentsense_core.customer_notes (customer_id, created_at desc, id desc);
