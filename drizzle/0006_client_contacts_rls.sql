-- Task 9: RLS + updated_at for client_contacts, and trigram indexes for
-- client search / duplicate detection (docs/database-schema.md §4.2, §7, §8).

create trigger client_contacts_set_updated_at before update on client_contacts
  for each row execute function set_updated_at();

alter table client_contacts enable row level security;
alter table client_contacts force row level security;
create policy client_contacts_tenant on client_contacts
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));

-- Fuzzy search + duplicate detection (§7): pg_trgm accelerates the ILIKE
-- lookups on client name/email and property street address.
create extension if not exists pg_trgm;
create index if not exists clients_display_name_trgm_idx
  on clients using gin (display_name gin_trgm_ops);
create index if not exists clients_primary_email_trgm_idx
  on clients using gin (primary_email gin_trgm_ops);
create index if not exists properties_address_line1_trgm_idx
  on properties using gin ((address->>'line1') gin_trgm_ops);
