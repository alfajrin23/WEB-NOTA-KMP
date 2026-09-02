create table if not exists belanja_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'pending',
  dry_run boolean not null default true,
  total_items integer not null default 0,
  success_items integer not null default 0,
  failed_items integer not null default 0,
  skipped_items integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists belanja_sync_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references belanja_sync_jobs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  source_resume_item_id uuid not null references resume_items(id) on delete cascade,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  target_reference text,
  payload_json jsonb not null default '{}'::jsonb,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists belanja_runner_heartbeats (
  runner_id text primary key,
  status text not null default 'ready',
  target_status text not null default 'unknown',
  dry_run boolean not null default true,
  target_base_url text,
  message text,
  metadata_json jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  alter table belanja_sync_jobs
    add constraint belanja_sync_jobs_status_check
    check (status in ('pending', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table belanja_sync_items
    add constraint belanja_sync_items_status_check
    check (status in ('pending', 'processing', 'success', 'failed', 'skipped', 'needs_review'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table belanja_runner_heartbeats
    add constraint belanja_runner_heartbeats_status_check
    check (status in ('ready', 'busy', 'paused', 'error'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table belanja_runner_heartbeats
    add constraint belanja_runner_heartbeats_target_status_check
    check (target_status in ('unknown', 'connected', 'disconnected'));
exception
  when duplicate_object then null;
end $$;

create unique index if not exists belanja_sync_items_job_source_idx
  on belanja_sync_items(job_id, source_resume_item_id);

create unique index if not exists belanja_sync_items_active_once_idx
  on belanja_sync_items(project_id, source_resume_item_id)
  where status in ('pending', 'processing', 'needs_review');

create index if not exists belanja_sync_jobs_project_idx on belanja_sync_jobs(project_id);
create index if not exists belanja_sync_jobs_status_idx on belanja_sync_jobs(status);
create index if not exists belanja_sync_items_project_idx on belanja_sync_items(project_id);
create index if not exists belanja_sync_items_job_idx on belanja_sync_items(job_id);
create index if not exists belanja_sync_items_status_idx on belanja_sync_items(status);
create index if not exists belanja_sync_items_source_resume_item_idx on belanja_sync_items(source_resume_item_id);
create index if not exists belanja_runner_heartbeats_last_seen_idx on belanja_runner_heartbeats(last_seen_at desc);

drop trigger if exists belanja_sync_jobs_set_updated_at on belanja_sync_jobs;
create trigger belanja_sync_jobs_set_updated_at
before update on belanja_sync_jobs
for each row execute function set_updated_at();

drop trigger if exists belanja_sync_items_set_updated_at on belanja_sync_items;
create trigger belanja_sync_items_set_updated_at
before update on belanja_sync_items
for each row execute function set_updated_at();

drop trigger if exists belanja_runner_heartbeats_set_updated_at on belanja_runner_heartbeats;
create trigger belanja_runner_heartbeats_set_updated_at
before update on belanja_runner_heartbeats
for each row execute function set_updated_at();

alter table belanja_sync_jobs enable row level security;
alter table belanja_sync_items enable row level security;
alter table belanja_runner_heartbeats enable row level security;

notify pgrst, 'reload schema';
