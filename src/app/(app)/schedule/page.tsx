import Link from 'next/link';
import { Calendar, CalendarRange } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listVisits, assignableMembers } from '@/lib/site-visits/queries';
import { partitionVisits, groupByDay, formatVisitDate } from '@/lib/site-visits/site-visits-core';
import {
  assignmentsForConflicts,
  listScheduleItems,
  schedulableProjects,
} from '@/lib/schedule/queries';
import {
  addDays,
  conflictsForItem,
  findCrewConflicts,
  formatDayLong,
  groupByStartDay,
  itemsOnDay,
  scheduleHealth,
  today,
} from '@/lib/schedule/schedule-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VisitList } from '@/components/site-visits/visit-list';
import { ScheduleTimeline } from '@/components/schedule/schedule-timeline';
import { ScheduleItemList } from '@/components/schedule/schedule-item-list';
import { CrewConflictNotice } from '@/components/schedule/conflict-notices';
import { ScheduleToolbar } from './schedule-toolbar';

export const metadata = { title: 'Schedule' };

interface SearchParams {
  assignee?: string;
  project?: string;
  view?: string;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return <NotReady />;
  }

  const { activeOrg } = ctx;
  const mayRead = can(activeOrg.roles, 'schedule:read', activeOrg.extraPermissions);
  const mayWrite = can(activeOrg.roles, 'schedule:write', activeOrg.extraPermissions);
  if (!mayRead) {
    return (
      <Empty title="Schedule">
        You don’t have permission to view the schedule. Ask an administrator.
      </Empty>
    );
  }

  const sp = await searchParams;
  const orgId = activeOrg.organizationId;
  const view = sp.view === 'visits' ? 'visits' : 'work';

  const [members, projects] = await Promise.all([
    assignableMembers(orgId),
    schedulableProjects(orgId),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          {view === 'work'
            ? 'Work in flight across every job, and who’s on it. Build a schedule from a project.'
            : 'Site visits and measurements across every lead and project.'}
        </p>
      </div>

      <ScheduleToolbar members={members} projects={projects} view={view} />

      {view === 'work' ? (
        <WorkSchedule
          orgId={orgId}
          assignee={sp.assignee}
          projectId={sp.project}
          mayWrite={mayWrite}
        />
      ) : (
        <VisitSchedule orgId={orgId} assignee={sp.assignee} members={members} mayWrite={mayWrite} />
      )}
    </div>
  );
}

/**
 * The work schedule: a six-week timeline, what's past due, today's crew, then
 * the upcoming work as an agenda. Late work is pulled to the top so an overdue
 * phase can't quietly scroll out of sight.
 */
async function WorkSchedule({
  orgId,
  assignee,
  projectId,
  mayWrite,
}: {
  orgId: string;
  assignee?: string;
  projectId?: string;
  mayWrite: boolean;
}) {
  const day = today();
  // A week back for context, five weeks forward for planning.
  const from = addDays(day, -7) ?? day;
  const to = addDays(day, 35) ?? day;

  const [items, assignments] = await Promise.all([
    listScheduleItems({
      organizationId: orgId,
      from,
      to,
      userId: assignee || undefined,
      projectId: projectId || undefined,
    }),
    // Conflicts are always org-wide and unfiltered — a filter must not be able
    // to hide a double-booking.
    assignmentsForConflicts(orgId, from),
  ]);

  const conflicts = findCrewConflicts(assignments);
  const health = scheduleHealth(items);
  const live = items.filter((i) => i.status !== 'canceled');
  const todaysWork = itemsOnDay(live, day);
  const overdue = live.filter((i) => i.endDate < day && i.status !== 'complete');
  const ahead = live.filter((i) => i.startDate > day);

  const withConflicts = (list: typeof items) =>
    list.map((item) => ({ ...item, conflictCount: conflictsForItem(conflicts, item.id).length }));

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        <CrewConflictNotice conflicts={conflicts} />
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CalendarRange className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No work scheduled in this window</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a project and build its schedule — the standard trade sequence gets you most of
                the way in one tap.
              </p>
              <Link href="/projects" className="mt-2 inline-block text-sm underline">
                Go to projects
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="On the boards" value={String(health.active)} />
        <Stat label="Late" value={String(health.overdue)} tone={health.overdue > 0 ? 'bad' : undefined} />
        <Stat label="Starting this week" value={String(health.startingThisWeek)} />
        <Stat label="Blocked" value={String(health.blocked)} tone={health.blocked > 0 ? 'bad' : undefined} />
      </div>

      <CrewConflictNotice conflicts={conflicts} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleTimeline
            rows={items.map((item) => ({
              id: item.id,
              name: item.name,
              startDate: item.startDate,
              endDate: item.endDate,
              status: item.status,
              percentComplete: item.percentComplete,
              projectId: item.projectId,
              projectName: item.projectName,
              crewNames: item.crew.map((c) => c.name ?? c.email),
              hasConflict: conflictsForItem(conflicts, item.id).length > 0,
            }))}
            showProject
          />
        </CardContent>
      </Card>

      {overdue.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            Past due ({overdue.length})
          </h2>
          <ScheduleItemList items={withConflicts(overdue)} mayWrite={mayWrite} showProject />
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Today · {formatDayLong(day)}
        </h2>
        {todaysWork.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on the boards today.</p>
        ) : (
          <ScheduleItemList items={withConflicts(todaysWork)} mayWrite={mayWrite} showProject />
        )}
      </section>

      {ahead.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Coming up ({ahead.length})
          </h2>
          {groupByStartDay(ahead).map(({ day: startDay, items: dayItems }) => (
            <div key={startDay} className="space-y-2">
              <h3 className="text-xs font-semibold">{formatDayLong(startDay)}</h3>
              <ScheduleItemList items={withConflicts(dayItems)} mayWrite={mayWrite} showProject />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** The site-visit agenda, unchanged apart from moving behind a view switch. */
async function VisitSchedule({
  orgId,
  assignee,
  members,
  mayWrite,
}: {
  orgId: string;
  assignee?: string;
  members: { id: string; name: string | null; email: string }[];
  mayWrite: boolean;
}) {
  const visits = await listVisits({
    organizationId: orgId,
    assignedTo: assignee || undefined,
    scope: 'all',
  });

  const { upcoming, past } = partitionVisits(visits);
  const upcomingByDay = groupByDay(upcoming);

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Calendar className="h-6 w-6" />
          </div>
          <div className="max-w-sm">
            <p className="font-medium">Nothing scheduled</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a lead or project and schedule a site visit — it’ll show up here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Upcoming ({upcoming.length})
        </h2>
        {upcomingByDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming visits.</p>
        ) : (
          upcomingByDay.map(({ day, visits: dayVisits }) => (
            <div key={day} className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">
                {formatVisitDate(dayVisits[0]?.scheduledAt ?? day)}
              </h3>
              <VisitList visits={dayVisits} members={members} mayWrite={mayWrite} showParent />
            </div>
          ))
        )}
      </section>

      {past.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Past &amp; closed
          </h2>
          <VisitList visits={past} members={members} mayWrite={mayWrite} showParent />
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums ${
          tone === 'bad' ? 'text-red-600 dark:text-red-400' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function NotReady() {
  return (
    <Empty title="Schedule">
      Scheduling activates once authentication and the database are configured and an organization
      exists.
    </Empty>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
