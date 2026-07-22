import { notFound, redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getLead, assignableMembers } from '@/lib/leads/queries';
import { LeadForm, type LeadFormValues } from '@/components/leads/lead-form';

export const metadata = { title: 'Edit lead' };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/leads');
  if (!can(ctx.activeOrg.roles, 'leads:write', ctx.activeOrg.extraPermissions)) {
    redirect(`/leads/${id}`);
  }

  const orgId = ctx.activeOrg.organizationId;
  const [row, members] = await Promise.all([getLead(orgId, id), assignableMembers(orgId)]);
  if (!row) notFound();

  const lead = row.lead;
  const address =
    lead.propertyAddress && typeof lead.propertyAddress === 'object'
      ? ((lead.propertyAddress as { line1?: string }).line1 ?? null)
      : null;

  const values: LeadFormValues = {
    id: lead.id,
    leadName: lead.leadName,
    clientName: lead.clientName,
    phone: lead.phone,
    email: lead.email,
    propertyAddress: address,
    projectType: lead.projectType,
    leadSource: lead.leadSource,
    estimatedBudget: lead.estimatedBudget,
    desiredStartDate: lead.desiredStartDate,
    description: lead.description,
    assignedTo: lead.assignedTo,
    priority: lead.priority,
    nextFollowUpDate: lead.nextFollowUpDate,
    notes: lead.notes,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit lead</h1>
        <p className="text-sm text-muted-foreground">{lead.leadName}</p>
      </div>
      <LeadForm mode="edit" members={members} values={values} />
    </div>
  );
}
