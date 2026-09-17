/**
 * Pure dashboard logic (Task 27): turning raw counts into a prioritised list of
 * what actually needs attention today.
 *
 * The point of this module is triage. A dashboard that shows twelve numbers
 * makes you do the thinking; this decides what matters first — money you're
 * owed, crews double-booked, work running late — and says what to do about it.
 * No I/O, so all of it is unit-testable.
 */

import { formatMoney } from '@/lib/invoices/invoices-core';

export const SEVERITIES = ['critical', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'border-red-500/40 bg-red-500/10',
  warning: 'border-amber-500/40 bg-amber-500/10',
  info: 'border-border bg-secondary/40',
};

export const SEVERITY_TEXT_STYLES: Record<Severity, string> = {
  critical: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
};

export interface AttentionItem {
  id: string;
  severity: Severity;
  /** What's wrong, in the fewest words that are still specific. */
  title: string;
  /** What to do about it. */
  detail: string;
  href: string;
  /** How many things this covers — drives ordering within a severity. */
  count: number;
}

/**
 * The raw signals a dashboard has to work from. Everything is a plain count or
 * amount so this function stays pure and the queries stay in one place.
 */
export interface DashboardSignals {
  overdueInvoiceAmount: number;
  overdueInvoiceCount: number;
  outstandingAmount: number;
  overdueTasks: number;
  blockedTasks: number;
  overdueScheduleItems: number;
  crewConflicts: number;
  crossProjectConflicts: number;
  projectsMissingTodaysLog: number;
  overdueLeadFollowUps: number;
  proposalsAwaitingResponse: number;
  unbilledApprovedChangeOrders: number;
  upcomingVisits: number;
  unsignedActiveContracts: number;
}

export const EMPTY_SIGNALS: DashboardSignals = {
  overdueInvoiceAmount: 0,
  overdueInvoiceCount: 0,
  outstandingAmount: 0,
  overdueTasks: 0,
  blockedTasks: 0,
  overdueScheduleItems: 0,
  crewConflicts: 0,
  crossProjectConflicts: 0,
  projectsMissingTodaysLog: 0,
  overdueLeadFollowUps: 0,
  proposalsAwaitingResponse: 0,
  unbilledApprovedChangeOrders: 0,
  upcomingVisits: 0,
  unsignedActiveContracts: 0,
};

/**
 * What needs attention, worst first. Only real problems appear — an empty list
 * means nothing is on fire, which is information worth trusting.
 *
 * Severity is assigned by consequence, not by size: one crew double-booked
 * across two jobs costs a day and outranks ten tasks running slightly late.
 */
export function buildAttentionList(signals: DashboardSignals): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (signals.overdueInvoiceAmount > 0) {
    items.push({
      id: 'overdue-invoices',
      severity: 'critical',
      title: `${formatMoney(signals.overdueInvoiceAmount)} past due`,
      detail:
        signals.overdueInvoiceCount === 1
          ? 'One invoice is past its due date. Chase it before it ages further.'
          : `${signals.overdueInvoiceCount} invoices are past their due date.`,
      href: '/invoices',
      count: signals.overdueInvoiceCount,
    });
  }

  if (signals.crossProjectConflicts > 0) {
    items.push({
      id: 'cross-project-conflicts',
      severity: 'critical',
      title:
        signals.crossProjectConflicts === 1
          ? 'Someone is booked on two jobs at once'
          : `${signals.crossProjectConflicts} crew clashes across jobs`,
      detail:
        'Nobody looking at one job can see this. Move the work or move the person before the day arrives.',
      href: '/schedule',
      count: signals.crossProjectConflicts,
    });
  }

  const sameProjectConflicts = Math.max(0, signals.crewConflicts - signals.crossProjectConflicts);
  if (sameProjectConflicts > 0) {
    items.push({
      id: 'crew-conflicts',
      severity: 'warning',
      title: `${sameProjectConflicts} crew double-${sameProjectConflicts === 1 ? 'booking' : 'bookings'}`,
      detail: 'The same person is on overlapping work items within a job.',
      href: '/schedule',
      count: sameProjectConflicts,
    });
  }

  if (signals.overdueScheduleItems > 0) {
    items.push({
      id: 'overdue-schedule',
      severity: 'warning',
      title: `${signals.overdueScheduleItems} phase${signals.overdueScheduleItems === 1 ? '' : 's'} past its end date`,
      detail: 'Either the work slipped or the schedule is stale. Both are worth ten minutes.',
      href: '/schedule',
      count: signals.overdueScheduleItems,
    });
  }

  if (signals.overdueTasks > 0) {
    items.push({
      id: 'overdue-tasks',
      severity: 'warning',
      title: `${signals.overdueTasks} task${signals.overdueTasks === 1 ? '' : 's'} late`,
      detail: 'Past their due date and not finished.',
      href: '/tasks',
      count: signals.overdueTasks,
    });
  }

  if (signals.unbilledApprovedChangeOrders > 0) {
    items.push({
      id: 'unbilled-change-orders',
      severity: 'warning',
      title: `${signals.unbilledApprovedChangeOrders} approved change order${
        signals.unbilledApprovedChangeOrders === 1 ? '' : 's'
      } not billed`,
      detail: 'The client approved the extra work. Invoice it before the job closes out.',
      href: '/contracts',
      count: signals.unbilledApprovedChangeOrders,
    });
  }

  if (signals.overdueLeadFollowUps > 0) {
    items.push({
      id: 'lead-followups',
      severity: 'warning',
      title: `${signals.overdueLeadFollowUps} lead follow-up${
        signals.overdueLeadFollowUps === 1 ? '' : 's'
      } overdue`,
      detail: 'A lead you meant to call and haven’t. This is the cheapest work on the list.',
      href: '/leads',
      count: signals.overdueLeadFollowUps,
    });
  }

  if (signals.projectsMissingTodaysLog > 0) {
    items.push({
      id: 'missing-logs',
      severity: 'warning',
      title: `${signals.projectsMissingTodaysLog} active job${
        signals.projectsMissingTodaysLog === 1 ? '' : 's'
      } with no log today`,
      detail: 'Gaps in the daily record are what undermine a delay claim later.',
      href: '/daily-logs',
      count: signals.projectsMissingTodaysLog,
    });
  }

  if (signals.blockedTasks > 0) {
    items.push({
      id: 'blocked-tasks',
      severity: 'info',
      title: `${signals.blockedTasks} task${signals.blockedTasks === 1 ? '' : 's'} blocked`,
      detail: 'Waiting on work that isn’t finished. Worth checking the sequence still makes sense.',
      href: '/tasks',
      count: signals.blockedTasks,
    });
  }

  if (signals.proposalsAwaitingResponse > 0) {
    items.push({
      id: 'proposals-out',
      severity: 'info',
      title: `${signals.proposalsAwaitingResponse} proposal${
        signals.proposalsAwaitingResponse === 1 ? '' : 's'
      } awaiting a decision`,
      detail: 'Sent and not yet answered.',
      href: '/proposals',
      count: signals.proposalsAwaitingResponse,
    });
  }

  if (signals.unsignedActiveContracts > 0) {
    items.push({
      id: 'contracts-unsigned',
      severity: 'warning',
      title: `${signals.unsignedActiveContracts} live contract${
        signals.unsignedActiveContracts === 1 ? '' : 's'
      } with no signature on file`,
      detail:
        'The job is running against a contract nobody signed. That is the first thing asked for in a dispute.',
      href: '/contracts',
      count: signals.unsignedActiveContracts,
    });
  }

  return sortAttention(items);
}

/** Worst first; within a severity, the biggest pile first. */
export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (b.count !== a.count) return b.count - a.count;
    return a.title.localeCompare(b.title);
  });
}

/** How many of each severity — drives the summary line above the list. */
export function countBySeverity(items: AttentionItem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const item of items) counts[item.severity]++;
  return counts;
}

/**
 * The one-line read on the day. Deliberately plain: a foreman glancing at this
 * on a phone should know in a second whether to keep scrolling.
 */
export function headline(items: AttentionItem[]): string {
  const counts = countBySeverity(items);
  if (items.length === 0) return 'Nothing needs attention. Everything is on track.';
  if (counts.critical > 0) {
    return counts.critical === 1
      ? 'One thing needs dealing with today.'
      : `${counts.critical} things need dealing with today.`;
  }
  if (counts.warning > 0) {
    return counts.warning === 1
      ? 'One thing worth a look.'
      : `${counts.warning} things worth a look.`;
  }
  return 'Nothing urgent — a few things to keep an eye on.';
}

// ── KPI tiles ────────────────────────────────────────────────────────────────

export interface KpiTile {
  label: string;
  value: string;
  /** Context under the number, when there is any worth giving. */
  note?: string;
  href?: string;
  tone?: 'bad' | 'good';
}

/**
 * The headline numbers. Money tiles are only built when the caller has
 * permission to see money — the split happens here so no screen has to
 * remember it.
 */
export function buildKpis(args: {
  signals: DashboardSignals;
  openProjects: number;
  openTasks: number;
  newLeads: number;
  showMoney: boolean;
}): KpiTile[] {
  const tiles: KpiTile[] = [
    {
      label: 'Active jobs',
      value: String(args.openProjects),
      href: '/projects',
    },
    {
      label: 'Open tasks',
      value: String(args.openTasks),
      note: args.signals.overdueTasks > 0 ? `${args.signals.overdueTasks} late` : undefined,
      href: '/tasks',
      tone: args.signals.overdueTasks > 0 ? 'bad' : undefined,
    },
    {
      label: 'New leads',
      value: String(args.newLeads),
      note:
        args.signals.overdueLeadFollowUps > 0
          ? `${args.signals.overdueLeadFollowUps} follow-ups overdue`
          : undefined,
      href: '/leads',
      tone: args.signals.overdueLeadFollowUps > 0 ? 'bad' : undefined,
    },
  ];

  if (args.showMoney) {
    tiles.push({
      label: 'Outstanding',
      value: formatMoney(args.signals.outstandingAmount),
      note:
        args.signals.overdueInvoiceAmount > 0
          ? `${formatMoney(args.signals.overdueInvoiceAmount)} past due`
          : undefined,
      href: '/invoices',
      tone: args.signals.overdueInvoiceAmount > 0 ? 'bad' : undefined,
    });
  }

  return tiles;
}
