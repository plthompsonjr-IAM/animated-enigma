import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { assignableMembers } from '@/lib/site-visits/queries';
import { schedulableProjects } from '@/lib/schedule/queries';
import { allDependencies, listTasks } from '@/lib/tasks/queries';
import {
  blockedBy,
  groupByAssignee,
  partitionPunchList,
  sortForField,
  summarizeTasks,
} from '@/lib/tasks/tasks-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TaskList, type TaskListEntry } from '@/components/tasks/task-list';
import { TasksToolbar } from './tasks-toolbar';

export const metadata = { title: 'Tasks' };

interface SearchParams {
  assignee?: string;
  project?: string;
  scope?: string;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <Empty title="Tasks">
        Tasks activate once authentication and the database are configured and an organization
        exists.
      </Empty>
    );
  }

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'tasks:read', activeOrg.extraPermissions)) {
    return <Empty title="Tasks">You don’t have permission to view tasks. Ask an administrator.</Empty>;
  }
  const mayWrite = can(activeOrg.roles, 'tasks:write', activeOrg.extraPermissions);

  const sp = await searchParams;
  const scope = sp.scope === 'all' || sp.scope === 'punch_list' ? sp.scope : 'open';
  const orgId = activeOrg.organizationId;

  const [tasks, dependencies, members, projects] = await Promise.all([
    listTasks({
      organizationId: orgId,
      assigneeId: sp.assignee || undefined,
      projectId: sp.project || undefined,
      scope,
    }),
    allDependencies(orgId),
    assignableMembers(orgId),
    schedulableProjects(orgId),
  ]);

  // Blocking is derived from the full dependency graph, not stored, so finishing
  // a predecessor unblocks its successors with no second write.
  const blockers = blockedBy(
    tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    dependencies,
  );

  const entries: TaskListEntry[] = tasks.map((task) => ({
    ...task,
    blockers: (blockers.get(task.id) ?? []).map((b) => ({ id: b.id, title: b.title })),
  }));

  const summary = summarizeTasks(
    entries.map((t) => ({
      status: t.status,
      dueDate: t.dueDate,
      isPunchList: t.isPunchList,
      blockerCount: t.blockers.length,
    })),
  );

  const sorted = sortForField(entries);
  const { punchList } = partitionPunchList(sorted);
  const byAssignee = groupByAssignee(sorted);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Field work across every job — what’s late, who’s got it, and what it’s waiting on. Add
          tasks from a project.
        </p>
      </div>

      <TasksToolbar members={members} projects={projects} scope={scope} mine={ctx.userId ?? null} />

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ClipboardList className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">
                {scope === 'open' ? 'Nothing outstanding' : 'No tasks match'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {scope === 'open'
                  ? 'Every task is done, or none have been added yet.'
                  : 'Try widening the filters.'}
              </p>
              <Link href="/projects" className="mt-2 inline-block text-sm underline">
                Go to projects
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Open" value={String(summary.open)} />
            <Stat
              label="Late"
              value={String(summary.overdue)}
              tone={summary.overdue > 0 ? 'bad' : undefined}
            />
            <Stat
              label="Blocked"
              value={String(summary.blocked)}
              tone={summary.blocked > 0 ? 'bad' : undefined}
            />
            <Stat label="Punch list" value={String(punchList.length)} />
          </div>

          {byAssignee.map((group) => (
            <Card key={group.assigneeId ?? 'unassigned'}>
              <CardHeader>
                <CardTitle className="text-base">
                  {group.assigneeName ?? (group.assigneeId ? 'Team member' : 'Unassigned')}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {group.tasks.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TaskList tasks={group.tasks} mayWrite={mayWrite} showProject />
              </CardContent>
            </Card>
          ))}
        </>
      )}
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

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
