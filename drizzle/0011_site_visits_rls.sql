-- Task 12: updated_at trigger and tenant RLS for site_visits. Same baseline
-- tenant boundary as the rest of the app: a row is visible/writable only to
-- members of its organization. Role-level rules (who may schedule/complete)
-- are enforced in the service tier.

create trigger site_visits_set_updated_at before update on site_visits
  for each row execute function set_updated_at();

alter table site_visits enable row level security;
alter table site_visits force row level security;
create policy site_visits_tenant on site_visits
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));
