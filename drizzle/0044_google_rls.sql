-- Task 31: integrity rules and RLS for stored Google Workspace connections.
--
-- A row here holds an encrypted refresh token — a long-lived credential that
-- can send mail as its owner. So this table is scoped tighter than the ordinary
-- tenant boundary, the same way time_entries is:
--
--   1. A person may create, read, update, and revoke ONLY their own connection.
--      Nobody — not an owner — may insert or alter someone else's. The token is
--      theirs; the consent screen was theirs.
--   2. An owner or office manager may additionally SEE who on the team has
--      connected (to answer "why isn't Carl's calendar syncing"), but the
--      application never selects the ciphertext column on that path. Row-level
--      security decides which rows; the queries decide which columns.
--   3. A connection with no granted scopes is refused outright. If someone
--      unticks both boxes on the consent screen, there is nothing to store and
--      storing an empty grant would look like a working connection.

alter table google_connections
  add constraint google_connections_has_scopes
  check (coalesce(array_length(scopes, 1), 0) > 0);

alter table google_connections
  add constraint google_connections_email_present
  check (char_length(google_email) > 0);

-- A connection cannot be revoked before it existed.
alter table google_connections
  add constraint google_connections_revoked_after_connected
  check (revoked_at is null or revoked_at >= connected_at);

create trigger google_connections_set_updated_at before update on google_connections
  for each row execute function set_updated_at();

alter table google_connections enable row level security;
alter table google_connections force row level security;

-- Own row: everything.
create policy google_connections_own on google_connections
  using (
    organization_id = current_org()
    and is_member_of(organization_id)
    and user_id = auth.uid()
  )
  with check (
    organization_id = current_org()
    and is_member_of(organization_id)
    and user_id = auth.uid()
  );

-- Administrators: read-only visibility across the team. Deliberately no
-- `with check` clause — this policy grants no write path to anyone else's row.
create policy google_connections_admin_read on google_connections
  for select
  using (
    organization_id = current_org()
    and is_member_of(organization_id)
    and (
      has_role(organization_id, 'owner')
      or has_role(organization_id, 'office_manager')
    )
  );
