create table if not exists public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  external_key text not null,
  title text not null,
  destination text not null,
  subject text not null,
  message text not null,
  channels text[] not null default '{}',
  sources text[] not null default '{}',
  holdout_percent numeric not null default 0 check (holdout_percent between 0 and 25),
  status text not null check (status in ('draft', 'sending', 'completed', 'partial', 'failed', 'cancelled')) default 'draft',
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, external_key)
);

create table if not exists public.outreach_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fan_id uuid not null references public.fans(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  provider text not null check (provider in ('resend', 'twilio')),
  provider_message_id text,
  status text not null check (status in ('queued', 'sent', 'delivered', 'failed', 'bounced', 'suppressed')),
  reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, fan_id, channel)
);

create index if not exists outreach_campaigns_workspace_created_idx
  on public.outreach_campaigns (workspace_id, created_at desc);
create index if not exists outreach_deliveries_workspace_sent_idx
  on public.outreach_deliveries (workspace_id, sent_at desc);
create index if not exists outreach_deliveries_fan_channel_idx
  on public.outreach_deliveries (fan_id, channel, sent_at desc);

alter table public.outreach_campaigns enable row level security;
alter table public.outreach_deliveries enable row level security;

create policy "outreach_campaigns_member_all" on public.outreach_campaigns
  for all using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy "outreach_deliveries_member_all" on public.outreach_deliveries
  for all using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.outreach_campaigns to authenticated;
grant select, insert, update, delete on public.outreach_deliveries to authenticated;
revoke all on public.outreach_campaigns from anon;
revoke all on public.outreach_deliveries from anon;
