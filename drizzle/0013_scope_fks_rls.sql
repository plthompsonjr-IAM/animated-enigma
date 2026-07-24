-- Task 13: deferred pointer FKs, updated_at triggers, and tenant RLS for the
-- versioned scope-of-work tables (docs/database-schema.md §4.4).

-- Deferred FKs: scopes → its current/approved version (circular at DDL time).
alter table scopes
  add constraint scopes_current_version_fk
  foreign key (current_version_id) references scope_versions(id);
alter table scopes
  add constraint scopes_approved_version_fk
  foreign key (approved_version_id) references scope_versions(id);

-- updated_at maintenance (scope_versions/sections/items are insert-only).
create trigger scopes_set_updated_at before update on scopes
  for each row execute function set_updated_at();

-- Tenant RLS: a row is visible/writable only to members of its organization.
do $$
declare t text;
begin
  foreach t in array array['scopes','scope_versions','scope_sections','scope_items']
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
