import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Phone, Mail, Pencil } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getLead, getLeadActivities, assignableMembers } from '@/lib/leads/queries';
import { PRIORITY_LABELS, type LeadStatus, type Priority } from '@/lib/leads/leads-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge, FollowUpText } from '@/components/leads/lead-badges';
import {
  StatusChanger,
  AssignPicker,
  FollowUpPicker,
  AddNoteForm,
  ConvertButton,
  ArchiveButton,
} from './lead-actions';

export const metadata = { title: 'Lead' };

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  status_change: 'Status change',
  assignment: 'Assignment',
  follow_up: 'Follow-up',
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  converted: 'Converted',
  archived: 'Archived',
  restored: 'Restored',
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/leads');
  if (!can(ctx.activeOrg.roles, 'leads:read', ctx.activeOrg.extraPermissions)) redirect('/leads');

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'leads:write', ctx.activeOrg.extraPermissions);

  const [row, activities, members] = await Promise.all([
    getLead(orgId, id),
    getLeadActivities(orgId, id),
    assignableMembers(orgId),
  ]);
  if (!row) notFound();

  const lead = row.lead;
  const converted = Boolean(lead.convertedProjectId);
  const archived = Boolean(lead.deletedAt);
  const address =
    lead.propertyAddress && typeof lead.propertyAddress === 'object'
      ? ((lead.propertyAddress as { line1?: string }).line1 ?? null)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{lead.leadName}</h1>
            {archived ? (
              <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                Archived
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {lead.clientName ?? 'No client name'} · {lead.projectType ?? 'Unspecified type'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mayWrite ? (
            <Link
              href={`/leads/${lead.id}/edit`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          ) : null}
          {mayWrite ? <ArchiveButton leadId={lead.id} archived={archived} /> : null}
        </div>
      </div>

      {/* Quick contact actions (mobile-first, thumb-reachable) */}
      {(lead.phone || lead.email) && (
        <div className="flex gap-2">
          {lead.phone ? (
            <a href={`tel:${lead.phone}`} className={buttonVariants({ className: 'flex-1' })}>
              <Phone className="h-4 w-4" />
              Call
            </a>
          ) : null}
          {lead.email ? (
            <a
              href={`mailto:${lead.email}`}
              className={buttonVariants({ variant: 'outline', className: 'flex-1' })}
            >
              <Mail className="h-4 w-4" />
              Email
            </a>
          ) : null}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: details + timeline */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Phone" value={lead.phone} />
                <Detail label="Email" value={lead.email} />
                <Detail label="Property" value={address} className="sm:col-span-2" />
                <Detail label="Lead source" value={lead.leadSource} />
                <Detail label="Estimated budget" value={formatBudget(lead.estimatedBudget)} />
                <Detail label="Desired start" value={lead.desiredStartDate} />
                <Detail label="Priority" value={PRIORITY_LABELS[lead.priority as Priority]} />
                <Detail
                  label="Description"
                  value={lead.description}
                  className="sm:col-span-2"
                  multiline
                />
                <Detail label="Internal notes" value={lead.notes} className="sm:col-span-2" multiline />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {mayWrite && !archived ? <AddNoteForm leadId={lead.id} /> : null}
              <ol className="space-y-3">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{ACTIVITY_LABELS[a.activityType] ?? a.activityType}</span>
                        {a.summary ? <span className="text-muted-foreground"> — {a.summary}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(a.occurredAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                        {a.actorName ? ` · ${a.actorName}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
                {activities.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No activity yet.</li>
                ) : null}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* Right: workflow controls */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge status={lead.status as LeadStatus} />
              </div>
              {mayWrite ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Change status</label>
                  <StatusChanger
                    leadId={lead.id}
                    status={lead.status as LeadStatus}
                    converted={converted}
                  />
                  {converted ? (
                    <p className="text-xs text-muted-foreground">
                      Locked — this lead was converted to a project.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Assigned to</label>
                {mayWrite ? (
                  <AssignPicker leadId={lead.id} assignedTo={lead.assignedTo} members={members} />
                ) : (
                  <p className="text-sm">{row.assignedToName ?? 'Unassigned'}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Next follow-up</label>
                <div className="text-sm">
                  <FollowUpText date={lead.nextFollowUpDate} />
                </div>
                {mayWrite ? (
                  <FollowUpPicker leadId={lead.id} nextFollowUpDate={lead.nextFollowUpDate} />
                ) : null}
              </div>
            </CardContent>
          </Card>

          {mayWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>Convert</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Turn this lead into a client and a new project. The lead is marked Won and linked
                  to the project.
                </p>
                <ConvertButton leadId={lead.id} converted={converted} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  className,
  multiline,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
  multiline?: boolean;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={multiline ? 'whitespace-pre-wrap text-sm' : 'text-sm'}>{value || '—'}</dd>
    </div>
  );
}

function formatBudget(value: string | null): string {
  if (!value) return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  return `$${n.toLocaleString('en-US')}`;
}
