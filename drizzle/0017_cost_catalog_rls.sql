-- Task 15: updated_at trigger and RLS for the cost catalog. Like scope
-- templates, a catalog item (and its price history) may be platform-global
-- (organization_id is null): readable by every org, writable by none through
-- the app. Org-scoped rows follow the usual tenant boundary.

create trigger cost_catalog_items_set_updated_at before update on cost_catalog_items
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['cost_catalog_items','catalog_price_history']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- Read: your own org's rows plus global (null-org) rows.
    execute format($f$
      create policy %1$s_read on %1$I for select
        using (
          organization_id is null
          or (organization_id = current_org() and is_member_of(organization_id))
        )
    $f$, t);
    -- Write: only your own org's rows.
    execute format($f$
      create policy %1$s_insert on %1$I for insert
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
    execute format($f$
      create policy %1$s_update on %1$I for update
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
    execute format($f$
      create policy %1$s_delete on %1$I for delete
        using (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;
