import Link from 'next/link';
import { AlertTriangle, ArrowRight, Link2, Users } from 'lucide-react';
import {
  describeTiming,
  displayPercent,
  formatRange,
  itemUrgency,
  type ScheduleItemStatus,
} from '@/lib/schedule/schedule-core';
import { Button } from '@/components/ui/button';
import { setScheduleItemStatus, shiftScheduleItem } from '@/lib/schedule/actions';
import { ScheduleItemBadge, TimingNote } from './schedule-item-badge';

export interface ScheduleListItem {
  id: string;
  name: string;
  phase: string | null;
  startDate: string;
  endDate: string;
  status: ScheduleItemStatus;
  percentComplete: number;
  projectId: string;
  projectName?: string | null;
  projectNumber?: string | null;
  crew: { userId: string; name: string | null; email: string }[];
  dependsOnName?: string | null;
  conflictCount?: number;
}

/** Which one-tap status buttons make sense next, given where an item is. */
function nextStatuses(status: ScheduleItemStatus): ScheduleItemStatus[] {
  switch (status) {
    case 'not_started':
      return ['in_progress', 'blocked'];
    case 'in_progress':
      return ['complete', 'blocked'];
    case 'blocked':
      return ['in_progress', 'canceled'];
    case 'complete':
      return ['in_progress'];
    case 'canceled':
      return ['not_started'];
  }
}

const ACTION_LABELS: Record<ScheduleItemStatus, string> = {
  not_started: 'Reopen',
  in_progress: 'Start',
  blocked: 'Block',
  complete: 'Done',
  canceled: 'Cancel',
};

/**
 * The work-item list. Built for a phone held in one hand on a jobsite: the
 * common actions (start, done, push a day) are single taps, and the full edit
 * form is a separate step.
 */
export function ScheduleItemList({
  items,
  mayWrite,
  showProject = false,
  now,
}: {
  items: ScheduleListItem[];
  mayWrite: boolean;
  showProject?: boolean;
  now?: Date;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No work items.</p>;
  }

  return (
    <ul className="divide-y rounded-md border">
      {items.map((item) => {
        const urgency = itemUrgency(item, now);
        const pct = displayPercent(item.status, item.percentComplete);
        return (
          <li key={item.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.name}</span>
                  <ScheduleItemBadge status={item.status} />
                  {item.conflictCount ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {item.conflictCount === 1
                        ? 'Crew double-booked'
                        : `${item.conflictCount} crew clashes`}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatRange(item.startDate, item.endDate)}
                  {item.phase && item.phase !== item.name ? ` · ${item.phase}` : ''}
                </div>
                {showProject && item.projectName ? (
                  <Link
                    href={`/projects/${item.projectId}`}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {item.projectNumber ? `${item.projectNumber} · ` : ''}
                    {item.projectName}
                  </Link>
                ) : null}
              </div>
              <TimingNote urgency={urgency}>{describeTiming(item, now)}</TimingNote>
            </div>

            {pct > 0 && pct < 100 ? (
              <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {item.crew.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {item.crew.map((c) => c.name ?? c.email).join(', ')}
                </span>
              ) : (
                <span>No crew assigned</span>
              )}
              {item.dependsOnName ? (
                <span className="inline-flex items-center gap-1">
                  <Link2 className="h-3 w-3" />
                  After {item.dependsOnName}
                </span>
              ) : null}
            </div>

            {mayWrite ? (
              <div className="flex flex-wrap gap-1.5">
                {nextStatuses(item.status).map((next) => (
                  <form key={next} action={setScheduleItemStatus}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="status" value={next} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={next === 'complete' ? 'default' : 'outline'}
                      className="h-7 w-auto px-2 text-xs"
                    >
                      {ACTION_LABELS[next]}
                    </Button>
                  </form>
                ))}
                {item.status !== 'complete' && item.status !== 'canceled' ? (
                  <form action={shiftScheduleItem}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="days" value="1" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-7 w-auto px-2 text-xs"
                      title="Push this item and its duration forward one day"
                    >
                      <ArrowRight className="h-3 w-3" />
                      Push a day
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
