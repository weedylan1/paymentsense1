create table if not exists paymentsense_core.telesale_lead_instruction_replies (
  id bigserial primary key,
  instruction_id bigint not null references paymentsense_core.telesale_lead_instructions(id) on delete cascade,
  reply_text text not null,
  created_by_user_id bigint null references paymentsense_core.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_telesale_lead_instruction_replies_instruction
  on paymentsense_core.telesale_lead_instruction_replies (instruction_id, created_at, id);
