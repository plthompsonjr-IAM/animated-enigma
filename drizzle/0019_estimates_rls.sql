-- Task 16: updated_at triggers and tenant RLS for the estimating tables.
-- Standard tenant boundary — a row is visible/writable only to members of its
-- organization. Role-level cost/margin visibility is enforced in the UI/service
-- tier (field roles never see money), not in RLS.

create trigger estimate_versions_set_updated_at before update on estimate_versions
  for each row execute function set_updated_at();
create trigger estimate_line_items_set_updated_at before update on estimate_line_items
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['estimate_versions','estimate_line_items']
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
