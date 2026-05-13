create table if not exists paymentsense_core.lead_notes (
  id bigint generated always as identity primary key,
  lead_id bigint not null references paymentsense_core.leads(id) on delete cascade,
  user_id bigint references paymentsense_core.users(id) on delete set null,
  note_text text not null,
  noted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_core_lead_notes_lead
  on paymentsense_core.lead_notes (lead_id, noted_at desc, id desc);
