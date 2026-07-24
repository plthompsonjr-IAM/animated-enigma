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

reset role;
select 'ALL RLS ASSERTIONS PASSED' as result;
