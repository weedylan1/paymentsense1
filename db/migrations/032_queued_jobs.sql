create table if not exists paymentsense_core.queued_jobs (
  id bigserial primary key,
  job_type text not null,
  display_name text not null,
  status text not null default 'pending',
  payload_json jsonb not null,
  result_json jsonb,
  requested_by_user_id bigint references paymentsense_core.users(id) on delete set null,
  scheduled_for timestamptz not null default now(),
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_heartbeat_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  cancel_requested boolean not null default false,
  current_step text,
  error_text text,
  removed_at timestamptz,
  removed_by_user_id bigint references paymentsense_core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint queued_jobs_status_check check (
    status in (
      'pending',
      'queued',
      'running',
      'completed',
      'failed',
      'cancel_requested',
      'cancelled'
    )
  )
);

create index if not exists queued_jobs_status_idx
  on paymentsense_core.queued_jobs (status, removed_at, scheduled_for);

create index if not exists queued_jobs_requested_by_idx
  on paymentsense_core.queued_jobs (requested_by_user_id, created_at desc);

create table if not exists paymentsense_core.job_outbox (
  id bigserial primary key,
  job_id bigint not null references paymentsense_core.queued_jobs(id) on delete cascade,
  event_type text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists job_outbox_enqueue_unique_idx
  on paymentsense_core.job_outbox (job_id, event_type)
  where event_type = 'enqueue' and published_at is null;

create index if not exists job_outbox_published_idx
  on paymentsense_core.job_outbox (published_at, created_at);
