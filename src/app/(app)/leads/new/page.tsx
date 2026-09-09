import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { assignableMembers } from '@/lib/leads/queries';
import { LeadForm } from '@/components/leads/lead-form';

export const metadata = { title: 'New lead' };

export default async function NewLeadPage() {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');

  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">New lead</h1>
        <p className="text-sm text-muted-foreground">
          Connect the database and create an organization to start capturing leads.
        </p>
      </div>
    );
  }

  if (!can(ctx.activeOrg.roles, 'leads:write', ctx.activeOrg.extraPermissions)) {
    redirect('/leads');
  }

  const members = await assignableMembers(ctx.activeOrg.organizationId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New lead</h1>
        <p className="text-sm text-muted-foreground">
          Capture the essentials now — you can fill in the rest later.
        </p>
      </div>
      <LeadForm mode="create" members={members} />
    </div>
  );
}
