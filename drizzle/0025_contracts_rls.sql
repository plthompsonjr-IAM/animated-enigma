-- Task 20: updated_at triggers, tenant RLS, and financial-integrity freezing
-- for contracts and their payment schedules.
--
-- A contract is binding once active. Rather than trusting every future code
-- path, the database refuses to change the money, the linkage, or the identity
-- of a non-draft contract. Status may still advance (active → completed /
-- cancelled) and the signature/lock bookkeeping may be written, but the value,
-- project, proposal, and number are settled. Corrections become change orders.

create trigger contracts_set_updated_at before update on contracts
  for each row execute function set_updated_at();
create trigger payment_schedules_set_updated_at before update on payment_schedules
  for each row execute function set_updated_at();
create trigger payment_milestones_set_updated_at before update on payment_milestones
  for each row execute function set_updated_at();

create or replace function contracts_freeze_when_active() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    if new.contract_value is distinct from old.contract_value
       or new.project_id is distinct from old.project_id
       or new.proposal_id is distinct from old.proposal_id
       or new.contract_number is distinct from old.contract_number
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'contract % is % and its terms are frozen; issue a change order instead',
        old.contract_number, old.status
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger contracts_freeze before update on contracts
  for each row execute function contracts_freeze_when_active();

-- Payment terms follow the contract: no edits once it leaves draft.
create or replace function payment_terms_follow_contract() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  target_contract uuid;
  contract_status_value text;
begin
  if tg_table_name = 'payment_schedules' then
    target_contract := coalesce(new.contract_id, old.contract_id);
  else
    select s.contract_id into target_contract
      from public.payment_schedules s
      where s.id = coalesce(new.payment_schedule_id, old.payment_schedule_id);
  end if;

  select c.status::text into contract_status_value
    from public.contracts c where c.id = target_contract;

  if contract_status_value is not null and contract_status_value <> 'draft' then
    raise exception 'payment terms are frozen once the contract is %', contract_status_value
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payment_schedules_frozen
  before insert or update or delete on payment_schedules
  for each row execute function payment_terms_follow_contract();

create trigger payment_milestones_frozen
  before insert or update or delete on payment_milestones
  for each row execute function payment_terms_follow_contract();

do $$
declare t text;
begin
  foreach t in array array['contracts','payment_schedules','payment_milestones']
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
