-- Task 22: updated_at triggers, tenant RLS, and financial-integrity freezing
-- for the invoice/payment ledger.
--
-- Issued invoices are financial records. The database rejects changes to the
-- billed amounts once an invoice leaves draft, but deliberately still allows
-- the payment-derived columns (amount_paid, balance), the status, and the lock
-- bookkeeping to move — otherwise recording a payment would be impossible.
-- Correcting an issued invoice means voiding it and re-issuing.
--
-- Locked payments and allocations are immutable outright: cash either arrived
-- or it didn't.

create trigger invoices_set_updated_at before update on invoices
  for each row execute function set_updated_at();
create trigger payments_set_updated_at before update on payments
  for each row execute function set_updated_at();

create or replace function invoices_freeze_when_issued() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    if new.subtotal is distinct from old.subtotal
       or new.tax_rate is distinct from old.tax_rate
       or new.tax_amount is distinct from old.tax_amount
       or new.credits is distinct from old.credits
       or new.total is distinct from old.total
       or new.invoice_number is distinct from old.invoice_number
       or new.invoice_type is distinct from old.invoice_type
       or new.project_id is distinct from old.project_id
       or new.client_id is distinct from old.client_id
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'invoice % is issued (%) and its amounts are frozen; void and re-issue instead',
        old.invoice_number, old.status
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_freeze before update on invoices
  for each row execute function invoices_freeze_when_issued();

-- Billed lines follow their invoice: editable only while it is a draft.
create or replace function invoice_lines_follow_invoice() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  invoice_status_value text;
begin
  select i.status::text into invoice_status_value
    from public.invoices i
    where i.id = coalesce(new.invoice_id, old.invoice_id);

  if invoice_status_value is not null and invoice_status_value <> 'draft' then
    raise exception 'invoice line items are locked once the invoice is %', invoice_status_value
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger invoice_line_items_locked
  before insert or update or delete on invoice_line_items
  for each row execute function invoice_lines_follow_invoice();

-- Cash is not editable once locked.
create or replace function payments_append_only_when_locked() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception 'locked payments cannot be deleted'
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.locked_at is not null
     and (new.amount is distinct from old.amount
          or new.payment_date is distinct from old.payment_date
          or new.method is distinct from old.method
          or new.is_refund is distinct from old.is_refund
          or new.organization_id is distinct from old.organization_id) then
    raise exception 'payment is locked and cannot be altered'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger payments_locked
  before update or delete on payments
  for each row execute function payments_append_only_when_locked();

create or replace function payment_allocations_locked_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if coalesce(old.locked_at, new.locked_at) is not null and tg_op <> 'INSERT' then
    if tg_op = 'DELETE' or new.amount is distinct from old.amount then
      raise exception 'payment allocation is locked and cannot be altered'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payment_allocations_locked
  before update or delete on payment_allocations
  for each row execute function payment_allocations_locked_guard();

do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_line_items','payments','payment_allocations']
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
