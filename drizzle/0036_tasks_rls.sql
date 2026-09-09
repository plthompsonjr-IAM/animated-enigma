-- Task 24: integrity constraints, updated_at trigger, and tenant RLS for field
-- tasks, their dependencies, and their checklists.
--
-- What the database guarantees so no query or form has to defend against it:
--   1. due_date is never before start_date when both are set.
--   2. Hours are never negative.
--   3. A dependency never points at itself, nor at a task on another project.
--   4. completed_at and status agree — a completed task has a completion time and
--      an open one does not, so "when was this finished" is always answerable.
-- Dependency *cycles* (a → b → a) are checked in the app, where the resulting
-- message can name the tasks involved.

alter table project_tasks
  add constraint project_tasks_dates_ordered
  check (start_date is null or due_date is null or due_date >= start_date);

alter table project_tasks
  add constraint project_tasks_hours_nonnegative
  check ((estimated_hours is null or estimated_hours >= 0)
     and (actual_hours is null or actual_hours >= 0));

alter table task_dependencies
  add constraint task_dependencies_not_self check (task_id <> depends_on_task_id);

-- Keep completed_at in step with the status rather than trusting every caller to
-- set it. A task that goes back to rework loses its completion time.
create or replace function project_tasks_sync_completion() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger project_tasks_completion_sync
  before insert or update on project_tasks
  for each row execute function project_tasks_sync_completion();

create or replace function task_dependencies_check_project() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  task_project uuid;
  predecessor_project uuid;
begin
  select t.project_id into task_project
    from public.project_tasks t where t.id = new.task_id;
  select t.project_id into predecessor_project
    from public.project_tasks t where t.id = new.depends_on_task_id;

  if task_project is distinct from predecessor_project then
    raise exception 'a task can only depend on another task on the same project'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger task_dependencies_project_guard
  before insert or update on task_dependencies
  for each row execute function task_dependencies_check_project();

create trigger project_tasks_set_updated_at before update on project_tasks
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['project_tasks','task_dependencies','task_checklist_items']
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
