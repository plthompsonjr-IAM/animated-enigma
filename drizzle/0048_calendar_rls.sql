-- Task 33: integrity rules and RLS for calendar mirrors.
--
-- A row here says "this app record is event X on this person's Google
-- Calendar". It holds no credential, but it is scoped the same way as the
-- connection whose token created it: a mirror belongs to the person whose
-- calendar it is on. The app never uses one member's token to act for another,
-- so nobody else has any business updating or deleting the pairing either.
--
--   1. A person may create, read, update, and delete ONLY their own mirrors.
--   2. An owner or office manager may additionally SEE the team's mirrors, to
--      answer "is that visit on Carl's calendar" — read-only, no write path.
--   3. The source kind and provider are closed lists, and an event id is never
--      blank: a row that names no event would look like a working mirror.

alter table calendar_events
  add constraint calendar_events_kind_known
  check (source_kind in ('site_visit', 'schedule_item'));

alter table calendar_events
  add constraint calendar_events_provider_known
  check (provider in ('google'));

alter table calendar_events
  add constraint calendar_events_has_event
  check (char_length(external_event_id) > 0);

create trigger calendar_events_set_updated_at before update on calendar_events
  for each row execute function set_updated_at();

alter table calendar_events enable row level security;
alter table calendar_events force row level security;

-- Own rows: everything.
create policy calendar_events_own on calendar_events
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
create policy calendar_events_admin_read on calendar_events
  for select
  using (
    organization_id = current_org()
    and is_member_of(organization_id)
    and (
      has_role(organization_id, 'owner')
      or has_role(organization_id, 'office_manager')
    )
  );
