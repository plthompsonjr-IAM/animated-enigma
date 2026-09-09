import Link from 'next/link';
import { AlertTriangle, History, Lock, Pencil } from 'lucide-react';
import {
  DAILY_LOG_FIELDS,
  changedFields,
  contentFromSnapshot,
  describeChanges,
  describeEditWindow,
  flaggedFields,
  formatLogDate,
  formatLogDateShort,
  isWithinEditWindow,
  type DailyLogContent,
} from '@/lib/daily-logs/daily-logs-core';
import type { DailyLogRow, RevisionRow } from '@/lib/daily-logs/queries';
import { DailyLogForm } from './daily-log-form';

/**
 * One daily log. Read-only once its window closes — which is the point: the
 * record's value is that it was written that day and hasn't been rewritten
 * since. Any edits that did happen are shown, not hidden.
 */
export function DailyLogEntry({
  log,
  revisions = [],
  mayWrite,
  showProject = false,
  editable,
  now,
}: {
  log: DailyLogRow;
  revisions?: RevisionRow[];
  mayWrite: boolean;
  showProject?: boolean;
  /** Whether to render the edit form. Defaults to the window state. */
  editable?: boolean;
  now?: Date;
}) {
  const open = isWithinEditWindow(log.editableUntil, now);
  const showForm = mayWrite && open && editable;
  const flags = flaggedFields(log);
  const filled = DAILY_LOG_FIELDS.filter(
    (field) => (log[field.key] ?? '').trim().length > 0,
  );

  return (
    <article className="space-y-3 rounded-md border p-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{formatLogDate(log.logDate)}</h3>
            {open ? null : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                Locked
              </span>
            )}
            {flags.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {flags.join(', ')}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {log.authorName ?? log.authorEmail ?? 'Unknown'}
            {showProject && log.projectName ? (
              <>
                {' · '}
                <Link href={`/projects/${log.projectId}`} className="hover:underline">
                  {log.projectNumber ? `${log.projectNumber} · ` : ''}
                  {log.projectName}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {mayWrite && open && !showForm ? (
          <Link
            href={`/daily-logs/${log.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Link>
        ) : null}
      </header>

      {showForm ? (
        <DailyLogForm
          logId={log.id}
          logDate={formatLogDateShort(log.logDate, now)}
          content={log as DailyLogContent}
        />
      ) : (
        <dl className="space-y-2">
          {filled.map((field) => (
            <div key={field.key}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {field.label}
              </dt>
              <dd className="whitespace-pre-wrap text-sm">{log[field.key]}</dd>
            </div>
          ))}
          {filled.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded.</p>
          ) : null}
        </dl>
      )}

      <footer className="border-t pt-2 text-xs text-muted-foreground">
        {describeEditWindow(log.editableUntil, now)}
      </footer>

      {revisions.length > 0 ? <RevisionHistory log={log} revisions={revisions} /> : null}
    </article>
  );
}

/**
 * What changed and when. Each revision holds the log as it stood *before* an
 * edit, so a revision is compared against whatever came after it — the next
 * revision, or the log as it stands now.
 */
function RevisionHistory({ log, revisions }: { log: DailyLogRow; revisions: RevisionRow[] }) {
  const snapshots = revisions.map((r) => contentFromSnapshot(r.snapshot));

  return (
    <details className="rounded-md bg-secondary/40 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium">
        <span className="inline-flex items-center gap-1">
          <History className="h-3 w-3" />
          Edited {revisions.length} {revisions.length === 1 ? 'time' : 'times'}
        </span>
      </summary>
      <ol className="mt-2 space-y-2">
        {revisions.map((revision, i) => {
          const after = snapshots[i + 1] ?? (log as DailyLogContent);
          const changes = changedFields(snapshots[i]!, after);
          return (
            <li key={revision.id} className="text-xs">
              <div className="font-medium">
                {new Date(revision.createdAt).toLocaleString('en-US')}
                {revision.editorName ? ` · ${revision.editorName}` : ''}
              </div>
              <div className="text-muted-foreground">{describeChanges(changes)}</div>
              {changes.map((change) => (
                <div key={change.key} className="mt-1 border-l-2 pl-2">
                  <div className="font-medium">{change.label}</div>
                  {change.before ? (
                    <div className="whitespace-pre-wrap text-muted-foreground line-through">
                      {change.before}
                    </div>
                  ) : null}
                  {change.after ? (
                    <div className="whitespace-pre-wrap">{change.after}</div>
                  ) : null}
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
