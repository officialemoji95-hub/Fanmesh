create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Creator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'analyst')) default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.fans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_key text not null,
  display_name text,
  email text,
  phone text,
  location text,
  channels text[] not null default '{}',
  consented_channels text[] not null default '{}',
  metrics jsonb not null default '{}',
  source_provenance jsonb not null default '{}',
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, contact_key)
);

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fan_id uuid not null references public.fans(id) on delete cascade,
  channel text not null,
  purpose text not null default 'creator_updates',
  status text not null check (status in ('granted', 'withdrawn')),
  source text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.source_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null,
  status text not null check (status in ('not_connected', 'pending', 'connected', 'expired', 'revoked')) default 'not_connected',
  external_account_id text,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform)
);

create table if not exists public.audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  total_followers bigint not null default 0,
  average_views bigint not null default 0,
  identified_fans bigint not null default 0,
  direct_connections bigint not null default 0,
  connected_platforms integer not null default 0,
  captured_at timestamptz not null default now()
);

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  source text not null,
  received_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  status text not null check (status in ('previewed', 'processing', 'completed', 'failed')) default 'previewed',
  created_at timestamptz not null default now()
);

create table if not exists public.social_experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  external_key text not null,
  content_id text not null,
  objective text not null,
  status text not null check (status in ('draft', 'active', 'completed', 'cancelled')) default 'draft',
  plan jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_key)
);

create index if not exists fans_workspace_last_seen_idx on public.fans (workspace_id, last_seen desc);
create index if not exists consents_workspace_fan_idx on public.consents (workspace_id, fan_id);
create index if not exists audience_snapshots_workspace_captured_idx on public.audience_snapshots (workspace_id, captured_at desc);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = auth.uid()
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_id uuid;
  creator_name text;
begin
  creator_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Creator');
  insert into public.profiles (id, display_name) values (new.id, creator_name);
  insert into public.workspaces (name, slug, created_by)
  values (
    creator_name || '''s workspace',
    lower(regexp_replace(creator_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 8),
    new.id
  ) returning id into workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (workspace_id, new.id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.fans enable row level security;
alter table public.consents enable row level security;
alter table public.source_connections enable row level security;
alter table public.audience_snapshots enable row level security;
alter table public.import_runs enable row level security;
alter table public.social_experiments enable row level security;

create policy "profiles_read_own" on public.profiles for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "workspaces_member_access" on public.workspaces for select using (public.is_workspace_member(id));
create policy "workspace_members_member_access" on public.workspace_members for select using (public.is_workspace_member(workspace_id));

create policy "fans_member_select" on public.fans for select using (public.is_workspace_member(workspace_id));
create policy "fans_member_insert" on public.fans for insert with check (public.is_workspace_member(workspace_id));
create policy "fans_member_update" on public.fans for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "fans_member_delete" on public.fans for delete using (public.is_workspace_member(workspace_id));

create policy "consents_member_all" on public.consents for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "connections_member_all" on public.source_connections for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "snapshots_member_all" on public.audience_snapshots for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "imports_member_all" on public.import_runs for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "experiments_member_all" on public.social_experiments for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
