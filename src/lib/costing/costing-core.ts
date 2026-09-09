/**
 * Pure job-costing logic (Task 29): time entries, expenses, and what they add up
 * to against a job's contract value.
 *
 * The central judgement in this module: **cost-to-date on a running job is not
 * margin.** A job that's 30% built and 50% billed looks wildly profitable and
 * isn't. So the numbers are reported as burn while work is in progress, and only
 * settle into an actual margin once the job is done. `jobCostPosition` carries
 * that distinction explicitly rather than leaving it to whoever reads the page.
 *
 * No I/O, so all of it is unit-testable.
 */

import { isDay } from '@/lib/schedule/schedule-core';
import { toNum } from '@/lib/catalog/catalog-core';

// ── Time entries ─────────────────────────────────────────────────────────────

export const TIME_ENTRY_STATUSES = ['open', 'submitted', 'approved', 'rejected'] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export const TIME_ENTRY_STATUS_LABELS: Record<TimeEntryStatus, string> = {
  open: 'Open',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const TIME_ENTRY_STATUS_STYLES: Record<TimeEntryStatus, string> = {
  open: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  submitted: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export function isTimeEntryStatus(value: string): value is TimeEntryStatus {
  return (TIME_ENTRY_STATUSES as readonly string[]).includes(value);
}

/** A rejected entry is not work anyone is paying for. */
export function countsTowardCost(status: TimeEntryStatus): boolean {
  return status !== 'rejected';
}

/** Nobody works a 20-hour shift; past this it's a forgotten clock-out. */
export const MAX_SHIFT_HOURS = 16;

/**
 * Worked hours from a clock-in/out pair, less breaks. Returns null when the
 * entry is still running — an open shift has no total yet, and reporting one
 * would be inventing it.
 */
export function computeHours(
  clockIn: Date | string | null | undefined,
  clockOut: Date | string | null | undefined,
  breakMinutes: number | string | null | undefined = 0,
): number | null {
  if (!clockIn || !clockOut) return null;
  const start = new Date(clockIn);
  const end = new Date(clockOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const grossMs = end.getTime() - start.getTime();
  if (grossMs <= 0) return null;

  const breaks = Math.max(0, toNum(breakMinutes)) * 60_000;
  const netMs = grossMs - breaks;
  if (netMs <= 0) return 0;
  return round2(netMs / 3_600_000);
}

export interface TimeEntryInput {
  clockIn?: Date | string | null;
  clockOut?: Date | string | null;
  breakMinutes?: number | string | null;
  status?: TimeEntryStatus;
}

export function validateTimeEntry(
  input: TimeEntryInput,
  now: Date = new Date(),
): { error?: string } {
  if (!input.clockIn) return { error: 'A time entry needs a start time.' };
  const start = new Date(input.clockIn);
  if (Number.isNaN(start.getTime())) return { error: 'That start time isn’t valid.' };

  // A little tolerance for clock skew between a phone and the server.
  if (start.getTime() > now.getTime() + 5 * 60_000) {
    return { error: 'You can’t clock in ahead of time.' };
  }

  const breaks = toNum(input.breakMinutes);
  if (!Number.isFinite(breaks) || breaks < 0) return { error: 'Break minutes can’t be negative.' };

  if (!input.clockOut) {
    // An open shift is valid — that's someone still on the clock.
    return {};
  }

  const end = new Date(input.clockOut);
  if (Number.isNaN(end.getTime())) return { error: 'That end time isn’t valid.' };
  if (end.getTime() <= start.getTime()) {
    return { error: 'The end time has to be after the start time.' };
  }
  if (end.getTime() > now.getTime() + 5 * 60_000) {
    return { error: 'You can’t clock out ahead of time.' };
  }

  const grossHours = (end.getTime() - start.getTime()) / 3_600_000;
  if (grossHours > MAX_SHIFT_HOURS) {
    return {
      error: `That's ${Math.round(grossHours)} hours — check the times, or split it into two entries.`,
    };
  }
  if (breaks * 60_000 >= end.getTime() - start.getTime()) {
    return { error: 'The break is longer than the shift.' };
  }
  return {};
}

export interface TimeRange {
  clockIn: Date | string | null | undefined;
  clockOut: Date | string | null | undefined;
}

/**
 * Do two shifts for the same person overlap? The database enforces this with an
 * exclusion constraint; this exists so the form can say so in plain language
 * before the round trip. An open shift runs to infinity, which is the point —
 * you can't start a second one while the first is still going.
 */
export function shiftsOverlap(a: TimeRange, b: TimeRange): boolean {
  const aStart = toTime(a.clockIn);
  const bStart = toTime(b.clockIn);
  if (aStart === null || bStart === null) return false;
  const aEnd = toTime(a.clockOut) ?? Number.POSITIVE_INFINITY;
  const bEnd = toTime(b.clockOut) ?? Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** What an hour of someone's time costs the business. */
export function labourCost(
  hours: number | string | null | undefined,
  hourlyCostRate: number | string | null | undefined,
): number {
  const h = toNum(hours);
  const rate = toNum(hourlyCostRate);
  if (h <= 0 || rate <= 0) return 0;
  return round2(h * rate);
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  'material',
  'subcontractor',
  'equipment_rental',
  'permit_fee',
  'disposal',
  'fuel_mileage',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  material: 'Materials',
  subcontractor: 'Subcontractor',
  equipment_rental: 'Equipment rental',
  permit_fee: 'Permit fees',
  disposal: 'Disposal',
  fuel_mileage: 'Fuel & mileage',
  other: 'Other',
};

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export const MAX_EXPENSE_AMOUNT = 1_000_000;

export interface ExpenseInput {
  description: string;
  amount: number | string | null | undefined;
  expenseDate: string;
  category?: ExpenseCategory;
  vendor?: string | null;
}

export function validateExpense(input: ExpenseInput, now: Date = new Date()): { error?: string } {
  const description = input.description?.trim() ?? '';
  if (description.length === 0) return { error: 'Say what this expense was for.' };
  if (description.length > 300) return { error: 'Keep the description under 300 characters.' };

  // Checked before coercing: toNum turns anything unparseable into 0, which
  // would report "an expense of zero" to someone who typed a word.
  const amount = parseAmount(input.amount);
  if (amount === null) return { error: 'The amount has to be a number.' };
  if (amount === 0) return { error: 'An expense of zero isn’t worth recording.' };
  if (Math.abs(amount) > MAX_EXPENSE_AMOUNT) {
    return { error: 'That amount looks wrong — check it.' };
  }

  if (!isDay(input.expenseDate)) return { error: 'Pick a valid date.' };
  const todayIso = now.toISOString().slice(0, 10);
  if (input.expenseDate > todayIso) {
    return { error: 'An expense records money already spent — it can’t be dated ahead.' };
  }

  if (input.category && !isExpenseCategory(input.category)) {
    return { error: 'Unrecognised category.' };
  }
  return {};
}

/**
 * Strictly reads a money amount. Null for anything that isn't a number, so a
 * typo gets its own message instead of being silently treated as zero. Accepts
 * the currency symbols and separators people actually paste in.
 */
export function parseAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const cleaned = value.trim().replace(/[$,\s]/g, '');
  if (cleaned.length === 0) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A sensible category from the vendor or description, so the common cases land
 * without picking from a seven-item menu on a phone.
 */
export function guessExpenseCategory(text: string): ExpenseCategory {
  const value = text.toLowerCase();
  const rules: [RegExp, ExpenseCategory][] = [
    [/dumpster|disposal|landfill|haul.?away|debris/, 'disposal'],
    [/permit|inspection fee|plan review/, 'permit_fee'],
    [/rental|rent |sunbelt|united rentals|scaffold|lift/, 'equipment_rental'],
    [/fuel|gas station|mileage|diesel/, 'fuel_mileage'],
    [/plumb|electric|hvac|drywall|sub |subcontract/, 'subcontractor'],
    [/home depot|lowe|menards|supply|lumber|hardware|tile|paint/, 'material'],
  ];
  for (const [pattern, category] of rules) {
    if (pattern.test(value)) return category;
  }
  return 'material';
}

// ── Rolling it up ────────────────────────────────────────────────────────────

export interface CostBreakdown {
  labour: number;
  labourHours: number;
  material: number;
  subcontractor: number;
  otherExpenses: number;
  total: number;
}

export interface LabourLine {
  hours: number | string | null | undefined;
  hourlyCostRate: number | string | null | undefined;
  status: TimeEntryStatus;
}

export interface ExpenseLine {
  amount: number | string | null | undefined;
  category: ExpenseCategory;
}

/**
 * What a job has actually cost so far. Rejected time is excluded — it isn't work
 * anyone is paying for.
 */
export function costBreakdown(labour: LabourLine[], expenses: ExpenseLine[]): CostBreakdown {
  let labourTotal = 0;
  let labourHours = 0;
  for (const line of labour) {
    if (!countsTowardCost(line.status)) continue;
    const hours = toNum(line.hours);
    labourHours = round2(labourHours + hours);
    labourTotal = round2(labourTotal + labourCost(hours, line.hourlyCostRate));
  }

  let material = 0;
  let subcontractor = 0;
  let otherExpenses = 0;
  for (const expense of expenses) {
    const amount = toNum(expense.amount);
    if (expense.category === 'material') material = round2(material + amount);
    else if (expense.category === 'subcontractor')
      subcontractor = round2(subcontractor + amount);
    else otherExpenses = round2(otherExpenses + amount);
  }

  return {
    labour: labourTotal,
    labourHours,
    material,
    subcontractor,
    otherExpenses,
    total: round2(labourTotal + material + subcontractor + otherExpenses),
  };
}

/**
 * How far along a job is, which decides whether its numbers are a margin or a
 * burn rate.
 */
export type JobPhase = 'in_progress' | 'complete';

export interface JobCostPosition {
  phase: JobPhase;
  cost: CostBreakdown;
  /** Revised contract value — what the job is worth. Null without a contract. */
  contractValue: number | null;
  invoiced: number;
  /** Cost as a share of contract value, 0–100. Null without a contract. */
  spentPercent: number | null;
  /** Invoiced as a share of contract value, 0–100. Null without a contract. */
  billedPercent: number | null;
  /**
   * Contract value less cost. On a finished job this is the actual margin. On a
   * running one it is only the gap so far, which is why `phase` is carried
   * alongside it and the UI labels the two differently.
   */
  grossProfit: number | null;
  /** Gross profit as a share of contract value, 0–100. */
  marginPercent: number | null;
  /**
   * True when the job is spending faster than it's billing. The single most
   * useful mid-job signal there is, and it's meaningful even though margin
   * isn't yet.
   */
  spendingAheadOfBilling: boolean;
}

/**
 * The cost picture for one job.
 *
 * On a job still running, `grossProfit` is *not* a margin and must not be
 * presented as one: a job 30% built and 50% billed looks wonderful and isn't.
 * What is meaningful mid-job is the comparison between what's been spent and
 * what's been billed, which is why that comes out as its own flag.
 */
export function jobCostPosition(args: {
  phase: JobPhase;
  labour: LabourLine[];
  expenses: ExpenseLine[];
  contractValue: number | null;
  invoiced: number;
}): JobCostPosition {
  const cost = costBreakdown(args.labour, args.expenses);
  const value = args.contractValue;

  const spentPercent = value !== null && value > 0 ? Math.round((cost.total / value) * 100) : null;
  const billedPercent =
    value !== null && value > 0 ? Math.round((args.invoiced / value) * 100) : null;

  const grossProfit = value === null ? null : round2(value - cost.total);
  const marginPercent =
    value !== null && value > 0 ? Math.round((grossProfit! / value) * 100) : null;

  return {
    phase: args.phase,
    cost,
    contractValue: value,
    invoiced: args.invoiced,
    spentPercent,
    billedPercent,
    grossProfit,
    marginPercent,
    // Only meaningful once there's a contract and something has actually moved.
    spendingAheadOfBilling:
      spentPercent !== null && billedPercent !== null && spentPercent > billedPercent + 10,
  };
}

/**
 * The label for the profit figure. Blunt on purpose — "margin" on a running job
 * is the number people quote at each other and then get surprised by.
 */
export function profitLabel(phase: JobPhase): string {
  return phase === 'complete' ? 'Gross profit' : 'Value less cost so far';
}

/** Whether the margin figure is safe to treat as a result rather than a guess. */
export function marginIsFinal(phase: JobPhase): boolean {
  return phase === 'complete';
}

export interface PortfolioCost {
  labour: number;
  labourHours: number;
  expenses: number;
  total: number;
  /** Only across finished jobs — the only place a real margin exists. */
  completedRevenue: number;
  completedCost: number;
  completedMarginPercent: number | null;
}

/**
 * Company-wide costs. The margin here is deliberately computed from finished
 * jobs only: mixing in half-built ones produces a number that looks like a
 * margin and behaves like noise.
 */
export function portfolioCost(positions: JobCostPosition[]): PortfolioCost {
  let labour = 0;
  let labourHours = 0;
  let expenses = 0;
  let completedRevenue = 0;
  let completedCost = 0;

  for (const position of positions) {
    labour = round2(labour + position.cost.labour);
    labourHours = round2(labourHours + position.cost.labourHours);
    expenses = round2(
      expenses +
        position.cost.material +
        position.cost.subcontractor +
        position.cost.otherExpenses,
    );
    if (position.phase === 'complete' && position.contractValue !== null) {
      completedRevenue = round2(completedRevenue + position.contractValue);
      completedCost = round2(completedCost + position.cost.total);
    }
  }

  return {
    labour,
    labourHours,
    expenses,
    total: round2(labour + expenses),
    completedRevenue,
    completedCost,
    completedMarginPercent:
      completedRevenue > 0
        ? Math.round(((completedRevenue - completedCost) / completedRevenue) * 100)
        : null,
  };
}

/** "7.25 h" — hours as a person would write them. */
export function formatHours(hours: number | string | null | undefined): string {
  const value = toNum(hours);
  if (!Number.isFinite(value) || value === 0) return '0 h';
  return `${round2(value)} h`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
