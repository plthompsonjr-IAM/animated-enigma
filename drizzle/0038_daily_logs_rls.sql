-- Task 25: the edit window, revision history, and tenant RLS for daily logs.
--
-- A daily log is the contemporaneous record that decides delay claims and
-- disputes. Its evidentiary value comes from having been written that day, so
-- three things are enforced by the database rather than trusted to the app:
--
--   1. A log can never be dated in the future. It records work, not intent.
--   2. `editable_until` is set on insert, not supplied by the caller, and content
--      changes are rejected once it passes. Corrections then go in a later log —
--      the record is never rewritten.
--   3. Every content edit inside the window snapshots the previous version to
--      daily_log_revisions first, so the history exists whether or not the app
--      remembers to write it. Revisions are append-only for every role,
--      including the app's BYPASSRLS role: a bug or a stolen app credential
--      still cannot quietly rewrite the jobsite record.

alter table daily_logs
  add constraint daily_logs_not_future check (log_date <= current_date);

-- The window runs to the end of the day after the log's day: late enough that a
-- foreman writing it up next morning isn't fighting the app, short enough that
-- the log stays contemporaneous. Computed here so no caller can widen it.
--
-- The date cast resolves in the database's timezone (UTC), so in Ohio the window
-- closes late evening the following day rather than at local midnight. That is
-- deliberate: erring toward the shorter window keeps the record contemporaneous,
-- and a log written the next morning is still comfortably inside it.
create or replace function daily_logs_set_edit_window() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.editable_until := (new.log_date + 2)::timestamptz;
  return new;
end;
$$;

create trigger daily_logs_edit_window
  before insert on daily_logs
  for each row execute function daily_logs_set_edit_window();

create or replace function daily_logs_guard_and_snapshot() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  content_changed boolean;
begin
  if tg_op = 'DELETE' then
    if old.editable_until is not null and now() >= old.editable_until then
      raise exception
        'the daily log for % is part of the project record and cannot be deleted',
        old.log_date
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  content_changed :=
    new.crew_present is distinct from old.crew_present
    or new.subs_present is distinct from old.subs_present
    or new.work_completed is distinct from old.work_completed
    or new.materials_delivered is distinct from old.materials_delivered
    or new.equipment_used is distinct from old.equipment_used
    or new.weather is distinct from old.weather
    or new.delays is distinct from old.delays
    or new.problems is distinct from old.problems
    or new.client_conversations is distinct from old.client_conversations
    or new.safety_incidents is distinct from old.safety_incidents
    or new.inspection_activity is distinct from old.inspection_activity
    or new.work_planned_tomorrow is distinct from old.work_planned_tomorrow
    or new.log_date is distinct from old.log_date
    or new.project_id is distinct from old.project_id
    or new.organization_id is distinct from old.organization_id;

  if not content_changed then
    return new;
  end if;

  if old.editable_until is null or now() >= old.editable_until then
    raise exception
      'the daily log for % is locked; record the correction in a later log',
      old.log_date
      using errcode = 'restrict_violation';
  end if;

  -- The window cannot be extended by an update.
  new.editable_until := old.editable_until;

  insert into public.daily_log_revisions
    (organization_id, daily_log_id, snapshot, edited_by)
    values (old.organization_id, old.id, to_jsonb(old), old.created_by);

  return new;
end;
$$;

create trigger daily_logs_guard
  before update or delete on daily_logs
  for each row execute function daily_logs_guard_and_snapshot();

create trigger daily_logs_set_updated_at before update on daily_logs
  for each row execute function set_updated_at();

-- A revision is evidence of what the log said before. Append-only for every
-- role, enforced with no exception for the application's privileged connection.
create or replace function daily_log_revisions_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'daily log revisions are append-only and cannot be % ', lower(tg_op)
    using errcode = 'restrict_violation';
end;
$$;

create trigger daily_log_revisions_immutable
  before update or delete on daily_log_revisions
  for each row execute function daily_log_revisions_append_only();

do $$
declare t text;
begin
  foreach t in array array['daily_logs','daily_log_revisions']
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
