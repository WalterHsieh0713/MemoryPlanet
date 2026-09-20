-- Run after the migration in the Supabase SQL editor. Every fixture rolls back.
begin;
insert into auth.users (id, email) values
  ('d450e494-cf45-4d3c-9195-f4d000000001', 'memory-planet-rls-a@example.invalid'),
  ('d450e494-cf45-4d3c-9195-f4d000000002', 'memory-planet-rls-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d450e494-cf45-4d3c-9195-f4d000000001","role":"authenticated"}', true);
select public.save_memory_planet(0, '{"version":1,"library":{"journals":[]},"worlds":[]}');
do $$ begin
  if (select count(*) from public.memory_planet_saves) <> 1 then raise exception 'Owner cannot read own save'; end if;
  begin
    perform public.save_memory_planet(0, '{"version":1,"library":{"journals":[]},"worlds":[]}');
    raise exception 'Stale revision unexpectedly succeeded';
  exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"d450e494-cf45-4d3c-9195-f4d000000002","role":"authenticated"}', true);
do $$ begin
  if exists(select 1 from public.memory_planet_saves) then raise exception 'Second user can read first user'; end if;
  update public.memory_planet_saves set revision = 99 where user_id = 'd450e494-cf45-4d3c-9195-f4d000000001';
  if found then raise exception 'Second user can edit first user'; end if;
  begin
    insert into public.memory_planet_saves (user_id, snapshot) values ('d450e494-cf45-4d3c-9195-f4d000000001', '{}');
    raise exception 'Second user can impersonate first user';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.memory_planet_saves;
    raise exception 'Anonymous read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
