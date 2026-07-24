/**
 * Pure site-visit domain logic (Task 12): type/status labels, scheduling-time
 * formatting, upcoming/past grouping, and urgency. No I/O — unit-testable and
 * shared by forms, actions, queries, and UI.
 */

export const VISIT_TYPES = [
  'estimate',
  'measurement',
  'inspection',
  'walkthrough',
  'other',
] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_TYPE_LABELS: Record<VisitType, string> = {
  estimate: 'Estimate visit',
  measurement: 'Measurement',
  inspection: 'Inspection',
  walkthrough: 'Walkthrough',
  other: 'Site visit',
};

export const VISIT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const VISIT_STATUS_STYLES: Record<VisitStatus, string> = {
  scheduled: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  cancelled: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
};

/** Common visit durations offered in the scheduling form. */
export const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
] as const;

// ── Formatting ───────────────────────────────────────────────────────────────

/** "Thu, Jul 30" for a scheduled timestamp; empty if missing/invalid. */
export function formatVisitDate(at: string | Date | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "2:30 PM" for a scheduled timestamp; empty if missing/invalid. */
export function formatVisitTime(at: string | Date | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** ISO date key (YYYY-MM-DD) in local time — for day grouping. */
export function dayKey(at: string | Date): string {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Urgency ──────────────────────────────────────────────────────────────────

export type VisitUrgency = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'none';

/**
 * How pressing a scheduled visit is, relative to `now`. Only 'scheduled' visits
 * carry urgency; completed/cancelled ones report 'none'. A scheduled visit
 * whose time has passed is 'overdue' (needs completing or rescheduling).
 */
export function visitUrgency(
  status: VisitStatus,
  scheduledAt: string | Date | null,
  now: Date = new Date(),
): VisitUrgency {
  if (status !== 'scheduled' || !scheduledAt) return 'none';
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return 'none';
  if (at.getTime() < now.getTime()) return 'overdue';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 86_400_000;
  const diffDays = Math.floor((atMidnight(at) - startOfToday.getTime()) / dayMs);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return 'upcoming';
}

function atMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface SchedulableVisit {
  id: string;
  scheduledAt: string | Date | null;
  status: VisitStatus;
}

/** Split visits into upcoming (scheduled, now or future) and past/other, each
 * sorted sensibly: upcoming ascending (soonest first), past descending. */
export function partitionVisits<T extends SchedulableVisit>(
  visits: T[],
  now: Date = new Date(),
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const v of visits) {
    const isUpcoming =
      v.status === 'scheduled' &&
      v.scheduledAt != null &&
      new Date(v.scheduledAt).getTime() >= startOfDay(now);
    (isUpcoming ? upcoming : past).push(v);
  }
  upcoming.sort((a, b) => time(a.scheduledAt) - time(b.scheduledAt));
  past.sort((a, b) => time(b.scheduledAt) - time(a.scheduledAt));
  return { upcoming, past };
}

/** Group visits by calendar day (YYYY-MM-DD), preserving input order within a day. */
export function groupByDay<T extends SchedulableVisit>(
  visits: T[],
): { day: string; visits: T[] }[] {
  const map = new Map<string, T[]>();
  for (const v of visits) {
    if (!v.scheduledAt) continue;
    const key = dayKey(v.scheduledAt);
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  }
  return [...map.entries()].map(([day, vs]) => ({ day, visits: vs }));
}

function time(at: string | Date | null): number {
  return at ? new Date(at).getTime() : 0;
}

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
