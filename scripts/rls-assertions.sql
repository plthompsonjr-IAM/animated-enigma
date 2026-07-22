-- Task 6 — DB-level authorization tests.
-- Runs against a database with drizzle/0000 + 0001 applied. Seeds two
-- organizations as the service role, then exercises the RLS policies as a
-- constrained role with simulated JWT claims (exactly how Supabase evaluates
-- them). Any failed assertion raises and aborts (psql ON_ERROR_STOP).

\set ON_ERROR_STOP on

-- ── Seed (service role: bypasses RLS, mirrors the app's Drizzle connection) ──
insert into organizations (id, name, slug) values
  ('0000000a-0000-4000-8000-000000000001', 'Org A', 'org-a'),
  ('0000000b-0000-4000-8000-000000000002', 'Org B', 'org-b');

insert into users (id, email) values
  ('00000aaa-0000-4000-8000-000000000001', 'alice@org-a.test'),
  ('00000bbb-0000-4000-8000-000000000002', 'bob@org-b.test');

insert into organization_members (organization_id, user_id, roles) values
  ('0000000a-0000-4000-8000-000000000001', '00000aaa-0000-4000-8000-000000000001', '{owner}'),
  ('0000000b-0000-4000-8000-000000000002', '00000bbb-0000-4000-8000-000000000002', '{owner}');

-- ── Constrained role (like Supabase "authenticated") ─────────────────────────
create role app_user nologin;
grant usage on schema public to app_user;
grant usage on schema auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant execute on all functions in schema auth to app_user;

-- ═════════════════════════════ As Alice (Org A owner) ════════════════════════
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; nm text;
begin
  -- Tenant isolation: Alice sees exactly her own organization.
  select count(*), min(name) into n, nm from organizations;
  if n <> 1 or nm <> 'Org A' then
    raise exception 'FAIL: expected only Org A visible, saw % rows (%)', n, nm;
  end if;
  raise notice 'PASS: cross-org SELECT isolation (organizations)';

  -- Membership visibility scoped to shared orgs.
  select count(*) into n from organization_members;
  if n <> 1 then raise exception 'FAIL: expected 1 visible membership, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (organization_members)';

  -- Bob's profile (no shared org) is invisible; own profile visible.
  select count(*) into n from users;
  if n <> 1 then raise exception 'FAIL: expected 1 visible user profile, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (users)';
end $$;

do $$
declare n int;
begin
  -- Cross-org UPDATE must affect zero rows (row invisible to USING clause).
  update organizations set name = 'hacked'
    where id = '0000000b-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (organizations)';
end $$;

do $$
begin
  -- Self-insertion into a foreign org that already has members must be blocked
  -- (the org_has_members security-definer guard).
  begin
    insert into organization_members (organization_id, user_id, roles)
      values ('0000000b-0000-4000-8000-000000000002',
              '00000aaa-0000-4000-8000-000000000001', '{owner}');
    raise exception 'FAIL: cross-org membership self-insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org membership self-insert blocked';
  end;
end $$;

do $$
begin
  -- Creating invitations for a foreign org must be blocked.
  begin
    insert into invitations (organization_id, email, roles, token_hash, expires_at)
      values ('0000000b-0000-4000-8000-000000000002', 'evil@test', '{owner}',
              'deadbeef', now() + interval '7 days');
    raise exception 'FAIL: cross-org invitation insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org invitation insert blocked';
  end;
end $$;

do $$
begin
  -- Legitimate path: Alice invites into her own org (owner may invite).
  insert into invitations (organization_id, email, roles, token_hash, expires_at)
    values ('0000000a-0000-4000-8000-000000000001', 'new@org-a.test', '{estimator}',
            'cafebabe', now() + interval '7 days');
  raise notice 'PASS: same-org invitation insert allowed for owner';
end $$;

do $$
begin
  -- Bootstrap: Alice creates a brand-new organization and becomes its owner.
  insert into organizations (id, name, slug)
    values ('0000000c-0000-4000-8000-000000000003', 'Org C', 'org-c');
  insert into organization_members (organization_id, user_id, roles)
    values ('0000000c-0000-4000-8000-000000000003',
            '00000aaa-0000-4000-8000-000000000001', '{owner}');
  raise notice 'PASS: new-organization bootstrap allowed';
end $$;

-- ═════════════════════════════ As Bob (Org B owner) ══════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"00000bbb-0000-4000-8000-000000000002","org":"0000000b-0000-4000-8000-000000000002"}',
  false);

do $$
declare n int; nm text;
begin
  select count(*), min(name) into n, nm from organizations;
  if n <> 1 or nm <> 'Org B' then
    raise exception 'FAIL: Bob expected only Org B visible, saw % rows (%)', n, nm;
  end if;
  raise notice 'PASS: isolation holds symmetrically for the second tenant';

  -- Bob cannot see Org A's invitations.
  select count(*) into n from invitations;
  if n <> 0 then raise exception 'FAIL: Bob sees % foreign invitations', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (invitations)';
end $$;

-- ═════════════════════ Non-admin member (estimator in Org A) ═════════════════
reset role;
insert into users (id, email) values ('00000ccc-0000-4000-8000-000000000003', 'carl@org-a.test');
insert into organization_members (organization_id, user_id, roles) values
  ('0000000a-0000-4000-8000-000000000001', '00000ccc-0000-4000-8000-000000000003', '{estimator}');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000ccc-0000-4000-8000-000000000003","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- An estimator shares the org: sees it, and sees co-members…
  select count(*) into n from organizations;
  if n <> 1 then raise exception 'FAIL: estimator expected 1 org, saw %', n; end if;

  -- …but must NOT be able to create invitations (owner/office only)…
  begin
    insert into invitations (organization_id, email, roles, token_hash, expires_at)
      values ('0000000a-0000-4000-8000-000000000001', 'x@test', '{technician}',
              'feedface', now() + interval '7 days');
    raise exception 'FAIL: estimator was ALLOWED to create an invitation';
  exception when insufficient_privilege then
    raise notice 'PASS: non-admin cannot create invitations';
  end;

  -- …nor read them…
  select count(*) into n from invitations;
  if n <> 0 then raise exception 'FAIL: estimator sees % invitations', n; end if;
  raise notice 'PASS: non-admin cannot read invitations';

  -- …nor change memberships.
  update organization_members set roles = '{owner}'
    where user_id = '00000ccc-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: estimator self-promoted via UPDATE (% rows)', n; end if;
  raise notice 'PASS: non-admin cannot modify memberships (no self-promotion)';
end $$;

-- ═════════════════════════ CRM tenant isolation (Task 8) ═════════════════════
-- Seed a lead in each org as the service role, then verify cross-org invisibility.
reset role;
insert into leads (id, organization_id, lead_name, status) values
  ('0000dead-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001', 'Org A bath remodel', 'new'),
  ('0000beef-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002', 'Org B roof', 'new');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; nm text;
begin
  -- Alice sees only Org A's lead.
  select count(*), min(lead_name) into n, nm from leads;
  if n <> 1 or nm <> 'Org A bath remodel' then
    raise exception 'FAIL: expected only Org A lead, saw % (%)', n, nm;
  end if;
  raise notice 'PASS: cross-org SELECT isolation (leads)';

  -- Cross-org UPDATE on Org B's lead affects zero rows.
  update leads set lead_name = 'hacked'
    where id = '0000beef-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org lead UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (leads)';

  -- Inserting a lead into a foreign org is blocked by WITH CHECK.
  begin
    insert into leads (organization_id, lead_name, status)
      values ('0000000b-0000-4000-8000-000000000002', 'evil', 'new');
    raise exception 'FAIL: cross-org lead insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org lead insert blocked';
  end;

  -- Inserting into own org succeeds, and conversion targets (clients/projects)
  -- are writable within the org.
  insert into leads (organization_id, lead_name, status)
    values ('0000000a-0000-4000-8000-000000000001', 'Org A fence', 'new');
  insert into clients (organization_id, display_name)
    values ('0000000a-0000-4000-8000-000000000001', 'Converted Client');
  raise notice 'PASS: same-org lead + client insert allowed';
end $$;

-- A non-member of Org A (Bob) sees no Org A leads.
select set_config('request.jwt.claims',
  '{"sub":"00000bbb-0000-4000-8000-000000000002","org":"0000000b-0000-4000-8000-000000000002"}',
  false);
do $$
declare n int;
begin
  select count(*) into n from leads;
  if n <> 1 then raise exception 'FAIL: Bob should see only his 1 lead, saw %', n; end if;
  raise notice 'PASS: CRM isolation holds for the second tenant (leads)';
end $$;

reset role;
select 'ALL RLS ASSERTIONS PASSED' as result;
