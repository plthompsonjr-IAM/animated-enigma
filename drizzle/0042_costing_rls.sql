-- Task 29: integrity rules, derived hours, overlap prevention, and RLS for job
-- costing.
--
-- Three things the database owns here:
--
--   1. `hours` is derived, never supplied. A trigger computes it from the clock
--      pair less breaks, so the figure every margin depends on cannot disagree
--      with the times it came from.
--   2. A person cannot be on two shifts at once. A GiST exclusion constraint
--      enforces it, with an open shift treated as running to infinity — so you
--      can't start a second one while the first is still going. Rejected entries
--      are excluded: a corrected mistake shouldn't block the replacement.
--   3. Time entries are scoped tighter than everything else in this system. The
--      tenant policy is the floor; on top of it, a technician sees only their own
--      time. Everyone's pay is inferable from their hours, so the default is not
--      "anyone in the org".

create extension if not exists btree_gist with schema extensions;

alter table time_entries
  add constraint time_entries_break_nonnegative check (break_minutes >= 0);

alter table time_entries
  add constraint time_entries_clock_order
  check (clock_out is null or clock_in is null or clock_out > clock_in);

-- No clock pair longer than 16 hours: past that it's a forgotten clock-out, not
-- a shift, and it would silently inflate the job's labour cost.
alter table time_entries
  add constraint time_entries_shift_length
  check (
    clock_out is null or clock_in is null
    or clock_out <= clock_in + interval '16 hours'
  );

-- One person, one shift at a time.
alter table time_entries
  add constraint time_entries_no_overlap
  exclude using gist (
    user_id with =,
    tstzrange(clock_in, coalesce(clock_out, 'infinity')) with &&
  ) where (clock_in is not null and status <> 'rejected');

create or replace function time_entries_derive_hours() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  gross interval;
  net_hours numeric;
begin
  if new.clock_in is null or new.clock_out is null then
    new.hours := null;
    return new;
  end if;

  gross := new.clock_out - new.clock_in;
  net_hours := extract(epoch from gross) / 3600.0
               - (coalesce(new.break_minutes, 0)::numeric / 60.0);
  new.hours := greatest(0, round(net_hours, 4));
  return new;
end;
$$;

create trigger time_entries_hours
  before insert or update on time_entries
  for each row execute function time_entries_derive_hours();

create trigger time_entries_set_updated_at before update on time_entries
  for each row execute function set_updated_at();

alter table expenses
  add constraint expenses_amount_nonzero check (amount <> 0);

alter table expenses
  add constraint expenses_not_future check (expense_date <= current_date);

create trigger expenses_set_updated_at before update on expenses
  for each row execute function set_updated_at();

alter table time_entries enable row level security;
alter table time_entries force row level security;
alter table expenses enable row level security;
alter table expenses force row level security;

-- Expenses follow the ordinary tenant boundary.
create policy expenses_tenant on expenses
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));

-- Time is tenant-scoped AND person-scoped. Someone's hours are their pay, so a
-- technician sees only their own; the roles that have to run payroll and cost a
-- job see all of it.
create policy time_entries_own_or_privileged on time_entries
  using (
    organization_id = current_org()
    and is_member_of(organization_id)
    and (
      user_id = auth.uid()
      or has_role(organization_id, 'owner')
      or has_role(organization_id, 'office_manager')
      or has_role(organization_id, 'project_manager')
    )
  )
  with check (
    organization_id = current_org()
    and is_member_of(organization_id)
    and (
      user_id = auth.uid()
      or has_role(organization_id, 'owner')
      or has_role(organization_id, 'office_manager')
      or has_role(organization_id, 'project_manager')
    )
  );
