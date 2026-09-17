/**
 * Lead-domain pure logic (no IO): statuses, labels, colors, allowed
 * transitions, follow-up urgency, sorting, and project-number formatting.
 * Kept side-effect free so it's unit-testable and shared by server and client.
 */

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'site_visit_scheduled',
  'estimating',
  'proposal_sent',
  'won',
  'lost',
  'on_hold',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  site_visit_scheduled: 'Site Visit Scheduled',
  estimating: 'Estimating',
  proposal_sent: 'Proposal Sent',
  won: 'Won',
  lost: 'Lost',
  on_hold: 'On Hold',
};

/** Tailwind classes per status for chips/badges (semantic, theme-aware). */
export const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  new: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  contacted: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30',
  qualified: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  site_visit_scheduled: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  estimating: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  proposal_sent: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  won: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  lost: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  on_hold: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

/** Terminal statuses — the pipeline is done for these. */
export const CLOSED_STATUSES: readonly LeadStatus[] = ['won', 'lost'];

/** Statuses considered "open pipeline" for dashboards/counts. */
export const OPEN_STATUSES: readonly LeadStatus[] = LEAD_STATUSES.filter(
  (s) => !CLOSED_STATUSES.includes(s) && s !== 'on_hold',
);

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  medium: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export const LEAD_SORTS = ['recent', 'oldest', 'follow_up', 'priority', 'name'] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const LEAD_SORT_LABELS: Record<LeadSort, string> = {
  recent: 'Newest first',
  oldest: 'Oldest first',
  follow_up: 'Follow-up due',
  priority: 'Priority',
  name: 'Name (A–Z)',
};

/**
 * Whether a status change is allowed. A lead can move to any non-terminal
 * status freely (contractors don't march leads through a rigid funnel), but a
 * lead marked Won can only leave Won via an explicit reopen, and a converted
 * lead (already a project) is locked to Won.
 */
export function canTransition(
  from: LeadStatus,
  to: LeadStatus,
  opts: { converted?: boolean } = {},
): boolean {
  if (from === to) return false;
  if (opts.converted) return false; // converted leads are locked to Won
  return true;
}

export type FollowUpUrgency = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/**
 * Classify a follow-up date relative to `today` (both compared by calendar
 * day). "soon" is within the next 2 days.
 */
export function followUpUrgency(
  nextFollowUp: string | Date | null | undefined,
  today: Date = new Date(),
): FollowUpUrgency {
  if (!nextFollowUp) return 'none';
  const due = toDayNumber(new Date(nextFollowUp));
  const now = toDayNumber(today);
  if (due < now) return 'overdue';
  if (due === now) return 'today';
  if (due <= now + 2) return 'soon';
  return 'later';
}

export const FOLLOW_UP_STYLES: Record<FollowUpUrgency, string> = {
  overdue: 'text-red-600 dark:text-red-400 font-semibold',
  today: 'text-amber-600 dark:text-amber-400 font-semibold',
  soon: 'text-foreground',
  later: 'text-muted-foreground',
  none: 'text-muted-foreground',
};

function toDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/** Format a per-org sequential project number, e.g. PRJ-2026-0007. */
export function formatProjectNumber(year: number, sequence: number): string {
  return `PRJ-${year}-${String(sequence).padStart(4, '0')}`;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export interface SortableLead {
  leadName: string;
  priority: Priority;
  nextFollowUpDate: string | Date | null;
  createdAt: string | Date;
}

/** Deterministic in-memory sort matching the DB ordering (used in tests/UI). */
export function sortLeads<T extends SortableLead>(leads: readonly T[], sort: LeadSort): T[] {
  const copy = [...leads];
  switch (sort) {
    case 'recent':
      return copy.sort((a, b) => time(b.createdAt) - time(a.createdAt));
    case 'oldest':
      return copy.sort((a, b) => time(a.createdAt) - time(b.createdAt));
    case 'name':
      return copy.sort((a, b) => a.leadName.localeCompare(b.leadName));
    case 'priority':
      return copy.sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          time(b.createdAt) - time(a.createdAt),
      );
    case 'follow_up':
      // Leads with a follow-up date first (earliest first); dateless last.
      return copy.sort((a, b) => {
        const av = a.nextFollowUpDate ? time(a.nextFollowUpDate) : Infinity;
        const bv = b.nextFollowUpDate ? time(b.nextFollowUpDate) : Infinity;
        return av - bv || time(b.createdAt) - time(a.createdAt);
      });
    default:
      return copy;
  }
}

function time(v: string | Date): number {
  return new Date(v).getTime();
}
