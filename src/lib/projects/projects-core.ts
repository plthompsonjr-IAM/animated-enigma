/**
 * Pure project domain logic (Task 11): status model + transitions, permit and
 * payment labels, key-date helpers, and list sorting. No I/O — unit-testable
 * and shared by forms, actions, queries, and UI.
 */

export const PROJECT_STATUSES = [
  'planning',
  'scheduled',
  'in_progress',
  'punch_list',
  'completed',
  'warranty',
  'closed',
  'on_hold',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  punch_list: 'Punch list',
  completed: 'Completed',
  warranty: 'Warranty',
  closed: 'Closed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

/** Badge styling per status (Tailwind classes; readable in light and dark). */
export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  planning: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  scheduled: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  in_progress: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  punch_list: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warranty: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  closed: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  on_hold: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  cancelled: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

/** The normal forward flow (drives the "advance to" quick action). */
const FORWARD: Partial<Record<ProjectStatus, ProjectStatus>> = {
  planning: 'scheduled',
  scheduled: 'in_progress',
  in_progress: 'punch_list',
  punch_list: 'completed',
  completed: 'warranty',
  warranty: 'closed',
};

/** Active work states — shown in the default pipeline; excludes terminal/paused. */
export const OPEN_PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'scheduled',
  'in_progress',
  'punch_list',
];

export const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = ['closed', 'cancelled'];

/** The next status in the forward flow, or null at the end / for paused states. */
export function nextStatus(status: ProjectStatus): ProjectStatus | null {
  return FORWARD[status] ?? null;
}

/**
 * Any status can be set manually (jobs don't always move linearly — a project
 * can go on hold, be cancelled, or reopen), except a no-op or leaving a
 * cancelled project, which must be reopened to 'planning' explicitly.
 */
export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return false;
  if (from === 'cancelled' && to !== 'planning') return false;
  return true;
}

// ── Permit & payment display ─────────────────────────────────────────────────

export const PERMIT_STATUSES = [
  'not_required',
  'not_started',
  'applied',
  'approved',
  'inspections',
  'final_approved',
  'closed',
] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export const PERMIT_STATUS_LABELS: Record<PermitStatus, string> = {
  not_required: 'Not required',
  not_started: 'Not started',
  applied: 'Applied',
  approved: 'Approved',
  inspections: 'Inspections',
  final_approved: 'Final approved',
  closed: 'Closed',
};

export const PAYMENT_STATES = [
  'none',
  'deposit_due',
  'deposit_paid',
  'partial',
  'paid_in_full',
  'overdue',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  none: 'None',
  deposit_due: 'Deposit due',
  deposit_paid: 'Deposit paid',
  partial: 'Partially paid',
  paid_in_full: 'Paid in full',
  overdue: 'Overdue',
};

// ── Formatting ───────────────────────────────────────────────────────────────

/** Currency for contract value / budget; blank for null so the UI shows "—". */
export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/** Whole-day difference (b − a) in UTC; null if either date is missing. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Schedule health for an in-flight project: overdue if past expected completion
 * and not done; due-soon within a week; on-track otherwise. Terminal/complete
 * projects report 'none'.
 */
export type ScheduleHealth = 'overdue' | 'due_soon' | 'on_track' | 'none';

export function scheduleHealth(
  status: ProjectStatus,
  expectedCompletion: string | null,
  today: Date = new Date(),
): ScheduleHealth {
  if (!expectedCompletion) return 'none';
  if (['completed', 'warranty', 'closed', 'cancelled'].includes(status)) return 'none';
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const due = Date.parse(`${expectedCompletion}T00:00:00Z`);
  if (Number.isNaN(due)) return 'none';
  const days = Math.round((due - todayUtc) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_soon';
  return 'on_track';
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export const PROJECT_SORTS = ['recent', 'oldest', 'number', 'name', 'completion'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export const PROJECT_SORT_LABELS: Record<ProjectSort, string> = {
  recent: 'Newest first',
  oldest: 'Oldest first',
  number: 'Project number',
  name: 'Name A–Z',
  completion: 'Target completion',
};

export interface SortableProject {
  projectNumber: string;
  name: string;
  expectedCompletion: string | null;
  createdAt: string | Date;
}

export function sortProjects<T extends SortableProject>(rows: T[], sort: ProjectSort): T[] {
  const copy = [...rows];
  const time = (v: string | Date) => new Date(v).getTime();
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => time(a.createdAt) - time(b.createdAt));
    case 'number':
      return copy.sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'completion':
      // Nulls last, then earliest target first.
      return copy.sort((a, b) => {
        if (!a.expectedCompletion && !b.expectedCompletion) return 0;
        if (!a.expectedCompletion) return 1;
        if (!b.expectedCompletion) return -1;
        return a.expectedCompletion.localeCompare(b.expectedCompletion);
      });
    case 'recent':
    default:
      return copy.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  }
}
