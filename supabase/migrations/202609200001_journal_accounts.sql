-- Supabase Auth owns users and password hashes. The app only stores journal data.
create table if not exists public.memory_planet_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.memory_planet_saves enable row level security;
revoke all on public.memory_planet_saves from anon, authenticated;
grant select, insert, update on public.memory_planet_saves to authenticated;

create policy "Read own journal library" on public.memory_planet_saves
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own journal library" on public.memory_planet_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own journal library" on public.memory_planet_saves
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Compare-and-swap prevents an old tab/device from silently replacing newer work.
-- SECURITY INVOKER keeps RLS in force; callers cannot supply a different user ID.
create or replace function public.save_memory_planet(expected_revision bigint, new_snapshot jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare new_revision bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if new_snapshot->>'version' is distinct from '1'
    or jsonb_typeof(new_snapshot->'library') is distinct from 'object'
    or jsonb_typeof(new_snapshot->'worlds') is distinct from 'array' then
    raise exception 'Invalid journal library' using errcode = '22023';
  end if;
  if expected_revision = 0 then
    insert into public.memory_planet_saves (user_id, snapshot)
      values (auth.uid(), new_snapshot)
      on conflict (user_id) do nothing returning revision into new_revision;
  else
    update public.memory_planet_saves
      set snapshot = new_snapshot, revision = revision + 1, updated_at = now()
      where user_id = auth.uid() and revision = expected_revision
      returning revision into new_revision;
  end if;
  if new_revision is null then
    raise exception 'A newer cloud save exists' using errcode = '40001';
  end if;
  return new_revision;
end;
$$;
revoke all on function public.save_memory_planet(bigint, jsonb) from public, anon;
grant execute on function public.save_memory_planet(bigint, jsonb) to authenticated;
