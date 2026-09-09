import Link from 'next/link';
import { NotebookPen } from 'lucide-react';
import {
  formatLogDateShort,
  isWithinEditWindow,
  logCoverage,
  summarizeLog,
  flaggedFields,
} from '@/lib/daily-logs/daily-logs-core';
import { today } from '@/lib/schedule/schedule-core';
import type { DailyLogRow } from '@/lib/daily-logs/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DailyLogForm } from './daily-log-form';

/**
 * The daily-log section on a project: today's log if it exists, a prompt to
 * write one if it doesn't, and the recent history.
 *
 * Coverage is surfaced rather than left to be noticed — a gap in the daily
 * record is exactly what sinks a delay claim, and it's invisible until someone
 * goes looking.
 */
export function ProjectLogsCard({
  projectId,
  logs,
  loggedDates,
  coverageFrom,
  mayWrite,
  now,
}: {
  projectId: string;
  logs: DailyLogRow[];
  loggedDates: string[];
  /** Usually the project's start date — where coverage should be measured from. */
  coverageFrom: string | null;
  mayWrite: boolean;
  now?: Date;
}) {
  const day = today(now);
  const todaysLog = logs.find((l) => l.logDate === day) ?? null;
  const coverage = coverageFrom ? logCoverage(loggedDates, coverageFrom, day, now) : null;
  const recent = logs.filter((l) => l.logDate !== day).slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Daily log</CardTitle>
          {coverage && coverage.percent !== null ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {coverage.logged} of {coverage.workingDays} working days logged ({coverage.percent}%)
            </p>
          ) : null}
        </div>
        <NotebookPen className="h-5 w-5 flex-none text-muted-foreground" />
      </CardHeader>

      <CardContent className="space-y-4">
        {todaysLog ? (
          <div className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Today’s log is written.</span>
              {mayWrite && isWithinEditWindow(todaysLog.editableUntil, now) ? (
                <Link
                  href={`/daily-logs/${todaysLog.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Edit
                </Link>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{summarizeLog(todaysLog)}</p>
          </div>
        ) : mayWrite ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Nothing logged for today yet. Write it while it’s fresh — a log written the day it
              happened is worth far more than one reconstructed later.
            </p>
            <DailyLogForm projectId={projectId} defaultDate={day} maxDate={day} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing logged for today yet.</p>
        )}

        {coverage && coverage.missing.length > 0 ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">
              {coverage.missing.length} working{' '}
              {coverage.missing.length === 1 ? 'day has' : 'days have'} no log.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {coverage.missing.slice(-6).map((d) => formatLogDateShort(d, now)).join(', ')}
              {coverage.missing.length > 6 ? ', and earlier' : ''}. Gaps in the daily record are
              what undermine a delay claim.
            </p>
          </div>
        ) : null}

        {recent.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent
            </h3>
            <ul className="divide-y rounded-md border">
              {recent.map((log) => {
                const flags = flaggedFields(log);
                return (
                  <li key={log.id} className="px-3 py-2">
                    <Link href={`/daily-logs/${log.id}`} className="block hover:underline">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {formatLogDateShort(log.logDate, now)}
                        </span>
                        {flags.length > 0 ? (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            {flags.join(', ')}
                          </span>
                        ) : null}
                        {log.revisionCount > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            edited {log.revisionCount}×
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{summarizeLog(log, 100)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <Link
          href={`/daily-logs?project=${projectId}`}
          className="inline-block text-sm text-muted-foreground underline hover:text-foreground"
        >
          All logs for this job
        </Link>
      </CardContent>
    </Card>
  );
}
