-- Task 19: tenant RLS plus append-only enforcement for e-signature records.
--
-- A signature is legal evidence. Beyond the tenant boundary, the table is
-- write-once: UPDATE and DELETE are rejected at the database level for every
-- role (including the app's postgres role, which has BYPASSRLS), so a bug or a
-- compromised app credential still cannot rewrite a signed approval.

-- search_path is pinned empty: the body references no schema objects, and a
-- mutable search_path on a trigger function is an injection foothold.
create or replace function signatures_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'signatures are append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger signatures_no_update before update on signatures
  for each row execute function signatures_append_only();

create trigger signatures_no_delete before delete on signatures
  for each row execute function signatures_append_only();

alter table signatures enable row level security;
alter table signatures force row level security;

create policy signatures_tenant on signatures
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));
