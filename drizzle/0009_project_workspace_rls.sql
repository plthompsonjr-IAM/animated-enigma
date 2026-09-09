-- Task 11: updated_at triggers and tenant RLS for the project workspace tables
-- (project_team_members, project_activities). Same baseline tenant boundary as
-- the rest of the app: a row is visible/writable only to members of its org.
-- project_activities is append-only in the service tier; RLS still scopes reads.

create trigger project_team_members_set_updated_at before update on project_team_members
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['project_team_members','project_activities']
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
