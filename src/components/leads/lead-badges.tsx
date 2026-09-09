import { cn } from '@/lib/utils';
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_STYLES,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  FOLLOW_UP_STYLES,
  followUpUrgency,
  type LeadStatus,
  type Priority,
} from '@/lib/leads/leads-core';

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        LEAD_STATUS_STYLES[status],
      )}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        PRIORITY_STYLES[priority],
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

/** Formatted follow-up date with urgency coloring (overdue/today/soon). */
export function FollowUpText({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">No follow-up set</span>;
  const urgency = followUpUrgency(date);
  const label =
    urgency === 'overdue'
      ? `Overdue · ${formatDate(date)}`
      : urgency === 'today'
        ? 'Due today'
        : formatDate(date);
  return <span className={FOLLOW_UP_STYLES[urgency]}>{label}</span>;
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
