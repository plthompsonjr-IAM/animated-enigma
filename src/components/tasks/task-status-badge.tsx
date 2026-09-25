import {
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_STYLES,
  type Priority,
  type TaskStatus,
} from '@/lib/tasks/tasks-core';
import { cn } from '@/lib/utils';

export function TaskStatusBadge({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TASK_STATUS_STYLES[status],
        className,
      )}
    >
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

/** Priority is only worth showing when it isn't the default. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === 'medium') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        priority === 'high'
          ? 'bg-red-500/15 text-red-700 dark:text-red-300'
          : 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
