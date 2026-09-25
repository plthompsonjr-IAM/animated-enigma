-- Task 14: updated_at trigger and RLS for scope_templates. Unlike the other
-- tenant tables, a template may be platform-global (organization_id is null),
-- readable by every org but writable by none through the app. Org-scoped rows
-- follow the usual tenant boundary.

create trigger scope_templates_set_updated_at before update on scope_templates
  for each row execute function set_updated_at();

alter table scope_templates enable row level security;
alter table scope_templates force row level security;

-- Read: your own org's templates, plus global (null-org) templates.
create policy scope_templates_read on scope_templates for select
  using (
    organization_id is null
    or (organization_id = current_org() and is_member_of(organization_id))
  );

-- Write: only your own org's templates (never global, never another org).
create policy scope_templates_insert on scope_templates for insert
  with check (organization_id = current_org() and is_member_of(organization_id));
create policy scope_templates_update on scope_templates for update
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));
create policy scope_templates_delete on scope_templates for delete
  using (organization_id = current_org() and is_member_of(organization_id));
