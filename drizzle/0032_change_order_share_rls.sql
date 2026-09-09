-- Tenant RLS for the change-order share/engagement log. The public approval
-- page reads the change order by token through the app's connection (possession
-- of the token is the credential), so this policy is the internal tenant
-- boundary only — matching how proposal_events works.

alter table change_order_share_events enable row level security;
alter table change_order_share_events force row level security;

create policy change_order_share_events_tenant on change_order_share_events
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));
