import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { clientOptions, allPropertyOptions, assignableMembers } from '@/lib/projects/queries';
import { formatAddress } from '@/lib/clients/clients-core';
import { ProjectForm } from '@/components/projects/project-form';

export const metadata = { title: 'New project' };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/projects');
  if (!can(ctx.activeOrg.roles, 'projects:write', ctx.activeOrg.extraPermissions)) {
    redirect('/projects');
  }

  const orgId = ctx.activeOrg.organizationId;
  const showCosts = can(ctx.activeOrg.roles, 'costs:read', ctx.activeOrg.extraPermissions);
  const [clients, properties, members] = await Promise.all([
    clientOptions(orgId),
    allPropertyOptions(orgId),
    assignableMembers(orgId),
  ]);

  const { client } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">
          Set up the job. You can flesh out scope, estimates, and schedule from the project page.
        </p>
      </div>
      <ProjectForm
        mode="create"
        members={members}
        clients={clients}
        properties={properties.map((p) => ({
          id: p.id,
          clientId: p.clientId,
          label: formatAddress(p.address) || 'Property',
        }))}
        values={client ? { clientId: client } : undefined}
        showFinancials={showCosts}
      />
    </div>
  );
}
