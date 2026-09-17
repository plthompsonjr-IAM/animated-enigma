-- Post-deploy hardening from Supabase security advisors (2026-07-23):
--   0011 function_search_path_mutable  → pin search_path on the two helpers
--       that were missing it (the membership helpers already pin it).
--   0028 anon_security_definer_function_executable → the security-definer
--       membership helpers were callable by signed-out clients through
--       PostgREST RPC. Revoke blanket EXECUTE; re-grant only to the signed-in
--       API role (RLS policy evaluation runs with the caller's privileges, so
--       `authenticated` must keep EXECUTE) and the server-side service role.
-- The role grants are guarded so this migration also runs on plain Postgres
-- (the local RLS test harness), where Supabase's API roles don't exist.

alter function set_updated_at() set search_path = public;
alter function current_org() set search_path = public;

do $$
begin
  revoke execute on function is_member_of(uuid) from public;
  revoke execute on function has_role(uuid, user_role) from public;
  revoke execute on function org_has_members(uuid) from public;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function is_member_of(uuid) from anon;
    revoke execute on function has_role(uuid, user_role) from anon;
    revoke execute on function org_has_members(uuid) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function is_member_of(uuid) to authenticated;
    grant execute on function has_role(uuid, user_role) to authenticated;
    grant execute on function org_has_members(uuid) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function is_member_of(uuid) to service_role;
    grant execute on function has_role(uuid, user_role) to service_role;
    grant execute on function org_has_members(uuid) to service_role;
  end if;
end $$;
