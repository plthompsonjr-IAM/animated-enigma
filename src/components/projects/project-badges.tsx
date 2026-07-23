import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_STYLES,
  scheduleHealth,
  type ProjectStatus,
} from '@/lib/projects/projects-core';
import { cn } from '@/lib/utils';

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        PROJECT_STATUS_STYLES[status],
      )}
    >
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

/** Short schedule-health note for a project's target completion date. */
export function ScheduleHealthText({
  status,
  expectedCompletion,
}: {
  status: ProjectStatus;
  expectedCompletion: string | null;
}) {
  const health = scheduleHealth(status, expectedCompletion);
  if (health === 'none' || !expectedCompletion) {
    return <span className="text-muted-foreground">{formatDate(expectedCompletion) || '—'}</span>;
  }
  const styles: Record<Exclude<typeof health, 'none'>, string> = {
    overdue: 'text-red-600 dark:text-red-400 font-medium',
    due_soon: 'text-amber-600 dark:text-amber-400 font-medium',
    on_track: 'text-muted-foreground',
  };
  const labels: Record<Exclude<typeof health, 'none'>, string> = {
    overdue: 'Overdue',
    due_soon: 'Due soon',
    on_track: '',
  };
  return (
    <span className={styles[health]}>
      {formatDate(expectedCompletion)}
      {labels[health] ? ` · ${labels[health]}` : ''}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
