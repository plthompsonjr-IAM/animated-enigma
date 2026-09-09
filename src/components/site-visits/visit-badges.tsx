import {
  VISIT_STATUS_LABELS,
  VISIT_STATUS_STYLES,
  VISIT_TYPE_LABELS,
  visitUrgency,
  formatVisitDate,
  formatVisitTime,
  type VisitStatus,
  type VisitType,
} from '@/lib/site-visits/site-visits-core';
import { cn } from '@/lib/utils';

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        VISIT_STATUS_STYLES[status],
      )}
    >
      {VISIT_STATUS_LABELS[status]}
    </span>
  );
}

export function VisitTypeLabel({ type }: { type: VisitType }) {
  return <span>{VISIT_TYPE_LABELS[type]}</span>;
}

/** Date + time with an urgency cue (overdue/today/tomorrow) for scheduled visits. */
export function VisitWhen({
  status,
  scheduledAt,
}: {
  status: VisitStatus;
  scheduledAt: string | Date | null;
}) {
  const urgency = visitUrgency(status, scheduledAt);
  const when = scheduledAt
    ? `${formatVisitDate(scheduledAt)} · ${formatVisitTime(scheduledAt)}`
    : 'Unscheduled';

  const tone =
    urgency === 'overdue'
      ? 'text-red-600 dark:text-red-400 font-medium'
      : urgency === 'today'
        ? 'text-amber-600 dark:text-amber-400 font-medium'
        : 'text-foreground';
  const suffix =
    urgency === 'overdue'
      ? ' · Overdue'
      : urgency === 'today'
        ? ' · Today'
        : urgency === 'tomorrow'
          ? ' · Tomorrow'
          : '';

  return (
    <span className={tone}>
      {when}
      {suffix}
    </span>
  );
}
