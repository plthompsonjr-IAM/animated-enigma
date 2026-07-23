import { notFound, redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import {
  getProject,
  clientOptions,
  allPropertyOptions,
  assignableMembers,
} from '@/lib/projects/queries';
import { formatAddress } from '@/lib/clients/clients-core';
import { ProjectForm, type ProjectFormValues } from '@/components/projects/project-form';

export const metadata = { title: 'Edit project' };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/projects');
  if (!can(ctx.activeOrg.roles, 'projects:write', ctx.activeOrg.extraPermissions)) {
    redirect(`/projects/${id}`);
  }

  const orgId = ctx.activeOrg.organizationId;
  const showCosts = can(ctx.activeOrg.roles, 'costs:read', ctx.activeOrg.extraPermissions);
  const [row, clients, properties, members] = await Promise.all([
    getProject(orgId, id),
    clientOptions(orgId),
    allPropertyOptions(orgId),
    assignableMembers(orgId),
  ]);
  if (!row) notFound();

  const p = row.project;
  const values: ProjectFormValues = {
    id: p.id,
    name: p.name,
    clientId: p.clientId,
    propertyId: p.propertyId,
    projectType: p.projectType,
    status: p.status,
    projectManagerId: p.projectManagerId,
    foremanId: p.foremanId,
    salespersonId: p.salespersonId,
    contractValue: p.contractValue,
    budget: p.budget,
    expectedStart: p.expectedStart,
    expectedCompletion: p.expectedCompletion,
    actualStart: p.actualStart,
    actualCompletion: p.actualCompletion,
    permitStatus: p.permitStatus,
    paymentState: p.paymentState,
    description: p.description,
    internalNotes: p.internalNotes,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit project</h1>
        <p className="text-sm text-muted-foreground">
          {p.projectNumber} · {p.name}
        </p>
      </div>
      <ProjectForm
        mode="edit"
        members={members}
        clients={clients}
        properties={properties.map((pr) => ({
          id: pr.id,
          clientId: pr.clientId,
          label: formatAddress(pr.address) || 'Property',
        }))}
        values={values}
        showFinancials={showCosts}
        lockClient
      />
    </div>
  );
}
