import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Phone,
  Mail,
  Pencil,
  MapPin,
  FileText,
  Calculator,
  DollarSign,
} from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import {
  getProject,
  getProjectProperty,
  getProjectTeam,
  getProjectActivities,
  addableTeamMembers,
  assignableMembers,
} from '@/lib/projects/queries';
import { visitsForProject } from '@/lib/site-visits/queries';
import { ScheduleVisitForm } from '@/components/site-visits/schedule-visit-form';
import { VisitList } from '@/components/site-visits/visit-list';
import {
  PERMIT_STATUS_LABELS,
  PAYMENT_STATE_LABELS,
  formatCurrency,
  daysBetween,
  type ProjectStatus,
  type PermitStatus,
  type PaymentState,
} from '@/lib/projects/projects-core';
import { formatAddress } from '@/lib/clients/clients-core';
import { projectBudget } from '@/lib/projects/budget';
import { ProjectBudgetCard } from '@/components/projects/project-budget-card';
import { assignmentsForConflicts, scheduleForProject } from '@/lib/schedule/queries';
import { findCrewConflicts } from '@/lib/schedule/schedule-core';
import { ProjectScheduleCard } from '@/components/schedule/project-schedule-card';
import { dependenciesForProject, tasksForProject } from '@/lib/tasks/queries';
import { ProjectTasksCard } from '@/components/tasks/project-tasks-card';
import { loggedDatesForProject, logsForProject } from '@/lib/daily-logs/queries';
import { ProjectLogsCard } from '@/components/daily-logs/project-logs-card';
import { documentsForProject, photosForProject } from '@/lib/media/queries';
import { isStorageConfigured } from '@/lib/storage/supabase-storage';
import { ProjectMediaCard } from '@/components/media/project-media-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ProjectStatusBadge, ScheduleHealthText } from '@/components/projects/project-badges';
import {
  StatusChanger,
  AdvanceButton,
  AddTeamMember,
  RemoveTeamMemberButton,
  AddNoteForm,
  ArchiveProjectButton,
} from './project-actions';

export const metadata = { title: 'Project' };

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  status_change: 'Status change',
  team: 'Team',
  note: 'Note',
  site_visit: 'Site visit',
  archived: 'Archived',
  restored: 'Restored',
};

/** The workspace sections. Live ones link out; the rest land with later tasks. */
const WORKSPACE_SECTIONS: {
  label: string;
  icon: typeof FileText;
  note?: string;
  path?: string;
}[] = [
  { label: 'Scope of work', icon: FileText, path: 'scope' },
  { label: 'Estimate', icon: Calculator, path: 'estimate' },
  // Schedule and tasks now live in their own cards on this page, so the tiles
  // only cover what still lands with a later task.
  { label: 'Financials', icon: DollarSign, note: 'Task 30' },
];

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/projects');
  if (!can(ctx.activeOrg.roles, 'projects:read', ctx.activeOrg.extraPermissions))
    redirect('/projects');

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'projects:write', ctx.activeOrg.extraPermissions);
  const showCosts = can(ctx.activeOrg.roles, 'costs:read', ctx.activeOrg.extraPermissions);
  const maySchedule = can(ctx.activeOrg.roles, 'schedule:write', ctx.activeOrg.extraPermissions);
  const mayReadSchedule = can(ctx.activeOrg.roles, 'schedule:read', ctx.activeOrg.extraPermissions);
  const mayReadTasks = can(ctx.activeOrg.roles, 'tasks:read', ctx.activeOrg.extraPermissions);
  const mayWriteTasks = can(ctx.activeOrg.roles, 'tasks:write', ctx.activeOrg.extraPermissions);
  const mayReadDocuments = can(
    ctx.activeOrg.roles,
    'documents:read',
    ctx.activeOrg.extraPermissions,
  );
  const mayWriteDocuments = can(
    ctx.activeOrg.roles,
    'documents:write',
    ctx.activeOrg.extraPermissions,
  );

  const row = await getProject(orgId, id);
  if (!row) notFound();
  const p = row.project;

  const mayReadFinancials = can(
    ctx.activeOrg.roles,
    'financials:read',
    ctx.activeOrg.extraPermissions,
  );

  const [
    property,
    team,
    activities,
    addableMembers,
    allMembers,
    visits,
    budget,
    scheduleItems,
    crewAssignments,
    projectTasks,
    taskDependencies,
    dailyLogs,
    loggedDates,
    projectPhotos,
    projectDocuments,
  ] = await Promise.all([
    p.propertyId ? getProjectProperty(orgId, p.propertyId) : Promise.resolve(null),
    getProjectTeam(orgId, id),
    getProjectActivities(orgId, id),
    mayWrite ? addableTeamMembers(orgId, id) : Promise.resolve([]),
    // Needed by both the schedule crew picker and the task assignee picker.
    mayReadSchedule || mayReadTasks ? assignableMembers(orgId) : Promise.resolve([]),
    mayReadSchedule ? visitsForProject(orgId, id) : Promise.resolve([]),
    mayReadFinancials ? projectBudget(orgId, id) : Promise.resolve(null),
    mayReadSchedule ? scheduleForProject(orgId, id) : Promise.resolve([]),
    // Org-wide, so a crew member booked on another job the same week shows up.
    mayReadSchedule ? assignmentsForConflicts(orgId) : Promise.resolve([]),
    mayReadTasks ? tasksForProject(orgId, id) : Promise.resolve([]),
    mayReadTasks ? dependenciesForProject(orgId, id) : Promise.resolve([]),
    logsForProject(orgId, id, 20),
    loggedDatesForProject(orgId, id),
    mayReadDocuments ? photosForProject(orgId, id) : Promise.resolve([]),
    mayReadDocuments ? documentsForProject(orgId, id) : Promise.resolve([]),
  ]);

  // Narrow the org-wide conflicts down to the ones touching this project's work.
  const allConflicts = findCrewConflicts(crewAssignments);
  const projectConflicts = allConflicts.filter(
    (c) =>
      scheduleItems.some((i) => i.id === c.a.id) || scheduleItems.some((i) => i.id === c.b.id),
  );

  const archived = Boolean(p.deletedAt);
  const status = p.status as ProjectStatus;
  const durationDays = daysBetween(
    p.actualStart ?? p.expectedStart,
    p.actualCompletion ?? p.expectedCompletion,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
            <ProjectStatusBadge status={status} />
            {archived ? (
              <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                Archived
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {p.projectNumber}
            {' · '}
            <Link href={`/clients/${p.clientId}`} className="hover:underline">
              {row.clientName ?? 'Client'}
            </Link>
            {p.projectType ? ` · ${p.projectType}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mayWrite ? (
            <Link
              href={`/projects/${p.id}/edit`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          ) : null}
          {mayWrite ? <ArchiveProjectButton projectId={p.id} archived={archived} /> : null}
        </div>
      </div>

      {/* Quick client contact (mobile-first) */}
      {(row.clientPhone || row.clientEmail) && (
        <div className="flex gap-2">
          {row.clientPhone ? (
            <a href={`tel:${row.clientPhone}`} className={buttonVariants({ className: 'flex-1' })}>
              <Phone className="h-4 w-4" />
              Call client
            </a>
          ) : null}
          {row.clientEmail ? (
            <a
              href={`mailto:${row.clientEmail}`}
              className={buttonVariants({ variant: 'outline', className: 'flex-1' })}
            >
              <Mail className="h-4 w-4" />
              Email
            </a>
          ) : null}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: overview, workspace sections, timeline */}
        <div className="space-y-6 lg:col-span-2">
          {budget ? <ProjectBudgetCard budget={budget} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Client" value={row.clientName} />
                <Detail
                  label="Property"
                  value={property ? formatAddress(property.address) : null}
                  icon={property ? MapPin : undefined}
                />
                <Detail label="Expected start" value={formatDate(p.expectedStart)} />
                <Detail label="Expected completion" value={formatDate(p.expectedCompletion)} />
                <Detail label="Actual start" value={formatDate(p.actualStart)} />
                <Detail label="Actual completion" value={formatDate(p.actualCompletion)} />
                <Detail
                  label="Permit"
                  value={PERMIT_STATUS_LABELS[p.permitStatus as PermitStatus]}
                />
                <Detail
                  label="Payment"
                  value={PAYMENT_STATE_LABELS[p.paymentState as PaymentState]}
                />
                {durationDays !== null ? (
                  <Detail label="Duration" value={`${durationDays} days`} />
                ) : null}
                {showCosts ? (
                  <>
                    <Detail label="Contract value" value={formatCurrency(p.contractValue) || '—'} />
                    <Detail label="Budget" value={formatCurrency(p.budget) || '—'} />
                  </>
                ) : null}
                <Detail
                  label="Description"
                  value={p.description}
                  className="sm:col-span-2"
                  multiline
                />
                {showCosts ? (
                  <Detail
                    label="Internal notes"
                    value={p.internalNotes}
                    className="sm:col-span-2"
                    multiline
                  />
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {mayReadSchedule ? (
            <ProjectScheduleCard
              projectId={p.id}
              items={scheduleItems}
              crew={allMembers.map((m) => ({
                userId: m.id,
                name: m.name,
                email: m.email,
              }))}
              conflicts={projectConflicts}
              mayWrite={maySchedule}
            />
          ) : null}

          {mayReadTasks ? (
            <ProjectTasksCard
              projectId={p.id}
              tasks={projectTasks}
              dependencies={taskDependencies}
              members={allMembers.map((m) => ({
                userId: m.id,
                name: m.name,
                email: m.email,
              }))}
              phases={scheduleItems.map((i) => ({ id: i.id, name: i.name }))}
              mayWrite={mayWriteTasks}
            />
          ) : null}

          <ProjectLogsCard
            projectId={p.id}
            logs={dailyLogs}
            loggedDates={loggedDates}
            coverageFrom={p.actualStart ?? p.expectedStart}
            mayWrite={mayWriteTasks}
          />

          {mayReadDocuments ? (
            <ProjectMediaCard
              projectId={p.id}
              photos={projectPhotos}
              documents={projectDocuments}
              mayWrite={mayWriteDocuments}
              storageConfigured={isStorageConfigured()}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {WORKSPACE_SECTIONS.map((s) => {
                  const Icon = s.icon;
                  if (s.path) {
                    return (
                      <Link
                        key={s.label}
                        href={`/projects/${p.id}/${s.path}`}
                        className="flex flex-col gap-1.5 rounded-md border p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
                      >
                        <Icon className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">{s.label}</span>
                        <span className="text-[11px] text-muted-foreground">Open</span>
                      </Link>
                    );
                  }
                  return (
                    <div
                      key={s.label}
                      className="flex flex-col gap-1.5 rounded-md border border-dashed p-3"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="text-[11px] text-muted-foreground">Coming in {s.note}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {mayWrite && !archived ? <AddNoteForm projectId={p.id} /> : null}
              <ol className="space-y-3">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">
                          {ACTIVITY_LABELS[a.activityType] ?? a.activityType}
                        </span>
                        {a.summary ? (
                          <span className="text-muted-foreground"> — {a.summary}</span>
                        ) : null}
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

        {/* Right: pipeline + team */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Status</span>
                <ProjectStatusBadge status={status} />
              </div>
              {mayWrite ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Change status
                    </label>
                    <StatusChanger projectId={p.id} status={status} />
                  </div>
                  <AdvanceButton projectId={p.id} status={status} />
                </>
              ) : null}
              <div className="space-y-1.5 border-t pt-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Target completion</span>
                  <ScheduleHealthText status={status} expectedCompletion={p.expectedCompletion} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                <Role label="Project manager" value={row.projectManagerName} />
                <Role label="Field foreman" value={row.foremanName} />
                <Role label="Salesperson" value={row.salespersonName} />
              </dl>

              {team.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Additional crew
                  </p>
                  <ul className="space-y-1.5">
                    {team.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{m.name ?? m.email ?? 'Member'}</span>
                        {mayWrite && !archived ? (
                          <RemoveTeamMemberButton projectId={p.id} memberId={m.id} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {mayWrite && !archived ? (
                <div className="border-t pt-3">
                  <AddTeamMember projectId={p.id} candidates={addableMembers} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          {mayReadSchedule ? (
            <Card>
              <CardHeader>
                <CardTitle>Site visits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {maySchedule && !archived ? (
                  <ScheduleVisitForm projectId={p.id} members={allMembers} />
                ) : null}
                <VisitList
                  visits={visits}
                  members={allMembers}
                  mayWrite={maySchedule}
                  emptyText="No site visits scheduled yet."
                />
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
  icon: Icon,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
  multiline?: boolean;
  icon?: typeof MapPin;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={multiline ? 'whitespace-pre-wrap text-sm' : 'flex items-center gap-1.5 text-sm'}
      >
        {Icon && value ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {value || '—'}
      </dd>
    </div>
  );
}

function Role({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value ?? 'Unassigned'}</dd>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
