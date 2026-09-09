-- Task 21: updated_at trigger, tenant RLS, and approval freezing for change
-- orders.
--
-- Once the client has approved a change order it is evidence of an agreement,
-- so its money, schedule impact, and client-facing explanation are frozen. The
-- status may still advance (approved → incorporated) and the approval
-- bookkeeping may be written, but the substance is settled: a further revision
-- is a new change order, not an edit to this one. Items follow their parent.

create trigger change_orders_set_updated_at before update on change_orders
  for each row execute function set_updated_at();

create or replace function change_orders_freeze_after_approval() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status in ('approved', 'incorporated', 'canceled') then
    if new.cost_change is distinct from old.cost_change
       or new.schedule_change_days is distinct from old.schedule_change_days
       or new.client_explanation is distinct from old.client_explanation
       or new.change_order_number is distinct from old.change_order_number
       or new.project_id is distinct from old.project_id
       or new.contract_id is distinct from old.contract_id
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'change order % is % and its terms are frozen; raise a new change order instead',
        old.change_order_number, old.status
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger change_orders_freeze before update on change_orders
  for each row execute function change_orders_freeze_after_approval();

create or replace function change_order_items_follow_parent() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  parent_status text;
begin
  select co.status::text into parent_status
    from public.change_orders co
    where co.id = coalesce(new.change_order_id, old.change_order_id);

  if parent_status is not null
     and parent_status not in ('draft', 'internal_review') then
    raise exception 'change order line items are locked once the change order is %', parent_status
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger change_order_items_locked
  before insert or update or delete on change_order_items
  for each row execute function change_order_items_follow_parent();

do $$
declare t text;
begin
  foreach t in array array['change_orders','change_order_items']
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
