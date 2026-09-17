import {
  SCHEDULE_ITEM_STATUS_LABELS,
  SCHEDULE_ITEM_STATUS_STYLES,
  type ScheduleItemStatus,
} from '@/lib/schedule/schedule-core';
import { cn } from '@/lib/utils';

export function ScheduleItemBadge({
  status,
  className,
}: {
  status: ScheduleItemStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        SCHEDULE_ITEM_STATUS_STYLES[status],
        className,
      )}
    >
      {SCHEDULE_ITEM_STATUS_LABELS[status]}
    </span>
  );
}

/** "3 days past due" style timing note, coloured by how bad it is. */
export function TimingNote({
  urgency,
  children,
}: {
  urgency: 'overdue' | 'active' | 'starts_today' | 'upcoming' | 'done';
  children: React.ReactNode;
}) {
  const tone =
    urgency === 'overdue'
      ? 'text-red-600 dark:text-red-400 font-medium'
      : urgency === 'starts_today' || urgency === 'active'
        ? 'text-foreground'
        : 'text-muted-foreground';
  return <span className={cn('text-xs', tone)}>{children}</span>;
}
