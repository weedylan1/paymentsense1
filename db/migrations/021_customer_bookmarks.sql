create table if not exists paymentsense_core.customer_bookmarks (
  user_id bigint not null references paymentsense_core.users (id) on delete cascade,
  customer_id bigint not null references paymentsense_core.customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, customer_id)
);

create index if not exists ix_customer_bookmarks_customer_id
  on paymentsense_core.customer_bookmarks (customer_id);
