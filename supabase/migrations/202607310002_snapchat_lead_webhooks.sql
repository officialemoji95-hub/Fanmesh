create table if not exists public.provider_webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check (platform in ('snapchat')),
  external_form_id text not null,
  external_account_id text,
  integration_id text not null,
  path_key text not null unique,
  encrypted_secret text not null,
  consented_channels text[] not null default '{}',
  status text not null check (status in ('active', 'paused', 'revoked')) default 'active',
  received_count bigint not null default 0,
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_form_id)
);

create table if not exists public.provider_lead_events (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.provider_webhooks(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fan_id uuid references public.fans(id) on delete set null,
  external_lead_id text not null,
  status text not null check (status in ('processing', 'completed', 'invalid', 'failed')),
  metadata jsonb not null default '{}',
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (webhook_id, external_lead_id)
);

create index if not exists provider_webhooks_workspace_idx
  on public.provider_webhooks (workspace_id, platform, status);
create index if not exists provider_lead_events_workspace_received_idx
  on public.provider_lead_events (workspace_id, received_at desc);

alter table public.provider_webhooks enable row level security;
alter table public.provider_lead_events enable row level security;

create policy "provider_webhooks_member_all" on public.provider_webhooks
  for all using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy "provider_lead_events_member_select" on public.provider_lead_events
  for select using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.provider_webhooks to authenticated;
grant select on public.provider_lead_events to authenticated;
revoke all on public.provider_webhooks from anon;
revoke all on public.provider_lead_events from anon;
