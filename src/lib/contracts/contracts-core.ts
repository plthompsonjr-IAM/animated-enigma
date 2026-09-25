/**
 * Pure contract logic (Task 20): the status lifecycle, contract numbering, the
 * payment-structure catalog, and payment-schedule math. No I/O —
 * unit-testable and shared by forms, actions, queries, and UI.
 *
 * The financial-integrity rule from the PRD drives the design: a contract is
 * freely editable while draft, and frozen once active. Corrections after that
 * are formal revisions (change orders, Task 21+), never silent edits.
 */

import { toNum } from '@/lib/catalog/catalog-core';

export const CONTRACT_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const CONTRACT_STATUS_STYLES: Record<ContractStatus, string> = {
  draft: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  completed: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  cancelled: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

/** Allowed status moves. Terminal states have no exits. */
const TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function allowedTransitions(from: ContractStatus): readonly ContractStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Terms and money may only change while the contract is a draft. Once active it
 * is a binding record — the UI hides edit affordances and the actions refuse.
 */
export function isEditable(status: ContractStatus): boolean {
  return status === 'draft';
}

/** Frozen: active, completed, or cancelled contracts are read-only. */
export function isFrozen(status: ContractStatus): boolean {
  return !isEditable(status);
}

export function formatContractNumber(year: number, seq: number): string {
  return `CON-${year}-${String(seq).padStart(4, '0')}`;
}

// ── Payment structures ───────────────────────────────────────────────────────

export const PAYMENT_STRUCTURES = [
  'deposit_balance',
  'percentage',
  'milestone',
  'time_materials',
  'maintenance',
] as const;
export type PaymentStructure = (typeof PAYMENT_STRUCTURES)[number];

export const PAYMENT_STRUCTURE_LABELS: Record<PaymentStructure, string> = {
  deposit_balance: 'Deposit & balance (75/25)',
  percentage: 'Percentage draws',
  milestone: 'Milestone-based',
  time_materials: 'Time & materials',
  maintenance: 'Recurring maintenance',
};

export const PAYMENT_STRUCTURE_HINTS: Record<PaymentStructure, string> = {
  deposit_balance: 'Deposit up front, balance at completion.',
  percentage: 'Even draws across the job.',
  milestone: 'Payments tied to named milestones you define.',
  time_materials: 'Billed as work happens; no fixed schedule.',
  maintenance: 'Repeating charge for ongoing service.',
};

export const MILESTONE_TRIGGERS = ['deposit', 'date', 'milestone', 'final'] as const;
export type MilestoneTrigger = (typeof MILESTONE_TRIGGERS)[number];

export const MILESTONE_TRIGGER_LABELS: Record<MilestoneTrigger, string> = {
  deposit: 'Deposit',
  date: 'On a date',
  milestone: 'On milestone',
  final: 'Final payment',
};

export function isPaymentStructure(value: string): value is PaymentStructure {
  return (PAYMENT_STRUCTURES as readonly string[]).includes(value);
}

// ── Schedule math ────────────────────────────────────────────────────────────

export interface MilestoneInput {
  name: string;
  /** Explicit dollar amount. Takes precedence over percentage when both are set. */
  amount?: string | number | null;
  /** Share of the contract value, 0–100. */
  percentage?: string | number | null;
  triggerType?: MilestoneTrigger | null;
  dueDate?: string | null;
  sortOrder?: number;
}

/**
 * Resolve a milestone to dollars. An explicit amount wins; otherwise the
 * percentage is applied to the contract value. Rounded to cents.
 */
export function milestoneAmount(milestone: MilestoneInput, contractValue: number): number {
  if (milestone.amount !== null && milestone.amount !== undefined && milestone.amount !== '') {
    return round2(toNum(milestone.amount));
  }
  if (
    milestone.percentage !== null &&
    milestone.percentage !== undefined &&
    milestone.percentage !== ''
  ) {
    return round2((toNum(milestone.percentage) / 100) * contractValue);
  }
  return 0;
}

export function sumMilestones(milestones: MilestoneInput[], contractValue: number): number {
  return round2(milestones.reduce((total, m) => total + milestoneAmount(m, contractValue), 0));
}

export interface ScheduleValidation {
  ok: boolean;
  total: number;
  /** contractValue − total. Positive means under-scheduled. */
  remainder: number;
  error?: string;
}

/**
 * A payment schedule must account for the whole contract value — money that is
 * never scheduled is money you forget to bill. Tolerance is one cent to absorb
 * percentage rounding. Time & materials and maintenance are exempt: they have
 * no fixed draw schedule by definition.
 */
export function validateSchedule(
  milestones: MilestoneInput[],
  contractValue: number,
  structure: PaymentStructure = 'milestone',
): ScheduleValidation {
  const total = sumMilestones(milestones, contractValue);
  const remainder = round2(contractValue - total);

  if (structure === 'time_materials' || structure === 'maintenance') {
    return { ok: true, total, remainder };
  }
  if (milestones.length === 0) {
    return { ok: false, total, remainder, error: 'Add at least one payment.' };
  }
  if (milestones.some((m) => !m.name.trim())) {
    return { ok: false, total, remainder, error: 'Every payment needs a name.' };
  }
  if (milestones.some((m) => milestoneAmount(m, contractValue) < 0)) {
    return { ok: false, total, remainder, error: 'Payments cannot be negative.' };
  }
  if (Math.abs(remainder) > 0.01) {
    const verb = remainder > 0 ? 'short of' : 'over';
    return {
      ok: false,
      total,
      remainder,
      error: `Payments total ${formatMoney(total)} — ${formatMoney(Math.abs(remainder))} ${verb} the contract value of ${formatMoney(contractValue)}.`,
    };
  }
  return { ok: true, total, remainder };
}

/**
 * Sensible starting milestones for a structure, so the office isn't typing the
 * common cases by hand. Percentages (not amounts) are used where the split is
 * proportional, so the schedule survives a contract-value change while draft.
 */
export function defaultMilestones(structure: PaymentStructure): MilestoneInput[] {
  switch (structure) {
    case 'deposit_balance':
      return [
        { name: 'Deposit', percentage: 75, triggerType: 'deposit', sortOrder: 0 },
        { name: 'Balance on completion', percentage: 25, triggerType: 'final', sortOrder: 1 },
      ];
    case 'percentage':
      return [
        { name: 'Deposit', percentage: 30, triggerType: 'deposit', sortOrder: 0 },
        { name: 'Progress draw', percentage: 40, triggerType: 'milestone', sortOrder: 1 },
        { name: 'Final payment', percentage: 30, triggerType: 'final', sortOrder: 2 },
      ];
    case 'milestone':
      return [
        { name: 'Deposit', percentage: 50, triggerType: 'deposit', sortOrder: 0 },
        { name: 'Final payment', percentage: 50, triggerType: 'final', sortOrder: 1 },
      ];
    case 'time_materials':
    case 'maintenance':
      return [];
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: string | number | null | undefined): string {
  const n = toNum(value);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}
