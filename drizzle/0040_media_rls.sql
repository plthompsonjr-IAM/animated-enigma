-- Task 26: constraints, updated_at triggers, and tenant RLS for photos and
-- documents.
--
-- The bytes live in a *private* Supabase Storage bucket; these tables hold the
-- metadata and the access decisions. Two rules the database enforces:
--
--   1. Every storage path is namespaced to its owning organisation
--      (`orgs/<organization_id>/…`). The application builds paths this way, and
--      this constraint means a bug that builds one wrongly fails loudly at the
--      write rather than quietly filing a tenant's file under another's prefix.
--   2. Sizes are never negative.
--
-- `client_visible` defaults to false everywhere: a photo of an open wall or a
-- damaged subfloor is an internal record until somebody decides otherwise.

alter table photos
  add constraint photos_path_org_scoped
  check (storage_path like 'orgs/' || organization_id::text || '/%');

alter table photos
  add constraint photos_size_nonnegative
  check (size_bytes is null or size_bytes >= 0);

alter table documents
  add constraint documents_path_org_scoped
  check (storage_path like 'orgs/' || organization_id::text || '/%');

alter table documents
  add constraint documents_size_nonnegative
  check (size_bytes is null or size_bytes >= 0);

create trigger photos_set_updated_at before update on photos
  for each row execute function set_updated_at();
create trigger documents_set_updated_at before update on documents
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['photos','documents']
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
