-- Task 6: helpers, triggers, and row-level security for the identity/tenancy domain.
-- Design source: docs/database-schema.md §1, §8.

create extension if not exists pgcrypto;

-- ── updated_at maintenance ────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger organizations_set_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
create trigger organization_members_set_updated_at before update on organization_members
  for each row execute function set_updated_at();
create trigger invitations_set_updated_at before update on invitations
  for each row execute function set_updated_at();

-- ── JWT claim helpers (Supabase-compatible) ──────────────────────────────────
-- On Supabase, auth.uid() exists. Locally (plain Postgres test cluster) we
-- create a compatible stub reading request.jwt.claims, so the same policies
-- run in both environments.
create schema if not exists auth;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
    $fn$;
  end if;
end $$;

create or replace function current_org() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'org', '')::uuid;
$$;

-- Membership check that bypasses RLS (security definer) to avoid recursive
-- policy evaluation on organization_members.
create or replace function is_member_of(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function has_role(org uuid, wanted user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
      and m.is_active and wanted = any(m.roles)
  );
$$;

-- Must be security definer: inside a WITH CHECK, a plain subquery on
-- organization_members would itself be RLS-filtered, hiding existing members
-- and letting an attacker "bootstrap" themselves into a foreign organization.
create or replace function org_has_members(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m where m.organization_id = org
  );
$$;

-- ── Row-level security ───────────────────────────────────────────────────────
alter table organizations enable row level security;
alter table organizations force row level security;
alter table users enable row level security;
alter table users force row level security;
alter table organization_members enable row level security;
alter table organization_members force row level security;
alter table invitations enable row level security;
alter table invitations force row level security;

-- organizations: members can read their orgs; only owners can update; any
-- authenticated user can create an organization (they become its owner).
create policy organizations_select on organizations
  for select using (is_member_of(id));
create policy organizations_insert on organizations
  for insert with check (auth.uid() is not null);
create policy organizations_update on organizations
  for update using (has_role(id, 'owner')) with check (has_role(id, 'owner'));

-- users: a user sees/edits their own profile, plus profiles of people who
-- share an organization with them (needed for team lists and assignments).
create policy users_select on users
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from organization_members mine
      join organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and mine.is_active
        and theirs.user_id = users.id and theirs.is_active
    )
  );
create policy users_insert on users
  for insert with check (id = auth.uid());
create policy users_update on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- organization_members: visible to fellow members; managed by owners. A user
-- may insert their own owner membership only for an organization that has no
-- members yet (bootstrap at org creation).
create policy organization_members_select on organization_members
  for select using (user_id = auth.uid() or is_member_of(organization_id));
create policy organization_members_insert on organization_members
  for insert with check (
    has_role(organization_id, 'owner')
    or (
      user_id = auth.uid()
      and 'owner' = any(roles)
      and not org_has_members(organization_id)
    )
  );
create policy organization_members_update on organization_members
  for update using (has_role(organization_id, 'owner'))
  with check (has_role(organization_id, 'owner'));
create policy organization_members_delete on organization_members
  for delete using (has_role(organization_id, 'owner'));

-- invitations: readable/manageable by owners and office managers of the org.
-- Acceptance is performed by the service role (token is the credential).
create policy invitations_select on invitations
  for select using (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  );
create policy invitations_insert on invitations
  for insert with check (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  );
create policy invitations_update on invitations
  for update using (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  ) with check (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  );
