-- Task 8: deferred FK, updated_at triggers, and row-level security for the CRM
-- domain (leads, lead_activities, clients, properties, projects).
-- Design source: docs/database-schema.md §4.2, §4.3, §8.

-- Deferred FK: leads.converted_project_id → projects.id (circular at DDL time).
alter table leads
  add constraint leads_converted_project_fk
  foreign key (converted_project_id) references projects(id);

-- ── updated_at maintenance ────────────────────────────────────────────────────
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();
create trigger properties_set_updated_at before update on properties
  for each row execute function set_updated_at();
create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();
create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at();

-- ── Row-level security ───────────────────────────────────────────────────────
-- Baseline: a row is visible/writable only within the caller's active org
-- (current_org()), and only to members of that org (is_member_of). This is the
-- hard tenant boundary; role- and assignment-level rules layer on top in the
-- service/UI tier and in later tasks (e.g. field roles never see costs).

do $$
declare t text;
begin
  foreach t in array array['clients','properties','leads','lead_activities','projects']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;
