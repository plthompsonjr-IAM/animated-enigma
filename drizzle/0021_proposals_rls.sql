-- Task 17: deferred pointer FK, updated_at trigger, and tenant RLS for the
-- proposal tables. The public client view reads a proposal_version by its
-- secure-link token through the server (postgres/service role), so RLS here is
-- the internal tenant boundary only.

-- Deferred FK: proposals → its current version (circular at DDL time).
alter table proposals
  add constraint proposals_current_version_fk
  foreign key (current_version_id) references proposal_versions(id);

create trigger proposals_set_updated_at before update on proposals
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['proposals','proposal_versions','proposal_events']
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
