import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NotebookPen } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { schedulableProjects } from '@/lib/schedule/queries';
import { listDailyLogs, projectsMissingTodaysLog } from '@/lib/daily-logs/queries';
import { addDays, today } from '@/lib/schedule/schedule-core';
import { flaggedFields, formatLogDateShort, summarizeLog } from '@/lib/daily-logs/daily-logs-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogsToolbar } from './logs-toolbar';

export const metadata = { title: 'Daily logs' };

interface SearchParams {
  project?: string;
  flagged?: string;
}

export default async function DailyLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <Empty title="Daily logs">
        Daily logs activate once authentication and the database are configured and an organization
        exists.
      </Empty>
    );
  }

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'projects:read', activeOrg.extraPermissions)) {
    return <Empty title="Daily logs">You don’t have permission to view daily logs.</Empty>;
  }

  const sp = await searchParams;
  const orgId = activeOrg.organizationId;
  const day = today();
  const flaggedOnly = sp.flagged === '1';

  const [logs, projects, missing] = await Promise.all([
    listDailyLogs({
      organizationId: orgId,
      projectId: sp.project || undefined,
      // Eight weeks back is a useful working window; the project page carries
      // the full history for one job.
      from: addDays(day, -56) ?? undefined,
      flaggedOnly,
    }),
    schedulableProjects(orgId),
    projectsMissingTodaysLog(orgId, day),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily logs</h1>
        <p className="text-sm text-muted-foreground">
          The contemporaneous record of what happened on each job. Write logs from a project — this
          is the read-across.
        </p>
      </div>

      <LogsToolbar projects={projects} flagged={flaggedOnly} />

      {missing.length > 0 && !sp.project ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            {missing.length} active {missing.length === 1 ? 'job has' : 'jobs have'} no log for
            today.
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {missing.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`} className="underline">
                  {project.number ? `${project.number} · ` : ''}
                  {project.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <NotebookPen className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">
                {flaggedOnly ? 'No delays or incidents logged' : 'No logs yet'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {flaggedOnly
                  ? 'Nothing in this window recorded a delay, a problem, or a safety incident.'
                  : 'Open a project and write the day’s log while it’s fresh.'}
              </p>
              <Link href="/projects" className="mt-2 inline-block text-sm underline">
                Go to projects
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {flaggedOnly ? 'Delays, problems & incidents' : 'Recent logs'}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{logs.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {logs.map((log) => {
                const flags = flaggedFields(log);
                return (
                  <li key={log.id} className="px-3 py-2">
                    <Link href={`/daily-logs/${log.id}`} className="block hover:underline">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {formatLogDateShort(log.logDate)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {log.projectNumber ? `${log.projectNumber} · ` : ''}
                          {log.projectName ?? 'Project'}
                        </span>
                        {flags.length > 0 ? (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            {flags.join(', ')}
                          </span>
                        ) : null}
                        {log.revisionCount > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            edited {log.revisionCount}×
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{summarizeLog(log)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
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
