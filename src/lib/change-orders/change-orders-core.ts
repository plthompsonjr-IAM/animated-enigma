/**
 * Pure change-order logic (Task 21): the approval lifecycle, numbering, item
 * math, and the revised-contract-sum calculation. No I/O — unit-testable.
 *
 * The central design decision: an approved change order NEVER rewrites the
 * signed contract value. The contract keeps the number the client signed, and
 * the *revised* contract sum is derived — original + approved change orders —
 * exactly how construction accounting works. That is why the Task 20 freeze can
 * stay absolute: change orders are additive records, not edits.
 */

import { toNum } from '@/lib/catalog/catalog-core';

export const CHANGE_ORDER_STATUSES = [
  'draft',
  'internal_review',
  'sent',
  'viewed',
  'approved',
  'declined',
  'incorporated',
  'canceled',
] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: 'Draft',
  internal_review: 'Internal review',
  sent: 'Sent to client',
  viewed: 'Viewed',
  approved: 'Approved',
  declined: 'Declined',
  incorporated: 'Incorporated',
  canceled: 'Canceled',
};

export const CHANGE_ORDER_STATUS_STYLES: Record<ChangeOrderStatus, string> = {
  draft: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  internal_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  sent: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  viewed: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  declined: 'bg-red-500/15 text-red-700 dark:text-red-300',
  incorporated: 'bg-emerald-600/20 text-emerald-800 dark:text-emerald-300',
  canceled: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
};

const TRANSITIONS: Record<ChangeOrderStatus, readonly ChangeOrderStatus[]> = {
  draft: ['internal_review', 'sent', 'canceled'],
  internal_review: ['draft', 'sent', 'canceled'],
  sent: ['viewed', 'approved', 'declined', 'canceled'],
  viewed: ['approved', 'declined', 'canceled'],
  approved: ['incorporated'],
  declined: ['draft', 'canceled'],
  incorporated: [],
  canceled: [],
};

export function allowedTransitions(from: ChangeOrderStatus): readonly ChangeOrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ChangeOrderStatus, to: ChangeOrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Editable while it hasn't gone to the client or been decided. */
export function isEditable(status: ChangeOrderStatus): boolean {
  return status === 'draft' || status === 'internal_review';
}

/** The client has agreed: it now counts toward the revised contract sum. */
export function countsTowardContract(status: ChangeOrderStatus): boolean {
  return status === 'approved' || status === 'incorporated';
}

/** Awaiting the client's decision. */
export function isAwaitingClient(status: ChangeOrderStatus): boolean {
  return status === 'sent' || status === 'viewed';
}

/** Frozen: an incorporated or canceled change order is history. */
export function isFrozen(status: ChangeOrderStatus): boolean {
  return status === 'incorporated' || status === 'canceled';
}

export function formatChangeOrderNumber(year: number, seq: number): string {
  return `CO-${year}-${String(seq).padStart(4, '0')}`;
}

// ── Item math ────────────────────────────────────────────────────────────────

export const ITEM_DIRECTIONS = ['added', 'removed'] as const;
export type ItemDirection = (typeof ITEM_DIRECTIONS)[number];

export const ITEM_DIRECTION_LABELS: Record<ItemDirection, string> = {
  added: 'Added work',
  removed: 'Removed work',
};

export function isItemDirection(value: string): value is ItemDirection {
  return (ITEM_DIRECTIONS as readonly string[]).includes(value);
}

export interface ChangeOrderItemInput {
  direction: ItemDirection;
  description: string;
  amount: string | number | null | undefined;
}

/**
 * The signed contribution of one line: added work increases the cost, removed
 * work decreases it. Amounts are entered as positive numbers regardless of
 * direction — the direction carries the sign, so a typo can't silently flip a
 * credit into a charge.
 */
export function itemDelta(item: ChangeOrderItemInput): number {
  const magnitude = Math.abs(toNum(item.amount));
  return round2(item.direction === 'removed' ? -magnitude : magnitude);
}

/** Net cost change across all lines. May be negative (a credit). */
export function costChange(items: ChangeOrderItemInput[]): number {
  return round2(items.reduce((total, item) => total + itemDelta(item), 0));
}

/** Added and removed subtotals, for a breakdown the client can follow. */
export function costBreakdown(items: ChangeOrderItemInput[]): {
  added: number;
  removed: number;
  net: number;
} {
  let added = 0;
  let removed = 0;
  for (const item of items) {
    const delta = itemDelta(item);
    if (delta >= 0) added += delta;
    else removed += delta;
  }
  return { added: round2(added), removed: round2(removed), net: round2(added + removed) };
}

export interface ChangeOrderValidation {
  ok: boolean;
  error?: string;
}

/** A change order must say what changed and by how much. */
export function validateChangeOrder(
  items: ChangeOrderItemInput[],
  scheduleChangeDays = 0,
): ChangeOrderValidation {
  if (items.length === 0) {
    return { ok: false, error: 'Add at least one added or removed item.' };
  }
  if (items.some((i) => !i.description.trim())) {
    return { ok: false, error: 'Every line needs a description.' };
  }
  const net = costChange(items);
  if (net === 0 && scheduleChangeDays === 0) {
    return {
      ok: false,
      error: 'This change order has no effect — set a cost change or a schedule change.',
    };
  }
  return { ok: true };
}

// ── Contract impact ──────────────────────────────────────────────────────────

export interface ApprovedChange {
  status: ChangeOrderStatus;
  costChange: string | number | null | undefined;
  scheduleChangeDays?: number | null;
}

/**
 * Revised contract sum = the signed original plus every approved/incorporated
 * change order. The original is never mutated, so this is always reconstructible
 * from the record — which is the point.
 */
export function revisedContractValue(originalValue: number, changes: ApprovedChange[]): number {
  const approved = changes.filter((c) => countsTowardContract(c.status));
  return round2(approved.reduce((total, c) => total + toNum(c.costChange), originalValue));
}

/** Total schedule slip from approved change orders, in days. */
export function totalScheduleChange(changes: ApprovedChange[]): number {
  return changes
    .filter((c) => countsTowardContract(c.status))
    .reduce((total, c) => total + (c.scheduleChangeDays ?? 0), 0);
}

/** Approved change orders not yet folded into the contract record. */
export function pendingIncorporation(changes: { status: ChangeOrderStatus }[]): number {
  return changes.filter((c) => c.status === 'approved').length;
}

export function formatScheduleChange(days: number): string {
  if (days === 0) return 'No schedule change';
  const magnitude = Math.abs(days);
  const unit = magnitude === 1 ? 'day' : 'days';
  return days > 0 ? `+${days} ${unit}` : `${days} ${unit}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
