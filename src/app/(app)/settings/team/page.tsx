import { eq, and, desc } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getAuthContext } from '@/lib/auth/session';
import { can, ROLE_LABELS, type Role } from '@/lib/auth/rbac';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { InviteMemberForm, MemberRolesForm } from './team-forms';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Team management activates once authentication and the database are configured and an
          organization exists.
        </p>
      </div>
    );
  }

  const { activeOrg } = ctx;
  const mayInvite = can(activeOrg.roles, 'members:invite', activeOrg.extraPermissions);
  const mayManageRoles = can(activeOrg.roles, 'members:manage_roles', activeOrg.extraPermissions);

  if (!mayInvite && !mayManageRoles) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          You don’t have permission to manage the team. Ask an administrator.
        </p>
      </div>
    );
  }

  const db = getDb();
  const members = await db
    .select({
      memberId: schema.organizationMembers.id,
      roles: schema.organizationMembers.roles,
      email: schema.users.email,
      fullName: schema.users.fullName,
      userId: schema.users.id,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(
      and(
        eq(schema.organizationMembers.organizationId, activeOrg.organizationId),
        eq(schema.organizationMembers.isActive, true),
      ),
    );

  const pendingInvites = await db
    .select({
      id: schema.invitations.id,
      email: schema.invitations.email,
      roles: schema.invitations.roles,
      expiresAt: schema.invitations.expiresAt,
    })
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.organizationId, activeOrg.organizationId),
        eq(schema.invitations.status, 'pending'),
      ),
    )
    .orderBy(desc(schema.invitations.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Invite teammates to {activeOrg.organizationName} and manage their roles.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Roles control what each person can see and do. Costs and margins stay limited to
              office roles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {members.map((m) => (
              <div key={m.memberId} className="rounded-md border p-3">
                <div className="mb-2">
                  <p className="text-sm font-medium">{m.fullName ?? m.email}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                <MemberRolesForm
                  memberId={m.memberId}
                  roles={m.roles as Role[]}
                  disabled={!mayManageRoles}
                />
              </div>
            ))}
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {mayInvite ? (
            <Card>
              <CardHeader>
                <CardTitle>Invite a teammate</CardTitle>
                <CardDescription>
                  They’ll get a link that expires in 7 days and must sign in with the invited email.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <InviteMemberForm />
              </CardContent>
            </Card>
          ) : null}

          {pendingInvites.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Pending invitations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingInvites.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{i.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {(i.roles as Role[]).map((r) => ROLE_LABELS[r]).join(', ')} · expires{' '}
                        {i.expiresAt.toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
