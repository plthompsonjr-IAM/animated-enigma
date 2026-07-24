import { Calendar } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listVisits, assignableMembers } from '@/lib/site-visits/queries';
import { partitionVisits, groupByDay, formatVisitDate } from '@/lib/site-visits/site-visits-core';
import { Card, CardContent } from '@/components/ui/card';
import { VisitList } from '@/components/site-visits/visit-list';
import { ScheduleToolbar } from './schedule-toolbar';

export const metadata = { title: 'Schedule' };

interface SearchParams {
  assignee?: string;
  scope?: string;
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
  const [visits, members] = await Promise.all([
    listVisits({
      organizationId: orgId,
      assignedTo: sp.assignee || undefined,
      scope: 'all',
    }),
    assignableMembers(orgId),
  ]);

  const { upcoming, past } = partitionVisits(visits);
  const upcomingByDay = groupByDay(upcoming);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Site visits and measurements across every lead and project. Schedule new visits from a
          lead or project page.
        </p>
      </div>

      <ScheduleToolbar members={members} />

      {upcoming.length === 0 && past.length === 0 ? (
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
      ) : (
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
                Past & closed
              </h2>
              <VisitList visits={past} members={members} mayWrite={mayWrite} showParent />
            </section>
          ) : null}
        </div>
      )}
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
