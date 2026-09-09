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

-- ═══════════════ Client & property isolation (Task 9) ════════════════════════
-- Seed a client + property + contact in each org as the service role.
reset role;
insert into clients (id, organization_id, display_name, primary_phone) values
  ('000c0aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001', 'Org A Client', '4105551234'),
  ('000c0bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002', 'Org B Client', '4435559999');
insert into properties (id, organization_id, client_id, address) values
  ('000d0aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000c0aaa-0000-4000-8000-000000000001', '{"line1":"123 Main St"}'),
  ('000d0bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000c0bbb-0000-4000-8000-000000000002', '{"line1":"9 Oak Ave"}');
insert into client_contacts (organization_id, client_id, name) values
  ('0000000a-0000-4000-8000-000000000001', '000c0aaa-0000-4000-8000-000000000001', 'A Spouse'),
  ('0000000b-0000-4000-8000-000000000002', '000c0bbb-0000-4000-8000-000000000002', 'B Tenant');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Alice sees only Org A's property and contact.
  select count(*) into n from properties;
  if n <> 1 then raise exception 'FAIL: expected 1 visible property, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (properties)';

  select count(*) into n from client_contacts;
  if n <> 1 then raise exception 'FAIL: expected 1 visible client contact, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (client_contacts)';

  -- Cross-org property insert (against Org B's client) is blocked.
  begin
    insert into properties (organization_id, client_id, address)
      values ('0000000b-0000-4000-8000-000000000002',
              '000c0bbb-0000-4000-8000-000000000002', '{"line1":"evil"}');
    raise exception 'FAIL: cross-org property insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org property insert blocked';
  end;

  -- Cross-org contact UPDATE affects zero rows.
  update client_contacts set name = 'hacked'
    where client_id = '000c0bbb-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org contact UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (client_contacts)';

  -- Same-org writes work: a property and a contact on Org A's client.
  insert into properties (organization_id, client_id, address)
    values ('0000000a-0000-4000-8000-000000000001',
            '000c0aaa-0000-4000-8000-000000000001', '{"line1":"456 Elm St"}');
  insert into client_contacts (organization_id, client_id, name)
    values ('0000000a-0000-4000-8000-000000000001',
            '000c0aaa-0000-4000-8000-000000000001', 'Site Contact');
  raise notice 'PASS: same-org property + contact insert allowed';
end $$;

-- ═══════════════ Project workspace isolation (Task 11) ═══════════════════════
-- Seed a project in each org, plus a team member and an activity, as the
-- service role; then verify cross-org invisibility and blocked writes.
reset role;
insert into projects (id, organization_id, project_number, name, client_id, status) values
  ('000e0aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   'PRJ-2026-9001', 'Org A kitchen', '000c0aaa-0000-4000-8000-000000000001', 'planning'),
  ('000e0bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   'PRJ-2026-9002', 'Org B deck', '000c0bbb-0000-4000-8000-000000000002', 'planning');
insert into project_team_members (organization_id, project_id, user_id) values
  ('0000000a-0000-4000-8000-000000000001', '000e0aaa-0000-4000-8000-000000000001',
   '00000aaa-0000-4000-8000-000000000001'),
  ('0000000b-0000-4000-8000-000000000002', '000e0bbb-0000-4000-8000-000000000002',
   '00000bbb-0000-4000-8000-000000000002');
insert into project_activities (organization_id, project_id, activity_type, summary) values
  ('0000000a-0000-4000-8000-000000000001', '000e0aaa-0000-4000-8000-000000000001', 'created', 'A'),
  ('0000000b-0000-4000-8000-000000000002', '000e0bbb-0000-4000-8000-000000000002', 'created', 'B');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; nm text;
begin
  -- Alice sees only Org A's project, team member, and activity.
  select count(*), min(name) into n, nm from projects;
  if n <> 1 or nm <> 'Org A kitchen' then
    raise exception 'FAIL: expected only Org A project, saw % (%)', n, nm;
  end if;
  raise notice 'PASS: cross-org SELECT isolation (projects)';

  select count(*) into n from project_team_members;
  if n <> 1 then raise exception 'FAIL: expected 1 team member, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (project_team_members)';

  select count(*) into n from project_activities;
  if n <> 1 then raise exception 'FAIL: expected 1 project activity, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (project_activities)';

  -- Cross-org team insert (onto Org B's project) is blocked.
  begin
    insert into project_team_members (organization_id, project_id, user_id)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002',
              '00000aaa-0000-4000-8000-000000000001');
    raise exception 'FAIL: cross-org team insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org team insert blocked';
  end;

  -- Cross-org project UPDATE affects zero rows.
  update projects set name = 'hacked'
    where id = '000e0bbb-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org project UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (projects)';

  -- Same-org writes succeed.
  insert into project_activities (organization_id, project_id, activity_type, summary)
    values ('0000000a-0000-4000-8000-000000000001',
            '000e0aaa-0000-4000-8000-000000000001', 'note', 'Same-org note');
  raise notice 'PASS: same-org project activity insert allowed';
end $$;

-- ═══════════════════ Site visit isolation (Task 12) ═════════════════════════
-- Seed a scheduled visit in each org (one against a lead, one a project) as the
-- service role; then verify cross-org invisibility and blocked writes.
reset role;
insert into site_visits (id, organization_id, lead_id, visit_type, scheduled_at, status) values
  ('000f0aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '0000dead-0000-4000-8000-000000000001', 'estimate', now() + interval '2 days', 'scheduled');
insert into site_visits (id, organization_id, project_id, visit_type, scheduled_at, status) values
  ('000f0bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 'measurement', now() + interval '3 days', 'scheduled');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Alice sees only Org A's visit.
  select count(*) into n from site_visits;
  if n <> 1 then raise exception 'FAIL: expected 1 visible site visit, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (site_visits)';

  -- Cross-org visit insert (against Org B's project) is blocked.
  begin
    insert into site_visits (organization_id, project_id, visit_type, scheduled_at)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002', 'estimate', now());
    raise exception 'FAIL: cross-org site visit insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org site visit insert blocked';
  end;

  -- Cross-org UPDATE (completing Org B's visit) affects zero rows.
  update site_visits set status = 'completed'
    where id = '000f0bbb-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org site visit UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (site_visits)';

  -- Same-org visit insert succeeds.
  insert into site_visits (organization_id, lead_id, visit_type, scheduled_at)
    values ('0000000a-0000-4000-8000-000000000001',
            '0000dead-0000-4000-8000-000000000001', 'walkthrough', now() + interval '1 day');
  raise notice 'PASS: same-org site visit insert allowed';
end $$;

-- ═══════════════════ Scope of work isolation (Task 13) ══════════════════════
-- Seed a scope + draft version + section + item in each org as the service role.
reset role;
insert into scopes (id, organization_id, project_id, title) values
  ('00110aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 'Org A scope'),
  ('00110bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 'Org B scope');
insert into scope_versions (id, organization_id, scope_id, version_number, status) values
  ('00120aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '00110aaa-0000-4000-8000-000000000001', 1, 'draft'),
  ('00120bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '00110bbb-0000-4000-8000-000000000002', 1, 'draft');
insert into scope_sections (id, organization_id, scope_version_id, section_type, title) values
  ('00130aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '00120aaa-0000-4000-8000-000000000001', 'included', 'Included'),
  ('00130bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '00120bbb-0000-4000-8000-000000000002', 'included', 'Included');
insert into scope_items (organization_id, scope_section_id, description) values
  ('0000000a-0000-4000-8000-000000000001', '00130aaa-0000-4000-8000-000000000001', 'Demo bathroom'),
  ('0000000b-0000-4000-8000-000000000002', '00130bbb-0000-4000-8000-000000000002', 'Frame deck');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  select count(*) into n from scopes;
  if n <> 1 then raise exception 'FAIL: expected 1 scope, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (scopes)';

  select count(*) into n from scope_versions;
  if n <> 1 then raise exception 'FAIL: expected 1 scope version, saw %', n; end if;
  select count(*) into n from scope_sections;
  if n <> 1 then raise exception 'FAIL: expected 1 scope section, saw %', n; end if;
  select count(*) into n from scope_items;
  if n <> 1 then raise exception 'FAIL: expected 1 scope item, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (versions/sections/items)';

  -- Cross-org section insert (onto Org B's version) is blocked.
  begin
    insert into scope_sections (organization_id, scope_version_id, section_type, title)
      values ('0000000b-0000-4000-8000-000000000002',
              '00120bbb-0000-4000-8000-000000000002', 'excluded', 'evil');
    raise exception 'FAIL: cross-org scope section insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org scope section insert blocked';
  end;

  -- Cross-org UPDATE on Org B's item affects zero rows.
  update scope_items set description = 'hacked'
    where id in (select id from scope_items);
  -- (only Org A's item is visible, so this can't touch Org B's row)
  update scope_versions set status = 'locked'
    where id = '00120bbb-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org version UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (scope_versions)';

  -- Same-org insert succeeds.
  insert into scope_items (organization_id, scope_section_id, description)
    values ('0000000a-0000-4000-8000-000000000001',
            '00130aaa-0000-4000-8000-000000000001', 'Install vanity');
  raise notice 'PASS: same-org scope item insert allowed';
end $$;

-- ═══════════════════ Scope template isolation (Task 14) ═════════════════════
-- Seed one global template (null org), one for Org A, one for Org B.
reset role;
insert into scope_templates (id, organization_id, name, body) values
  ('00140000-0000-4000-8000-000000000000', null,
   'Global bathroom', '{"sections":[]}'),
  ('00140aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   'Org A kitchen', '{"sections":[]}'),
  ('00140bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   'Org B deck', '{"sections":[]}');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Alice sees the global template + her org's, but not Org B's.
  select count(*) into n from scope_templates;
  if n <> 2 then raise exception 'FAIL: expected global + Org A template (2), saw %', n; end if;
  raise notice 'PASS: scope_templates read = own org + global (isolation)';

  -- Cannot create a global template (null org) or one for another org.
  begin
    insert into scope_templates (organization_id, name, body)
      values (null, 'sneaky global', '{"sections":[]}');
    raise exception 'FAIL: global template insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cannot create a global template';
  end;

  begin
    insert into scope_templates (organization_id, name, body)
      values ('0000000b-0000-4000-8000-000000000002', 'evil', '{"sections":[]}');
    raise exception 'FAIL: cross-org template insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cannot create a template for another org';
  end;

  -- Cannot modify or delete the global template.
  update scope_templates set name = 'hacked'
    where id = '00140000-0000-4000-8000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: global template UPDATE affected % rows', n; end if;
  raise notice 'PASS: cannot modify a global template';

  -- Same-org template insert + update succeed.
  insert into scope_templates (organization_id, name, body)
    values ('0000000a-0000-4000-8000-000000000001', 'Org A bath', '{"sections":[]}');
  update scope_templates set is_active = false
    where id = '00140aaa-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: own-org template UPDATE affected % rows', n; end if;
  raise notice 'PASS: own-org scope template writes allowed';
end $$;

-- ═══════════════════ Cost catalog isolation (Task 15) ══════════════════════
-- Seed a global item (null org), one for Org A, one for Org B.
reset role;
insert into cost_catalog_items (id, organization_id, name, unit) values
  ('00160000-0000-4000-8000-000000000000', null, 'Global 2x4', 'linear_foot'),
  ('00160aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001', 'Org A drywall', 'square_foot'),
  ('00160bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002', 'Org B tile', 'square_foot');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Alice sees the global item + her org's, but not Org B's.
  select count(*) into n from cost_catalog_items;
  if n <> 2 then raise exception 'FAIL: expected global + Org A catalog item (2), saw %', n; end if;
  raise notice 'PASS: cost_catalog read = own org + global (isolation)';

  -- Cannot create a global item or one for another org.
  begin
    insert into cost_catalog_items (organization_id, name, unit)
      values (null, 'sneaky', 'each');
    raise exception 'FAIL: global catalog insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cannot create a global catalog item';
  end;
  begin
    insert into cost_catalog_items (organization_id, name, unit)
      values ('0000000b-0000-4000-8000-000000000002', 'evil', 'each');
    raise exception 'FAIL: cross-org catalog insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cannot create a catalog item for another org';
  end;

  -- Cannot modify the global item.
  update cost_catalog_items set name = 'hacked'
    where id = '00160000-0000-4000-8000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: global catalog UPDATE affected % rows', n; end if;
  raise notice 'PASS: cannot modify a global catalog item';

  -- Same-org insert + price-history insert succeed.
  insert into cost_catalog_items (organization_id, name, unit)
    values ('0000000a-0000-4000-8000-000000000001', 'Org A paint', 'square_foot');
  insert into catalog_price_history (organization_id, catalog_item_id, material_cost)
    values ('0000000a-0000-4000-8000-000000000001',
            '00160aaa-0000-4000-8000-000000000001', 0.85);
  raise notice 'PASS: own-org catalog + price-history writes allowed';

  -- Cannot write price history against a foreign org.
  begin
    insert into catalog_price_history (organization_id, catalog_item_id, material_cost)
      values ('0000000b-0000-4000-8000-000000000002',
              '00160bbb-0000-4000-8000-000000000002', 9.99);
    raise exception 'FAIL: cross-org price-history insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org price-history insert blocked';
  end;
end $$;

-- ═══════════════════ Estimate isolation (Task 16) ══════════════════════════
-- Seed an estimate version + line in each org as the service role.
reset role;
insert into estimate_versions (id, organization_id, project_id, version_number, status) values
  ('00180aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 1, 'draft'),
  ('00180bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 1, 'draft');
insert into estimate_line_items (organization_id, estimate_version_id, description, line_type, quantity, unit_cost) values
  ('0000000a-0000-4000-8000-000000000001', '00180aaa-0000-4000-8000-000000000001', 'A drywall', 'material', 100, 2),
  ('0000000b-0000-4000-8000-000000000002', '00180bbb-0000-4000-8000-000000000002', 'B tile', 'material', 50, 9);

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Alice sees only Org A's estimate + line.
  select count(*) into n from estimate_versions;
  if n <> 1 then raise exception 'FAIL: expected 1 estimate version, saw %', n; end if;
  select count(*) into n from estimate_line_items;
  if n <> 1 then raise exception 'FAIL: expected 1 estimate line, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (estimates)';

  -- Cross-org line insert (onto Org B's estimate) is blocked.
  begin
    insert into estimate_line_items (organization_id, estimate_version_id, description, line_type, quantity, unit_cost)
      values ('0000000b-0000-4000-8000-000000000002',
              '00180bbb-0000-4000-8000-000000000002', 'evil', 'material', 1, 1);
    raise exception 'FAIL: cross-org estimate line insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org estimate line insert blocked';
  end;

  -- Cross-org UPDATE (locking Org B's estimate) affects zero rows.
  update estimate_versions set status = 'locked'
    where id = '00180bbb-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org estimate UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (estimates)';

  -- Same-org line insert succeeds.
  insert into estimate_line_items (organization_id, estimate_version_id, description, line_type, quantity, unit_cost)
    values ('0000000a-0000-4000-8000-000000000001',
            '00180aaa-0000-4000-8000-000000000001', 'A paint', 'labor', 8, 45);
  raise notice 'PASS: same-org estimate line insert allowed';
end $$;

-- ═══════════════════ Proposal isolation (Task 17) ══════════════════════════
-- Seed a proposal + version + event in each org as the service role.
reset role;
insert into proposals (id, organization_id, project_id, proposal_number, status) values
  ('00200aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 'PROP-2026-0001', 'draft'),
  ('00200bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 'PROP-2026-0001', 'draft');
insert into proposal_versions (id, organization_id, proposal_id, version_number, secure_link_token_hash) values
  ('00210aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '00200aaa-0000-4000-8000-000000000001', 1, 'hasha'),
  ('00210bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '00200bbb-0000-4000-8000-000000000002', 1, 'hashb');
insert into proposal_events (organization_id, proposal_version_id, event_type) values
  ('0000000a-0000-4000-8000-000000000001', '00210aaa-0000-4000-8000-000000000001', 'created'),
  ('0000000b-0000-4000-8000-000000000002', '00210bbb-0000-4000-8000-000000000002', 'created');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  select count(*) into n from proposals;
  if n <> 1 then raise exception 'FAIL: expected 1 proposal, saw %', n; end if;
  select count(*) into n from proposal_versions;
  if n <> 1 then raise exception 'FAIL: expected 1 proposal version, saw %', n; end if;
  select count(*) into n from proposal_events;
  if n <> 1 then raise exception 'FAIL: expected 1 proposal event, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (proposals)';

  -- Cross-org event insert (onto Org B's version) is blocked.
  begin
    insert into proposal_events (organization_id, proposal_version_id, event_type)
      values ('0000000b-0000-4000-8000-000000000002',
              '00210bbb-0000-4000-8000-000000000002', 'viewed');
    raise exception 'FAIL: cross-org proposal event insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org proposal event insert blocked';
  end;

  -- Cross-org UPDATE (accepting Org B's proposal) affects zero rows.
  update proposals set status = 'accepted'
    where id = '00200bbb-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org proposal UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (proposals)';

  -- Same-org event insert succeeds.
  insert into proposal_events (organization_id, proposal_version_id, event_type)
    values ('0000000a-0000-4000-8000-000000000001',
            '00210aaa-0000-4000-8000-000000000001', 'sent');
  raise notice 'PASS: same-org proposal event insert allowed';
end $$;

reset role;

-- ═══════════════════ Signature isolation + immutability (Task 19) ═══════════
-- Seed one signature per org against that org's proposal version.
reset role;
insert into signatures
  (id, organization_id, signable_type, signable_id, signer_name, disclosure_text) values
  ('00220aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   'proposal_version', '00210aaa-0000-4000-8000-000000000001', 'Alice Client', 'disclosure A'),
  ('00220bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   'proposal_version', '00210bbb-0000-4000-8000-000000000002', 'Bob Client', 'disclosure B');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  select count(*) into n from signatures;
  if n <> 1 then raise exception 'FAIL: expected 1 signature, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (signatures)';

  -- Forging a signature into another org is blocked by RLS.
  begin
    insert into signatures (organization_id, signable_type, signable_id, signer_name)
      values ('0000000b-0000-4000-8000-000000000002', 'proposal_version',
              '00210bbb-0000-4000-8000-000000000002', 'Mallory');
    raise exception 'FAIL: cross-org signature insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org signature insert blocked';
  end;

  -- Signatures are append-only: rewriting the signer is rejected outright.
  begin
    update signatures set signer_name = 'Tampered'
      where id = '00220aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: signature UPDATE was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: signature UPDATE blocked (append-only)';
  end;

  begin
    delete from signatures where id = '00220aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: signature DELETE was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: signature DELETE blocked (append-only)';
  end;

  -- Same-org signature insert succeeds.
  insert into signatures (organization_id, signable_type, signable_id, signer_name)
    values ('0000000a-0000-4000-8000-000000000001', 'proposal_version',
            '00210aaa-0000-4000-8000-000000000001', 'Alice Client');
  raise notice 'PASS: same-org signature insert allowed';
end $$;

-- Append-only holds even for the privileged service role (BYPASSRLS).
reset role;
do $$
begin
  begin
    update signatures set signer_name = 'Tampered'
      where id = '00220bbb-0000-4000-8000-000000000002';
    raise exception 'FAIL: service-role signature UPDATE was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: signature UPDATE blocked even for service role';
  end;
end $$;

reset role;

-- ═══════════════════ Contract isolation + freezing (Task 20) ════════════════
-- Seed a draft contract with a payment schedule in each org.
reset role;
insert into contracts (id, organization_id, project_id, contract_number, status, contract_value) values
  ('00230aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 'CON-2026-0001', 'draft', 10000.00),
  ('00230bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 'CON-2026-0001', 'draft', 20000.00);
insert into payment_schedules (id, organization_id, contract_id, structure_type) values
  ('00240aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '00230aaa-0000-4000-8000-000000000001', 'deposit_balance'),
  ('00240bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '00230bbb-0000-4000-8000-000000000002', 'deposit_balance');
insert into payment_milestones (organization_id, payment_schedule_id, name, percentage) values
  ('0000000a-0000-4000-8000-000000000001', '00240aaa-0000-4000-8000-000000000001', 'Deposit', 75),
  ('0000000b-0000-4000-8000-000000000002', '00240bbb-0000-4000-8000-000000000002', 'Deposit', 75);

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  select count(*) into n from contracts;
  if n <> 1 then raise exception 'FAIL: expected 1 contract, saw %', n; end if;
  select count(*) into n from payment_schedules;
  if n <> 1 then raise exception 'FAIL: expected 1 payment schedule, saw %', n; end if;
  select count(*) into n from payment_milestones;
  if n <> 1 then raise exception 'FAIL: expected 1 payment milestone, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (contracts)';

  -- Cross-org contract insert is blocked.
  begin
    insert into contracts (organization_id, project_id, contract_number, contract_value)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002', 'CON-2026-0099', 1.00);
    raise exception 'FAIL: cross-org contract insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org contract insert blocked';
  end;

  -- Cross-org UPDATE affects zero rows.
  update contracts set contract_value = 1
    where id = '00230bbb-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org contract UPDATE affected % rows', n; end if;
  raise notice 'PASS: cross-org UPDATE blocked (contracts)';

  -- A draft contract is still editable.
  update contracts set contract_value = 11000
    where id = '00230aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: draft contract value is editable';

  -- Activating is allowed; afterwards the money is frozen.
  update contracts set status = 'active'
    where id = '00230aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: draft → active transition allowed';

  begin
    update contracts set contract_value = 999
      where id = '00230aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: active contract value change was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: active contract value change blocked';
  end;

  -- Status may still advance on an active contract.
  update contracts set status = 'completed'
    where id = '00230aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: active → completed transition still allowed';

  -- Payment terms follow the contract: frozen once it leaves draft.
  begin
    update payment_milestones set percentage = 10
      where payment_schedule_id = '00240aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: payment milestone edit on locked contract was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: payment terms frozen once contract leaves draft';
  end;
end $$;

reset role;

-- ═══════════════════ Change-order isolation + freezing (Task 21) ═════════════
-- Seed a draft change order with one line in each org.
reset role;
insert into change_orders
  (id, organization_id, project_id, change_order_number, status, cost_change) values
  ('00250aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 'CO-2026-0001', 'draft', 1200.00),
  ('00250bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 'CO-2026-0001', 'draft', 900.00);
insert into change_order_items (organization_id, change_order_id, direction, description, amount) values
  ('0000000a-0000-4000-8000-000000000001', '00250aaa-0000-4000-8000-000000000001',
   'added', 'Replace subfloor', 1200.00),
  ('0000000b-0000-4000-8000-000000000002', '00250bbb-0000-4000-8000-000000000002',
   'added', 'Extra outlet', 900.00);

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  select count(*) into n from change_orders;
  if n <> 1 then raise exception 'FAIL: expected 1 change order, saw %', n; end if;
  select count(*) into n from change_order_items;
  if n <> 1 then raise exception 'FAIL: expected 1 change order item, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (change orders)';

  -- Cross-org insert is blocked.
  begin
    insert into change_orders (organization_id, project_id, change_order_number, cost_change)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002', 'CO-2026-0099', 1.00);
    raise exception 'FAIL: cross-org change order insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org change order insert blocked';
  end;

  -- A draft change order is editable, items included.
  update change_orders set cost_change = 1500
    where id = '00250aaa-0000-4000-8000-000000000001';
  update change_order_items set amount = 1500
    where change_order_id = '00250aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: draft change order and its items are editable';

  -- Walk it to approved.
  update change_orders set status = 'sent'
    where id = '00250aaa-0000-4000-8000-000000000001';
  update change_orders set status = 'approved'
    where id = '00250aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: draft → sent → approved transitions allowed';

  -- Approved terms are frozen.
  begin
    update change_orders set cost_change = 99999
      where id = '00250aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: approved change order cost change was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: approved change order cost is frozen';
  end;

  -- Its line items are locked too.
  begin
    update change_order_items set amount = 5
      where change_order_id = '00250aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: item edit on approved change order was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: approved change order items are locked';
  end;

  -- But it may still be incorporated.
  update change_orders set status = 'incorporated'
    where id = '00250aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: approved → incorporated still allowed';
end $$;

reset role;

-- ═══════════════════ Invoice/payment ledger (Task 22) ════════════════════════
-- Seed a draft invoice with a line in each org.
reset role;
insert into invoices
  (id, organization_id, project_id, client_id, invoice_number, invoice_type, status, subtotal, total, balance)
  values
  ('00260aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', '000c0aaa-0000-4000-8000-000000000001',
   'INV-2026-0001', 'deposit', 'draft', 1000.00, 1000.00, 1000.00),
  ('00260bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', '000c0bbb-0000-4000-8000-000000000002',
   'INV-2026-0001', 'deposit', 'draft', 2000.00, 2000.00, 2000.00);
insert into invoice_line_items (organization_id, invoice_id, description, quantity, unit_price, amount) values
  ('0000000a-0000-4000-8000-000000000001', '00260aaa-0000-4000-8000-000000000001',
   'Deposit', 1, 1000.00, 1000.00),
  ('0000000b-0000-4000-8000-000000000002', '00260bbb-0000-4000-8000-000000000002',
   'Deposit', 1, 2000.00, 2000.00);

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; pay uuid;
begin
  select count(*) into n from invoices;
  if n <> 1 then raise exception 'FAIL: expected 1 invoice, saw %', n; end if;
  select count(*) into n from invoice_line_items;
  if n <> 1 then raise exception 'FAIL: expected 1 invoice line, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (invoices)';

  -- Cross-org invoice insert is blocked.
  begin
    insert into invoices (organization_id, project_id, client_id, invoice_number, invoice_type)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002',
              '000c0bbb-0000-4000-8000-000000000002', 'INV-2026-0099', 'deposit');
    raise exception 'FAIL: cross-org invoice insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org invoice insert blocked';
  end;

  -- A draft invoice is editable.
  update invoices set total = 1200, subtotal = 1200, balance = 1200
    where id = '00260aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: draft invoice amounts are editable';

  -- Issue it; billed amounts freeze but payment columns must still move.
  update invoices set status = 'sent' where id = '00260aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: draft → sent transition allowed';

  begin
    update invoices set total = 5 where id = '00260aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: issued invoice total change was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: issued invoice amounts are frozen';
  end;

  begin
    update invoice_line_items set amount = 5
      where invoice_id = '00260aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: line edit on issued invoice was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: issued invoice lines are locked';
  end;

  -- Recording a payment must still be possible on an issued invoice.
  insert into payments (organization_id, project_id, amount, method, locked_at)
    values ('0000000a-0000-4000-8000-000000000001',
            '000e0aaa-0000-4000-8000-000000000001', 500.00, 'check', now())
    returning id into pay;
  insert into payment_allocations (organization_id, payment_id, invoice_id, amount, locked_at)
    values ('0000000a-0000-4000-8000-000000000001', pay,
            '00260aaa-0000-4000-8000-000000000001', 500.00, now());
  update invoices set amount_paid = 500, balance = 700, status = 'partially_paid'
    where id = '00260aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: payment columns and status still update on an issued invoice';

  -- Locked cash is immutable.
  begin
    update payments set amount = 9999 where id = pay;
    raise exception 'FAIL: locked payment amount change was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: locked payment is immutable';
  end;

  begin
    delete from payments where id = pay;
    raise exception 'FAIL: locked payment DELETE was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: locked payment cannot be deleted';
  end;

  begin
    update payment_allocations set amount = 1 where payment_id = pay;
    raise exception 'FAIL: locked allocation change was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: locked allocation is immutable';
  end;
end $$;

-- ═══════════════════ Project schedule (Task 23) ══════════════════════════════
-- Seed one work item per org so isolation and the integrity rules can be checked.
reset role;
insert into schedule_items
  (id, organization_id, project_id, name, start_date, end_date)
  values
  ('00270aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 'Demolition', '2026-08-03', '2026-08-07'),
  ('00270bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 'Demolition', '2026-08-03', '2026-08-07');
insert into schedule_assignments (organization_id, schedule_item_id, user_id) values
  ('0000000a-0000-4000-8000-000000000001', '00270aaa-0000-4000-8000-000000000001',
   '00000aaa-0000-4000-8000-000000000001'),
  ('0000000b-0000-4000-8000-000000000002', '00270bbb-0000-4000-8000-000000000002',
   '00000bbb-0000-4000-8000-000000000002');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; second_item uuid;
begin
  select count(*) into n from schedule_items;
  if n <> 1 then raise exception 'FAIL: expected 1 schedule item, saw %', n; end if;
  select count(*) into n from schedule_assignments;
  if n <> 1 then raise exception 'FAIL: expected 1 assignment, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (schedule)';

  -- Cross-org insert is blocked by the tenant policy.
  begin
    insert into schedule_items (organization_id, project_id, name, start_date, end_date)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002', 'Sneaky', '2026-08-03', '2026-08-07');
    raise exception 'FAIL: cross-org schedule item insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org schedule item insert blocked';
  end;

  begin
    insert into schedule_assignments (organization_id, schedule_item_id, user_id)
      values ('0000000b-0000-4000-8000-000000000002',
              '00270bbb-0000-4000-8000-000000000002',
              '00000aaa-0000-4000-8000-000000000001');
    raise exception 'FAIL: cross-org crew assignment was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org crew assignment blocked';
  end;

  -- A backwards date range is rejected outright.
  begin
    update schedule_items set end_date = '2026-08-01'
      where id = '00270aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: end_date before start_date was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: end_date must be on or after start_date';
  end;

  -- Percent complete is bounded.
  begin
    update schedule_items set percent_complete = 140
      where id = '00270aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: percent_complete 140 was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: percent_complete is bounded to 0–100';
  end;

  -- A work item cannot depend on itself.
  begin
    update schedule_items set depends_on_id = id
      where id = '00270aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: self-dependency was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: self-dependency rejected';
  end;

  -- Nor on an item belonging to another project. The cross-org item is invisible
  -- under RLS, so the trigger sees a null project and rejects the mismatch.
  begin
    update schedule_items set depends_on_id = '00270bbb-0000-4000-8000-000000000002'
      where id = '00270aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: cross-project dependency was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: cross-project dependency rejected';
  end;

  -- A dependency within the same project is fine.
  insert into schedule_items (organization_id, project_id, name, start_date, end_date,
                              depends_on_id)
    values ('0000000a-0000-4000-8000-000000000001',
            '000e0aaa-0000-4000-8000-000000000001', 'Rough-in', '2026-08-10', '2026-08-14',
            '00270aaa-0000-4000-8000-000000000001')
    returning id into second_item;
  raise notice 'PASS: same-project dependency allowed';

  -- Removing a predecessor orphans the dependency rather than deleting the work.
  delete from schedule_items where id = '00270aaa-0000-4000-8000-000000000001';
  select count(*) into n from schedule_items where id = second_item and depends_on_id is null;
  if n <> 1 then raise exception 'FAIL: successor did not survive predecessor deletion'; end if;
  raise notice 'PASS: deleting a predecessor clears the dependency, keeps the successor';

  -- Deleting a work item takes its crew assignments with it.
  select count(*) into n from schedule_assignments
    where schedule_item_id = '00270aaa-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL: assignments outlived their work item'; end if;
  raise notice 'PASS: crew assignments cascade with the work item';
end $$;

-- ═══════════════════ Field tasks (Task 24) ═══════════════════════════════════
reset role;
insert into project_tasks (id, organization_id, project_id, title, status) values
  ('00280aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 'Demo the vanity', 'not_started'),
  ('00280aaa-0000-4000-8000-000000000002', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', 'Set the new vanity', 'not_started'),
  ('00280bbb-0000-4000-8000-000000000003', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', 'Other org task', 'not_started');
insert into task_checklist_items (organization_id, task_id, label) values
  ('0000000a-0000-4000-8000-000000000001', '00280aaa-0000-4000-8000-000000000001',
   'Shut off the water'),
  ('0000000b-0000-4000-8000-000000000002', '00280bbb-0000-4000-8000-000000000003',
   'Not yours');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; finished timestamptz;
begin
  select count(*) into n from project_tasks;
  if n <> 2 then raise exception 'FAIL: expected 2 tasks, saw %', n; end if;
  select count(*) into n from task_checklist_items;
  if n <> 1 then raise exception 'FAIL: expected 1 checklist item, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (tasks)';

  begin
    insert into project_tasks (organization_id, project_id, title)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002', 'Sneaky');
    raise exception 'FAIL: cross-org task insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org task insert blocked';
  end;

  begin
    insert into task_checklist_items (organization_id, task_id, label)
      values ('0000000b-0000-4000-8000-000000000002',
              '00280bbb-0000-4000-8000-000000000003', 'Sneaky step');
    raise exception 'FAIL: cross-org checklist insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org checklist insert blocked';
  end;

  -- A backwards date range is rejected; either date alone is fine.
  update project_tasks set due_date = '2026-08-07'
    where id = '00280aaa-0000-4000-8000-000000000001';
  raise notice 'PASS: a due date with no start date is allowed';

  begin
    update project_tasks set start_date = '2026-08-10'
      where id = '00280aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: due_date before start_date was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: due_date must be on or after start_date';
  end;

  begin
    update project_tasks set actual_hours = -2
      where id = '00280aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: negative hours were ALLOWED';
  exception when check_violation then
    raise notice 'PASS: hours cannot be negative';
  end;

  -- completed_at is maintained by the database, not by whoever writes the row.
  update project_tasks set status = 'completed'
    where id = '00280aaa-0000-4000-8000-000000000001';
  select completed_at into finished from project_tasks
    where id = '00280aaa-0000-4000-8000-000000000001';
  if finished is null then raise exception 'FAIL: completed task has no completed_at'; end if;
  raise notice 'PASS: completing a task records completed_at';

  update project_tasks set status = 'rework_required'
    where id = '00280aaa-0000-4000-8000-000000000001';
  select completed_at into finished from project_tasks
    where id = '00280aaa-0000-4000-8000-000000000001';
  if finished is not null then raise exception 'FAIL: reopened task kept completed_at'; end if;
  raise notice 'PASS: reopening a task clears completed_at';

  -- A task cannot wait on itself.
  begin
    insert into task_dependencies (organization_id, task_id, depends_on_task_id)
      values ('0000000a-0000-4000-8000-000000000001',
              '00280aaa-0000-4000-8000-000000000001',
              '00280aaa-0000-4000-8000-000000000001');
    raise exception 'FAIL: self-dependency was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: task self-dependency rejected';
  end;

  -- Nor on a task belonging to another project. The other org's task is invisible
  -- under RLS, so the trigger sees a null project and rejects the mismatch.
  begin
    insert into task_dependencies (organization_id, task_id, depends_on_task_id)
      values ('0000000a-0000-4000-8000-000000000001',
              '00280aaa-0000-4000-8000-000000000002',
              '00280bbb-0000-4000-8000-000000000003');
    raise exception 'FAIL: cross-project task dependency was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: cross-project task dependency rejected';
  end;

  -- Same project is fine, and only once.
  insert into task_dependencies (organization_id, task_id, depends_on_task_id)
    values ('0000000a-0000-4000-8000-000000000001',
            '00280aaa-0000-4000-8000-000000000002',
            '00280aaa-0000-4000-8000-000000000001');
  raise notice 'PASS: same-project task dependency allowed';

  begin
    insert into task_dependencies (organization_id, task_id, depends_on_task_id)
      values ('0000000a-0000-4000-8000-000000000001',
              '00280aaa-0000-4000-8000-000000000002',
              '00280aaa-0000-4000-8000-000000000001');
    raise exception 'FAIL: duplicate dependency was ALLOWED';
  exception when unique_violation then
    raise notice 'PASS: duplicate dependency rejected';
  end;

  -- Deleting a task takes its checklist and its dependency edges with it.
  delete from project_tasks where id = '00280aaa-0000-4000-8000-000000000001';
  select count(*) into n from task_checklist_items
    where task_id = '00280aaa-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL: checklist outlived its task'; end if;
  select count(*) into n from task_dependencies
    where depends_on_task_id = '00280aaa-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL: dependency outlived its task'; end if;
  raise notice 'PASS: checklists and dependencies cascade with the task';
end $$;

-- ═══════════════════ Daily logs (Task 25) ════════════════════════════════════
-- The log is the contemporaneous jobsite record. Three things are checked here
-- because the app is not trusted with any of them: the edit window, the
-- automatic revision snapshot, and the append-only history.
reset role;
insert into daily_logs (id, organization_id, project_id, log_date, work_completed) values
  ('00290aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001', current_date, 'Framed the wet wall.'),
  ('00290bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002', current_date, 'Other org work.');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; window_end timestamptz; snap jsonb;
begin
  select count(*) into n from daily_logs;
  if n <> 1 then raise exception 'FAIL: expected 1 daily log, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (daily logs)';

  begin
    insert into daily_logs (organization_id, project_id, log_date, work_completed)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002', current_date, 'Sneaky');
    raise exception 'FAIL: cross-org daily log insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org daily log insert blocked';
  end;

  -- A log records work that has happened.
  begin
    insert into daily_logs (organization_id, project_id, log_date, work_completed)
      values ('0000000a-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001', current_date + 1, 'Tomorrow');
    raise exception 'FAIL: future-dated log was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a daily log cannot be dated ahead';
  end;

  -- One log per project per day.
  begin
    insert into daily_logs (organization_id, project_id, log_date, work_completed)
      values ('0000000a-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001', current_date, 'Duplicate');
    raise exception 'FAIL: a second log for the same day was ALLOWED';
  exception when unique_violation then
    raise notice 'PASS: one log per project per day';
  end;

  -- The window is set by the database, not supplied by the caller.
  select editable_until into window_end from daily_logs
    where id = '00290aaa-0000-4000-8000-000000000001';
  if window_end is null then raise exception 'FAIL: no edit window was set'; end if;
  if window_end <> (current_date + 2)::timestamptz then
    raise exception 'FAIL: unexpected edit window %', window_end;
  end if;
  raise notice 'PASS: the edit window is set by the database on insert';

  -- Editing inside the window works, and snapshots the previous version.
  update daily_logs set work_completed = 'Framed and sheathed the wet wall.', delays = 'Late delivery.'
    where id = '00290aaa-0000-4000-8000-000000000001';
  select count(*) into n from daily_log_revisions
    where daily_log_id = '00290aaa-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL: expected 1 revision after an edit, saw %', n; end if;
  select snapshot into snap from daily_log_revisions
    where daily_log_id = '00290aaa-0000-4000-8000-000000000001';
  if snap->>'work_completed' <> 'Framed the wet wall.' then
    raise exception 'FAIL: revision did not capture the previous text (%)', snap->>'work_completed';
  end if;
  raise notice 'PASS: an edit inside the window snapshots the previous version';

  -- A no-op update writes no revision.
  update daily_logs set work_completed = 'Framed and sheathed the wet wall.'
    where id = '00290aaa-0000-4000-8000-000000000001';
  select count(*) into n from daily_log_revisions
    where daily_log_id = '00290aaa-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL: a no-op update wrote a revision'; end if;
  raise notice 'PASS: an update that changes nothing writes no revision';

  -- The window cannot be widened by an update.
  update daily_logs set editable_until = now() + interval '30 days',
                        work_completed = 'Trying to buy time.'
    where id = '00290aaa-0000-4000-8000-000000000001';
  select editable_until into window_end from daily_logs
    where id = '00290aaa-0000-4000-8000-000000000001';
  if window_end <> (current_date + 2)::timestamptz then
    raise exception 'FAIL: the edit window was widened to %', window_end;
  end if;
  raise notice 'PASS: the edit window cannot be extended by an update';

  -- Revisions are evidence: append-only even for this role.
  begin
    update daily_log_revisions set snapshot = '{}'::jsonb
      where daily_log_id = '00290aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: revision UPDATE was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: daily log revisions cannot be edited';
  end;

  begin
    delete from daily_log_revisions
      where daily_log_id = '00290aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: revision DELETE was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: daily log revisions cannot be deleted';
  end;
end $$;

-- Now prove a log locks once its window passes. Backdating is done as the
-- privileged role because the trigger deliberately refuses it from the app.
reset role;
update daily_logs set editable_until = now() - interval '1 second'
  where id = '00290aaa-0000-4000-8000-000000000001';

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
begin
  begin
    update daily_logs set work_completed = 'Rewriting history.'
      where id = '00290aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: editing a locked log was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: a locked daily log rejects content edits';
  end;

  begin
    delete from daily_logs where id = '00290aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: deleting a locked log was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: a locked daily log cannot be deleted';
  end;
end $$;

-- The revision history survives even the privileged role, and outlives edits.
reset role;
do $$
declare n int;
begin
  begin
    update daily_log_revisions set snapshot = '{}'::jsonb;
    raise exception 'FAIL: privileged revision UPDATE was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: revisions are append-only even for the privileged role';
  end;

  select count(*) into n from daily_log_revisions
    where daily_log_id = '00290aaa-0000-4000-8000-000000000001';
  if n < 1 then raise exception 'FAIL: revision history was lost'; end if;
  raise notice 'PASS: revision history is intact';
end $$;

-- ═══════════════════ Photos & documents (Task 26) ════════════════════════════
-- The bytes live in a private storage bucket; these tables hold the metadata and
-- the access decisions. The constraint that matters is that a storage path is
-- always namespaced to its owning organisation — a bug that builds one wrongly
-- must fail at the write, not quietly file one tenant's file under another's.
reset role;
insert into photos (id, organization_id, project_id, storage_path, category) values
  ('002a0aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001',
   'orgs/0000000a-0000-4000-8000-000000000001/projects/000e0aaa-0000-4000-8000-000000000001/photos/x-a.jpg',
   'before'),
  ('002a0bbb-0000-4000-8000-000000000002', '0000000b-0000-4000-8000-000000000002',
   '000e0bbb-0000-4000-8000-000000000002',
   'orgs/0000000b-0000-4000-8000-000000000002/projects/000e0bbb-0000-4000-8000-000000000002/photos/x-b.jpg',
   'before');
insert into documents (id, organization_id, project_id, storage_path, file_name, category) values
  ('002b0aaa-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000001',
   '000e0aaa-0000-4000-8000-000000000001',
   'orgs/0000000a-0000-4000-8000-000000000001/projects/000e0aaa-0000-4000-8000-000000000001/documents/x-permit.pdf',
   'permit.pdf', 'permit');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; shared boolean;
begin
  select count(*) into n from photos;
  if n <> 1 then raise exception 'FAIL: expected 1 photo, saw %', n; end if;
  select count(*) into n from documents;
  if n <> 1 then raise exception 'FAIL: expected 1 document, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (photos & documents)';

  begin
    insert into photos (organization_id, project_id, storage_path)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002',
              'orgs/0000000b-0000-4000-8000-000000000002/x.jpg');
    raise exception 'FAIL: cross-org photo insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org photo insert blocked';
  end;

  -- A path outside this organisation's prefix is rejected outright, even for a
  -- row that otherwise passes the tenant policy.
  begin
    insert into photos (organization_id, project_id, storage_path)
      values ('0000000a-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001',
              'orgs/0000000b-0000-4000-8000-000000000002/projects/x/photos/stolen.jpg');
    raise exception 'FAIL: a photo path under another org was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a storage path must sit under its own organisation';
  end;

  begin
    insert into documents (organization_id, project_id, storage_path, file_name)
      values ('0000000a-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001',
              '../../etc/passwd', 'passwd');
    raise exception 'FAIL: a traversal-shaped document path was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a document path must sit under its own organisation';
  end;

  begin
    update photos set size_bytes = -1
      where id = '002a0aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: a negative photo size was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: file sizes cannot be negative';
  end;

  -- Two rows can never claim the same object.
  begin
    insert into photos (organization_id, project_id, storage_path)
      values ('0000000a-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001',
              'orgs/0000000a-0000-4000-8000-000000000001/projects/000e0aaa-0000-4000-8000-000000000001/photos/x-a.jpg');
    raise exception 'FAIL: a duplicate storage path was ALLOWED';
  exception when unique_violation then
    raise notice 'PASS: a storage path is claimed by at most one row';
  end;

  -- Client visibility defaults to hidden: a photo of an open wall is internal
  -- until somebody decides otherwise.
  select client_visible into shared from photos
    where id = '002a0aaa-0000-4000-8000-000000000001';
  if shared then raise exception 'FAIL: photos default to client-visible'; end if;
  select client_visible into shared from documents
    where id = '002b0aaa-0000-4000-8000-000000000001';
  if shared then raise exception 'FAIL: documents default to client-visible'; end if;
  raise notice 'PASS: nothing is client-visible until it is shared deliberately';
end $$;

-- ═══════════════════ Dashboard signals (Task 27) ═════════════════════════════
-- The dashboard is built from aggregates over almost every table. A wrong enum
-- value or column name in one of them only shows up when someone opens the page,
-- so the same shapes are executed here against the real schema. These assert the
-- queries *run* and stay tenant-scoped; the triage logic on top is unit-tested.
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; m int;
begin
  -- Overdue and blocked tasks in one pass.
  select count(*) filter (where t.due_date < current_date)::int,
         count(*) filter (where exists (
           select 1 from task_dependencies d
           join project_tasks p on p.id = d.depends_on_task_id
           where d.task_id = t.id and p.status <> 'completed' and p.deleted_at is null
         ))::int
    into n, m
    from project_tasks t
   where t.deleted_at is null and t.status <> 'completed';
  raise notice 'PASS: task signal query runs (% overdue, % blocked)', n, m;

  select count(*)::int into n from schedule_items
   where status not in ('complete','canceled') and end_date < current_date;
  raise notice 'PASS: schedule signal query runs (% late)', n;

  select count(*)::int into n from projects p
   where p.deleted_at is null
     and p.status in ('in_progress','punch_list')
     and not exists (
       select 1 from daily_logs l where l.project_id = p.id and l.log_date = current_date
     );
  raise notice 'PASS: missing-log signal query runs (% jobs)', n;

  select count(*)::int into n from leads
   where deleted_at is null and next_follow_up_date < current_date
     and status not in ('won','lost');
  raise notice 'PASS: lead follow-up signal query runs (% overdue)', n;

  select count(*)::int into n from proposals where status in ('sent','viewed');
  raise notice 'PASS: proposal signal query runs (% out)', n;

  select count(*)::int into n from contracts
   where status = 'active' and signed_signature_id is null;
  raise notice 'PASS: unsigned-contract signal query runs (% live)', n;

  select count(*)::int into n from change_orders c
   where c.status in ('approved','incorporated')
     and not exists (select 1 from invoices i where i.change_order_id = c.id);
  raise notice 'PASS: unbilled change-order signal query runs (% unbilled)', n;

  -- The KPI counts.
  select count(*)::int into n from projects
   where deleted_at is null and status not in ('completed','warranty','closed','cancelled');
  select count(*)::int into m from leads where deleted_at is null and status = 'new';
  raise notice 'PASS: KPI count queries run (% active jobs, % new leads)', n, m;

  -- And they stay inside the tenant: org B's project is invisible here, so the
  -- active-job count can never include it.
  select count(*)::int into n from projects;
  if n <> 1 then raise exception 'FAIL: dashboard queries saw % projects, expected 1', n; end if;
  raise notice 'PASS: dashboard aggregates stay inside the tenant';
end $$;

-- ═══════════════════ Financials queries (Task 28) ════════════════════════════
-- The billing-by-job query nests three correlated subqueries over contracts,
-- change orders, and invoices. A wrong column or enum value there only shows up
-- when someone opens the page, so the shape runs here against the real schema.
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; owed numeric;
begin
  -- Aging input: every invoice with its client and project.
  select count(*)::int into n
    from invoices i
    left join clients c on c.id = i.client_id
    left join projects p on p.id = i.project_id;
  raise notice 'PASS: aging input query runs (% invoices)', n;

  -- Billing position per job.
  select count(*)::int into n from (
    select p.id,
      (select c.contract_value from contracts c
         where c.project_id = p.id and c.status <> 'cancelled'
         order by c.created_at desc limit 1) as contract_value,
      coalesce((select sum(co.cost_change) from change_orders co
         where co.project_id = p.id and co.status in ('approved','incorporated')), 0) as co_delta,
      coalesce((select sum(i.total) from invoices i
         where i.project_id = p.id and i.status not in ('draft','void')), 0) as invoiced,
      coalesce((select sum(i.amount_paid) from invoices i
         where i.project_id = p.id and i.status not in ('draft','void')), 0) as paid
    from projects p
    left join clients c on c.id = p.client_id
    where p.deleted_at is null
  ) rows;
  raise notice 'PASS: billing-by-job query runs (% jobs)', n;

  -- Cash received, with refunds subtracting.
  select coalesce(sum(case when pm.is_refund then -pm.amount else pm.amount end), 0)
    into owed from payments pm where pm.payment_date >= current_date - 30;
  raise notice 'PASS: cash-received query runs (net %)', owed;

  -- And the whole lot stays inside the tenant.
  select count(*)::int into n from invoices;
  if n <> 1 then raise exception 'FAIL: financials saw % invoices, expected 1', n; end if;
  raise notice 'PASS: financial queries stay inside the tenant';
end $$;

-- ═══════════════════ Job costing (Task 29) ═══════════════════════════════════
-- Hours feed every margin in the system, so the database derives them rather
-- than trusting a caller, and it refuses to let one person be on two shifts at
-- once. Time is also scoped per-person: someone's hours are their pay.
reset role;
insert into expenses (organization_id, project_id, category, description, amount, expense_date)
  values ('0000000a-0000-4000-8000-000000000001',
          '000e0aaa-0000-4000-8000-000000000001', 'material', 'Tile', 420.50, current_date),
         ('0000000b-0000-4000-8000-000000000002',
          '000e0bbb-0000-4000-8000-000000000002', 'material', 'Other org tile', 99.00, current_date);

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int; derived numeric; entry uuid;
begin
  select count(*)::int into n from expenses;
  if n <> 1 then raise exception 'FAIL: expected 1 expense, saw %', n; end if;
  raise notice 'PASS: cross-org SELECT isolation (expenses)';

  begin
    insert into expenses (organization_id, project_id, description, amount, expense_date)
      values ('0000000b-0000-4000-8000-000000000002',
              '000e0bbb-0000-4000-8000-000000000002', 'Sneaky', 10, current_date);
    raise exception 'FAIL: cross-org expense insert was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org expense insert blocked';
  end;

  begin
    insert into expenses (organization_id, project_id, description, amount, expense_date)
      values ('0000000a-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001', 'Nothing', 0, current_date);
    raise exception 'FAIL: a zero-amount expense was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a zero-amount expense is rejected';
  end;

  begin
    insert into expenses (organization_id, project_id, description, amount, expense_date)
      values ('0000000a-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001', 'Tomorrow', 10, current_date + 1);
    raise exception 'FAIL: a future-dated expense was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: an expense cannot be dated ahead';
  end;

  -- A negative amount is a return or a refund, and must be allowed.
  insert into expenses (organization_id, project_id, description, amount, expense_date)
    values ('0000000a-0000-4000-8000-000000000001',
            '000e0aaa-0000-4000-8000-000000000001', 'Returned trim', -35.00, current_date);
  raise notice 'PASS: a negative expense (a return) is allowed';

  -- Hours are derived, not supplied. The bogus value below is ignored.
  insert into time_entries
    (organization_id, user_id, project_id, clock_in, clock_out, break_minutes, hours)
    values ('0000000a-0000-4000-8000-000000000001',
            '00000aaa-0000-4000-8000-000000000001',
            '000e0aaa-0000-4000-8000-000000000001',
            '2026-08-05T08:00:00Z', '2026-08-05T16:00:00Z', 30, 999)
    returning id into entry;
  select hours into derived from time_entries where id = entry;
  if derived <> 7.5 then raise exception 'FAIL: derived hours were %, expected 7.5', derived; end if;
  raise notice 'PASS: hours are derived by the database, not taken from the caller';

  -- An open shift has no total yet.
  update time_entries set clock_out = null where id = entry;
  select hours into derived from time_entries where id = entry;
  if derived is not null then raise exception 'FAIL: an open shift reported % hours', derived; end if;
  raise notice 'PASS: an open shift has no hours total';

  -- ...and while it is open, a second shift cannot start.
  begin
    insert into time_entries (organization_id, user_id, project_id, clock_in)
      values ('0000000a-0000-4000-8000-000000000001',
              '00000aaa-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001', '2026-08-09T08:00:00Z');
    raise exception 'FAIL: a second shift during an open one was ALLOWED';
  exception when exclusion_violation then
    raise notice 'PASS: an open shift blocks starting another';
  end;

  update time_entries set clock_out = '2026-08-05T16:00:00Z' where id = entry;

  -- Overlapping a closed shift is refused too.
  begin
    insert into time_entries (organization_id, user_id, project_id, clock_in, clock_out)
      values ('0000000a-0000-4000-8000-000000000001',
              '00000aaa-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001',
              '2026-08-05T15:00:00Z', '2026-08-05T18:00:00Z');
    raise exception 'FAIL: an overlapping shift was ALLOWED';
  exception when exclusion_violation then
    raise notice 'PASS: overlapping shifts are rejected';
  end;

  -- Back-to-back is fine: one ends exactly as the next begins.
  insert into time_entries (organization_id, user_id, project_id, clock_in, clock_out)
    values ('0000000a-0000-4000-8000-000000000001',
            '00000aaa-0000-4000-8000-000000000001',
            '000e0aaa-0000-4000-8000-000000000001',
            '2026-08-05T16:00:00Z', '2026-08-05T18:00:00Z');
  raise notice 'PASS: back-to-back shifts are allowed';

  -- A forgotten clock-out is refused rather than inflating the job's cost.
  begin
    insert into time_entries (organization_id, user_id, project_id, clock_in, clock_out)
      values ('0000000a-0000-4000-8000-000000000001',
              '00000aaa-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001',
              '2026-08-10T06:00:00Z', '2026-08-11T06:00:00Z');
    raise exception 'FAIL: a 24-hour shift was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: an implausibly long shift is rejected';
  end;

  begin
    insert into time_entries (organization_id, user_id, project_id, clock_in, clock_out)
      values ('0000000a-0000-4000-8000-000000000001',
              '00000aaa-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001',
              '2026-08-12T16:00:00Z', '2026-08-12T08:00:00Z');
    raise exception 'FAIL: a backwards shift was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a backwards shift is rejected';
  end;
end $$;

-- Someone else's time is not visible to a plain member: hours are pay.
reset role;
insert into users (id, email) values
  ('00000ccc-0000-4000-8000-000000000003', 'carl@org-a.test')
  on conflict do nothing;
insert into organization_members (organization_id, user_id, roles) values
  ('0000000a-0000-4000-8000-000000000001', '00000ccc-0000-4000-8000-000000000003', '{technician}')
  on conflict do nothing;
insert into time_entries (organization_id, user_id, project_id, clock_in, clock_out)
  values ('0000000a-0000-4000-8000-000000000001',
          '00000ccc-0000-4000-8000-000000000003',
          '000e0aaa-0000-4000-8000-000000000001',
          '2026-08-06T08:00:00Z', '2026-08-06T16:00:00Z');

set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000ccc-0000-4000-8000-000000000003","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Carl is a technician: he sees his own entry and nobody else's.
  select count(*)::int into n from time_entries;
  if n <> 1 then raise exception 'FAIL: technician saw % time entries, expected 1', n; end if;
  select count(*)::int into n from time_entries
    where user_id = '00000ccc-0000-4000-8000-000000000003';
  if n <> 1 then raise exception 'FAIL: technician cannot see their own time'; end if;
  raise notice 'PASS: a technician sees only their own time entries';

  -- And cannot log time in somebody else's name.
  begin
    insert into time_entries (organization_id, user_id, project_id, clock_in)
      values ('0000000a-0000-4000-8000-000000000001',
              '00000aaa-0000-4000-8000-000000000001',
              '000e0aaa-0000-4000-8000-000000000001', '2026-08-20T08:00:00Z');
    raise exception 'FAIL: logging time for another user was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: a technician cannot log time for someone else';
  end;
end $$;

-- The owner, who has to cost jobs and run payroll, sees all of it.
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  select count(*)::int into n from time_entries;
  if n < 3 then raise exception 'FAIL: owner saw only % time entries', n; end if;
  raise notice 'PASS: an owner sees the whole org''s time (% entries)', n;
end $$;

-- ═══════════════════ AI Foreman briefing (Task 30) ═══════════════════════════
-- The briefing reads one job across schedule, tasks, logs, invoices, change
-- orders, time and expenses. Every one of those is a raw aggregate, and the unit
-- tests never touch a database, so the shapes run here against the real schema.
-- What is asserted is that they execute and stay tenant-scoped; the judgement
-- built on top of them is unit-tested.
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare
  proj uuid := '000e0aaa-0000-4000-8000-000000000001';
  n int; m int; started date; ended date; w numeric; e numeric; v numeric;
begin
  -- Schedule position: span, overdue count, and span-weighted earned progress.
  select count(*)::int,
         count(*) filter (
           where status not in ('complete','canceled') and end_date < current_date
         )::int,
         min(start_date), max(end_date),
         coalesce(sum(end_date - start_date + 1) filter (where status <> 'canceled'), 0),
         coalesce(sum((end_date - start_date + 1)
           * case when status = 'complete' then 100
                  else coalesce(percent_complete, 0) end / 100.0)
           filter (where status <> 'canceled'), 0)
    into n, m, started, ended, w, e
    from schedule_items where project_id = proj;
  raise notice 'PASS: briefing schedule query runs (% items, % late, weight %, earned %)',
    n, m, w, e;

  -- Open, overdue and blocked field work for the one job.
  select count(*)::int,
         count(*) filter (where due_date < current_date)::int,
         count(*) filter (where exists (
           select 1 from task_dependencies d
           join project_tasks p on p.id = d.depends_on_task_id
           where d.task_id = t.id and p.status <> 'completed' and p.deleted_at is null
         ))::int
    into n, m, v
    from project_tasks t
   where t.project_id = proj and t.deleted_at is null and t.status <> 'completed';
  raise notice 'PASS: briefing task query runs (% open, % overdue, % blocked)', n, m, v;

  select count(*)::int into n from daily_logs where project_id = proj;
  raise notice 'PASS: briefing daily-log query runs (% logs)', n;

  -- Billing position: issued totals, receipts, and what is past due.
  select coalesce(sum(total) filter (where status <> 'draft'), 0),
         coalesce(sum(amount_paid) filter (where status <> 'draft'), 0),
         count(*) filter (
           where status not in ('draft','paid','void') and due_date < current_date
         )::int
    into w, e, n
    from invoices where project_id = proj;
  raise notice 'PASS: briefing invoice query runs (% invoiced, % paid, % overdue)', w, e, n;

  -- Contract value plus approved extras, and the extras never billed. Approved
  -- and incorporated both count, matching countsTowardContract.
  select (select c.contract_value from contracts c
           where c.project_id = proj and c.status = 'active'
           order by c.created_at desc limit 1),
         coalesce(sum(co.cost_change) filter (
           where co.status in ('approved','incorporated')), 0),
         count(*) filter (
           where co.status in ('approved','incorporated')
             and not exists (
               select 1 from invoices i
               where i.change_order_id = co.id and i.status <> 'draft'
             ))::int
    into v, w, n
    from change_orders co where co.project_id = proj;
  raise notice 'PASS: briefing change-order query runs (value %, approved %, % unbilled)',
    v, w, n;

  -- Labour, with each person's rate pulled from their membership.
  select count(*)::int into n from (
    select sum(t.hours) as hours, t.status,
           (select m2.hourly_cost_rate from organization_members m2
             where m2.user_id = t.user_id and m2.organization_id = t.organization_id)
      from time_entries t
     where t.project_id = proj
     group by t.status, t.user_id, t.organization_id
  ) lines;
  raise notice 'PASS: briefing labour query runs (% cost lines)', n;

  -- People on this job with no rate set: their hours cost zero, which flatters
  -- every margin, so the briefing has to be able to count them.
  select count(distinct t.user_id)::int into n
    from time_entries t
   where t.project_id = proj
     and not exists (
       select 1 from organization_members m
       where m.user_id = t.user_id and m.organization_id = t.organization_id
         and m.hourly_cost_rate is not null
     );
  raise notice 'PASS: briefing uncosted-labour query runs (% people)', n;

  select count(*)::int into n from expenses
   where project_id = proj and deleted_at is null;
  raise notice 'PASS: briefing expense query runs (% expenses)', n;

  -- And the whole briefing stays inside the tenant: org B's job is not briefable
  -- from here, so a guessed project id returns nothing rather than another
  -- contractor's numbers.
  select count(*)::int into n from projects where deleted_at is null;
  if n <> 1 then
    raise exception 'FAIL: briefing project list saw % projects, expected 1', n;
  end if;
  raise notice 'PASS: briefing project list stays inside the tenant';
end $$;

-- ═══════════════════ Google connections (Task 31) ════════════════════════════
-- A row holds an encrypted refresh token — a credential that can send mail as
-- its owner. The rules proven here: only the person themselves may create or
-- alter their connection; an owner may see who is connected but write nothing;
-- other organisations see nothing; and the database refuses a connection that
-- grants no scopes or is revoked before it began.
reset role;
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Permitted path: Alice connects her own Google account.
  insert into google_connections
    (id, organization_id, user_id, google_email, scopes, refresh_token_ciphertext)
  values ('000c0aaa-0000-4000-8000-000000000001',
          '0000000a-0000-4000-8000-000000000001',
          '00000aaa-0000-4000-8000-000000000001',
          'alice@org-a.test',
          array['https://www.googleapis.com/auth/gmail.send',
                'https://www.googleapis.com/auth/calendar.events'],
          'v1.aaaa.bbbb.cccc');
  raise notice 'PASS: a member can store their own Google connection';

  -- Even the owner cannot create a connection in someone else's name.
  begin
    insert into google_connections
      (organization_id, user_id, google_email, scopes, refresh_token_ciphertext)
    values ('0000000a-0000-4000-8000-000000000001',
            '00000ccc-0000-4000-8000-000000000003',
            'carl@org-a.test',
            array['https://www.googleapis.com/auth/gmail.send'],
            'v1.x.y.z');
    raise exception 'FAIL: owner stored a connection for another user — was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: nobody can store a Google connection for someone else, not even an owner';
  end;

  -- No scopes, no connection.
  begin
    insert into google_connections
      (organization_id, user_id, google_email, scopes, refresh_token_ciphertext)
    values ('0000000a-0000-4000-8000-000000000001',
            '00000aaa-0000-4000-8000-000000000001',
            'alice-two@org-a.test', '{}', 'v1.x.y.z');
    raise exception 'FAIL: a connection with no granted scopes was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a Google connection granting no scopes is refused';
  when unique_violation then
    raise exception 'FAIL: uniqueness fired before the scopes check — test ordering is wrong';
  end;

  -- Cannot be revoked before it was connected.
  begin
    update google_connections
       set revoked_at = connected_at - interval '1 hour'
     where id = '000c0aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: revoked_at earlier than connected_at was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a connection cannot be revoked before it began';
  end;

  -- One connection per person per organisation.
  begin
    insert into google_connections
      (organization_id, user_id, google_email, scopes, refresh_token_ciphertext)
    values ('0000000a-0000-4000-8000-000000000001',
            '00000aaa-0000-4000-8000-000000000001',
            'alice-again@org-a.test',
            array['https://www.googleapis.com/auth/gmail.send'], 'v1.x.y.z');
    raise exception 'FAIL: a second connection for the same person was ALLOWED';
  exception when unique_violation then
    raise notice 'PASS: one Google connection per person per organisation';
  end;
end $$;

-- Carl (Org A, not an administrator) connects his own and sees only his own.
reset role;
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000ccc-0000-4000-8000-000000000003","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  insert into google_connections
    (id, organization_id, user_id, google_email, scopes, refresh_token_ciphertext)
  values ('000c0ccc-0000-4000-8000-000000000003',
          '0000000a-0000-4000-8000-000000000001',
          '00000ccc-0000-4000-8000-000000000003',
          'carl@org-a.test',
          array['https://www.googleapis.com/auth/calendar.events'],
          'v1.cccc.dddd.eeee');

  select count(*)::int into n from google_connections;
  if n <> 1 then raise exception 'FAIL: non-admin saw % Google connections, expected only their own', n; end if;
  select count(*)::int into n from google_connections
    where user_id = '00000ccc-0000-4000-8000-000000000003';
  if n <> 1 then raise exception 'FAIL: a member cannot see their own Google connection'; end if;
  raise notice 'PASS: a non-administrator sees only their own Google connection';

  -- Carl "revoking" Alice's connection touches nothing — the row is invisible
  -- to him, so the update matches zero rows rather than erroring.
  update google_connections set revoked_at = now()
    where id = '000c0aaa-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member altered someone else''s connection (% rows)', n; end if;
  raise notice 'PASS: a member cannot revoke anyone else''s Google connection';

  -- Permitted path: revoking one's own.
  update google_connections set revoked_at = now()
    where id = '000c0ccc-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: a member could not revoke their own connection'; end if;
  raise notice 'PASS: a member can revoke their own Google connection';
end $$;

-- Alice (owner) sees the whole team's connections — but the admin policy is
-- read-only, so she still cannot touch Carl's row.
reset role;
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  select count(*)::int into n from google_connections;
  if n <> 2 then raise exception 'FAIL: owner saw % Google connections, expected 2', n; end if;
  raise notice 'PASS: an owner can see which team members have connected Google';

  update google_connections set google_email = 'hijacked@evil.test'
    where id = '000c0ccc-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: owner modified another member''s connection (% rows)', n; end if;
  raise notice 'PASS: the administrator view of Google connections is read-only';
end $$;

-- Another organisation sees nothing at all.
reset role;
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000bbb-0000-4000-8000-000000000002","org":"0000000b-0000-4000-8000-000000000002"}',
  false);

do $$
declare n int;
begin
  select count(*)::int into n from google_connections;
  if n <> 0 then raise exception 'FAIL: another organisation saw % Google connections', n; end if;
  raise notice 'PASS: Google connections are invisible across organisations';
end $$;

-- ═══════════════════ Email log (Task 32) ═════════════════════════════════════
-- "Did the client get the invoice, and when" is only worth answering if the
-- answer cannot be rewritten. Proven here: an attempt can be recorded; a row
-- must be honest about its own outcome; nothing can be updated or deleted by
-- any role; other organisations see nothing.
reset role;
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000aaa-0000-4000-8000-000000000001","org":"0000000a-0000-4000-8000-000000000001"}',
  false);

do $$
declare n int;
begin
  -- Permitted path: a successful send is recorded.
  insert into email_log
    (id, organization_id, sent_by, kind, related_id, provider, provider_message_id,
     from_address, to_addresses, subject, status, sent_at)
  values ('000e0aaa-0000-4000-8000-000000000001',
          '0000000a-0000-4000-8000-000000000001',
          '00000aaa-0000-4000-8000-000000000001',
          'proposal', '00000000-0000-4000-8000-000000000001', 'gmail', 'gm-1',
          'alice@org-a.test', array['client@example.test'],
          'Proposal PRO-1 from Org A', 'sent', now());
  raise notice 'PASS: a sent email is recorded';

  -- A failure is recorded too, with its reason.
  insert into email_log
    (organization_id, sent_by, kind, provider, from_address, to_addresses, subject,
     status, error)
  values ('0000000a-0000-4000-8000-000000000001',
          '00000aaa-0000-4000-8000-000000000001',
          'invoice', 'resend', 'no-reply@org-a.test', array['client@example.test'],
          'Invoice INV-1', 'failed', 'Gmail refused the message.');
  raise notice 'PASS: a failed attempt is recorded with its reason';

  -- A "sent" row without a timestamp is a guess; refused.
  begin
    insert into email_log
      (organization_id, kind, provider, from_address, to_addresses, subject, status)
    values ('0000000a-0000-4000-8000-000000000001', 'invoice', 'gmail',
            'a@org-a.test', array['c@example.test'], 'x', 'sent');
    raise exception 'FAIL: a sent row with no sent_at was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a sent row must say when';
  end;

  -- A "failed" row without a reason is equally a guess; refused.
  begin
    insert into email_log
      (organization_id, kind, provider, from_address, to_addresses, subject, status)
    values ('0000000a-0000-4000-8000-000000000001', 'invoice', 'gmail',
            'a@org-a.test', array['c@example.test'], 'x', 'failed');
    raise exception 'FAIL: a failed row with no error was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: a failed row must say why';
  end;

  -- Unknown kinds, providers, and statuses are refused.
  begin
    insert into email_log
      (organization_id, kind, provider, from_address, to_addresses, subject, status, sent_at)
    values ('0000000a-0000-4000-8000-000000000001', 'newsletter', 'gmail',
            'a@org-a.test', array['c@example.test'], 'x', 'sent', now());
    raise exception 'FAIL: an unknown email kind was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: an email of unknown kind is refused';
  end;

  -- Nobody to send to is not an email.
  begin
    insert into email_log
      (organization_id, kind, provider, from_address, to_addresses, subject, status, sent_at)
    values ('0000000a-0000-4000-8000-000000000001', 'invoice', 'gmail',
            'a@org-a.test', '{}', 'x', 'sent', now());
    raise exception 'FAIL: an email with no recipients was ALLOWED';
  exception when check_violation then
    raise notice 'PASS: an email with no recipients is refused';
  end;

  -- Append-only: the record of a send cannot be altered afterward.
  begin
    update email_log set status = 'failed', error = 'rewritten'
      where id = '000e0aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: updating an email log row was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: an email log row cannot be updated';
  end;

  begin
    delete from email_log where id = '000e0aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: deleting an email log row was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: an email log row cannot be deleted';
  end;

  select count(*)::int into n from email_log;
  if n <> 2 then raise exception 'FAIL: expected 2 email log rows, saw %', n; end if;
end $$;

-- The append-only rule holds for the table owner too — the role the app
-- actually connects as, which bypasses RLS entirely.
reset role;
do $$
begin
  begin
    delete from email_log where id = '000e0aaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: the owning role deleted an email log row — was ALLOWED';
  exception when restrict_violation then
    raise notice 'PASS: even the app''s own role cannot delete an email log row';
  end;
end $$;

-- Another organisation sees nothing and can write nothing.
set role app_user;
select set_config('request.jwt.claims',
  '{"sub":"00000bbb-0000-4000-8000-000000000002","org":"0000000b-0000-4000-8000-000000000002"}',
  false);

do $$
declare n int;
begin
  select count(*)::int into n from email_log;
  if n <> 0 then raise exception 'FAIL: another organisation saw % email log rows', n; end if;
  raise notice 'PASS: the email log is invisible across organisations';

  begin
    insert into email_log
      (organization_id, kind, provider, from_address, to_addresses, subject, status, sent_at)
    values ('0000000a-0000-4000-8000-000000000001', 'invoice', 'gmail',
            'bob@org-b.test', array['c@example.test'], 'x', 'sent', now());
    raise exception 'FAIL: writing into another organisation''s email log was ALLOWED';
  exception when insufficient_privilege then
    raise notice 'PASS: nobody can write into another organisation''s email log';
  end;
end $$;

reset role;
select 'ALL RLS ASSERTIONS PASSED' as result;
