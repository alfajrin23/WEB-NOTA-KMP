create table if not exists runner_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index if not exists runner_tokens_active_idx on runner_tokens(active);
create index if not exists runner_tokens_expires_at_idx on runner_tokens(expires_at);
create index if not exists runner_tokens_last_used_at_idx on runner_tokens(last_used_at desc);

alter table runner_tokens enable row level security;

notify pgrst, 'reload schema';
