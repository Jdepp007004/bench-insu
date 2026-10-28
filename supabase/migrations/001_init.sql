create table if not exists public.workspace_state (
  id text primary key check (id = 'main'),
  payload jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.workspace_state (id, payload, revision)
values ('main', null, 1)
on conflict (id) do nothing;

alter table public.workspace_state enable row level security;

drop policy if exists "workspace members can read workspace" on public.workspace_state;
create policy "workspace members can read workspace"
  on public.workspace_state for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "workspace members can update workspace" on public.workspace_state;
create policy "workspace members can update workspace"
  on public.workspace_state for update to authenticated
  using (auth.uid() is not null) with check (auth.uid() is not null);

create or replace function public.save_workspace(p_payload jsonb, p_expected_revision bigint)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_revision bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  update public.workspace_state
     set payload = p_payload,
         revision = revision + 1,
         updated_at = now(),
         updated_by = auth.uid()
   where id = 'main' and revision = p_expected_revision
   returning revision into next_revision;

  if next_revision is null then
    raise exception 'workspace_revision_conflict' using errcode = '40001';
  end if;
  return next_revision;
end;
$$;

revoke all on function public.save_workspace(jsonb, bigint) from public, anon;
grant execute on function public.save_workspace(jsonb, bigint) to authenticated;
grant select, update on public.workspace_state to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'workspace_state'
  ) then
    alter publication supabase_realtime add table public.workspace_state;
  end if;
end;
$$;
