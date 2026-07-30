-- Task 23: integrity constraints, updated_at trigger, and tenant RLS for the
-- project schedule.
--
-- Three things the database guarantees so no query or form has to defend
-- against them:
--   1. end_date is never before start_date, so a range is always usable.
--   2. percent_complete is always 0–100.
--   3. A dependency never points at a work item on a different project (nor at
--      itself) — a predecessor on someone else's job is meaningless, and a
--      self-dependency is an infinite chain.
-- Deeper dependency cycles (a → b → a) are checked in the app, where the
-- resulting message can name the items involved.

alter table schedule_items
  add constraint schedule_items_dates_ordered check (end_date >= start_date);

alter table schedule_items
  add constraint schedule_items_percent_bounds
  check (percent_complete between 0 and 100);

-- Self-reference, declared here rather than in Drizzle to avoid a circular
-- table definition. Clearing rather than cascading: losing a predecessor should
-- orphan the dependency, not delete the successor's work.
alter table schedule_items
  add constraint schedule_items_depends_on_id_fk
  foreign key (depends_on_id) references schedule_items(id) on delete set null;

create or replace function schedule_items_check_dependency() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  predecessor_project uuid;
begin
  if new.depends_on_id is null then
    return new;
  end if;

  if new.depends_on_id = new.id then
    raise exception 'a work item cannot depend on itself'
      using errcode = 'restrict_violation';
  end if;

  select s.project_id into predecessor_project
    from public.schedule_items s
    where s.id = new.depends_on_id;

  if predecessor_project is distinct from new.project_id then
    raise exception 'a work item can only depend on another item on the same project'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger schedule_items_dependency_guard
  before insert or update on schedule_items
  for each row execute function schedule_items_check_dependency();

create trigger schedule_items_set_updated_at before update on schedule_items
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['schedule_items','schedule_assignments']
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
