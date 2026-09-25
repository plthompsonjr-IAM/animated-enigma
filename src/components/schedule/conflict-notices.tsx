import Link from 'next/link';
import { AlertTriangle, GitBranch } from 'lucide-react';
import {
  formatDay,
  type CrewConflict,
  type DependencyProblem,
} from '@/lib/schedule/schedule-core';

/**
 * Crew double-bookings, in the order they'll bite. Cross-project clashes are
 * called out explicitly — those are the ones that cost a day, because nobody
 * looking at one job's schedule can see them.
 */
export function CrewConflictNotice({ conflicts }: { conflicts: CrewConflict[] }) {
  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        {conflicts.length === 1
          ? 'One crew double-booking'
          : `${conflicts.length} crew double-bookings`}
      </p>
      <ul className="mt-1.5 space-y-1.5 text-sm">
        {conflicts.slice(0, 8).map((c, i) => (
          <li key={`${c.a.id}-${c.b.id}-${i}`}>
            <span className="font-medium">{c.userName ?? 'Someone'}</span> is on{' '}
            <Link href={`/projects/${c.a.projectId}`} className="hover:underline">
              {c.a.name}
            </Link>{' '}
            and{' '}
            <Link href={`/projects/${c.b.projectId}`} className="hover:underline">
              {c.b.name}
            </Link>{' '}
            <span className="text-muted-foreground">
              — {c.days === 1 ? 'on' : 'for'} {formatDay(c.overlap.startDate)}
              {c.days > 1 ? `–${formatDay(c.overlap.endDate)} (${c.days} days)` : ''}
              {c.crossProject ? ', on two different jobs' : ''}.
            </span>
          </li>
        ))}
      </ul>
      {conflicts.length > 8 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          …and {conflicts.length - 8} more. Clear these first.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Work sequenced to start before what it depends on is finished. Advisory: a
 * foreman may be deliberately overlapping trades, so this never blocks a save.
 */
export function DependencyNotice({ problems }: { problems: DependencyProblem[] }) {
  if (problems.length === 0) return null;

  return (
    <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <GitBranch className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        Sequence worth a look
      </p>
      <ul className="mt-1.5 space-y-1 text-sm">
        {problems.slice(0, 6).map((p) => (
          <li key={p.item.id}>
            <span className="font-medium">{p.item.name}</span> starts{' '}
            {p.daysEarly === 1 ? 'a day' : `${p.daysEarly} days`} before{' '}
            <span className="font-medium">{p.predecessor.name}</span> finishes.
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        Fine if you meant to overlap the trades — just checking.
      </p>
    </div>
  );
}
