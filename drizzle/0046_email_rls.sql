-- Task 32: append-only enforcement, integrity checks, and RLS for the email log.
--
-- The log answers "did the client get the invoice, and when". That answer is
-- only worth anything if it cannot be rewritten afterward, so UPDATE and DELETE
-- are rejected at the database level for every role — including the app's own
-- postgres role, which has BYPASSRLS. Same pattern as signatures and daily-log
-- revisions: a bug or a compromised app credential still cannot make a sent
-- email look unsent.
--
-- The checks keep the row honest about its own outcome: a row that says "sent"
-- carries when; a row that says "failed" carries why. A row with neither is a
-- guess, and this table does not store guesses.

create or replace function email_log_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'email_log is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger email_log_no_update before update on email_log
  for each row execute function email_log_append_only();

create trigger email_log_no_delete before delete on email_log
  for each row execute function email_log_append_only();

alter table email_log
  add constraint email_log_kind_known
  check (kind in ('invitation', 'proposal', 'change_order', 'invoice'));

alter table email_log
  add constraint email_log_provider_known
  check (provider in ('gmail', 'resend'));

alter table email_log
  add constraint email_log_status_known
  check (status in ('sent', 'failed'));

alter table email_log
  add constraint email_log_has_recipient
  check (coalesce(array_length(to_addresses, 1), 0) > 0);

-- Sent rows say when; failed rows say why.
alter table email_log
  add constraint email_log_outcome_consistent
  check (
    (status = 'sent' and sent_at is not null)
    or (status = 'failed' and error is not null)
  );

alter table email_log enable row level security;
alter table email_log force row level security;

create policy email_log_tenant on email_log
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));
