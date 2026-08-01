import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getDailyLog, revisionsForLog } from '@/lib/daily-logs/queries';
import { deleteDailyLog } from '@/lib/daily-logs/actions';
import { isWithinEditWindow } from '@/lib/daily-logs/daily-logs-core';
import { DailyLogEntry } from '@/components/daily-logs/daily-log-entry';
import { Button, buttonVariants } from '@/components/ui/button';

export const metadata = { title: 'Daily log' };

export default async function DailyLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/daily-logs');
  if (!can(ctx.activeOrg.roles, 'projects:read', ctx.activeOrg.extraPermissions)) {
    redirect('/daily-logs');
  }

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'tasks:write', ctx.activeOrg.extraPermissions);

  const log = await getDailyLog(orgId, id);
  if (!log) notFound();
  const revisions = await revisionsForLog(orgId, id);
  const open = isWithinEditWindow(log.editableUntil);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href={`/projects/${log.projectId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {log.projectNumber ? `${log.projectNumber} · ` : ''}
          {log.projectName ?? 'Project'}
        </Link>
      </div>

      <DailyLogEntry log={log} revisions={revisions} mayWrite={mayWrite} editable={open} />

      {mayWrite && open ? (
        <div className="rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            Wrong project or wrong day? A log can be removed while its window is open. Once it
            closes it stays — corrections go in a later log.
          </p>
          <form action={deleteDailyLog} className="mt-2">
            <input type="hidden" name="logId" value={log.id} />
            <Button type="submit" variant="outline" size="sm" className="w-auto text-destructive">
              Delete this log
            </Button>
          </form>
        </div>
      ) : null}

      <div className="pt-1">
        <Link
          href={`/daily-logs?project=${log.projectId}`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          All logs for this job
        </Link>
      </div>
    </div>
  );
}
