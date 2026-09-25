/**
 * Pure invoicing and payment logic (Task 22). No I/O — unit-testable and shared
 * by forms, actions, queries, and UI.
 *
 * Two design rules drive everything here:
 *
 * 1. **Money is derived, never trusted.** Line amounts come from quantity ×
 *    unit price, invoice totals come from the lines, and `amount_paid` comes
 *    from payment allocations. Stored totals are a cache of these functions, so
 *    a stale or tampered column can always be recomputed and compared.
 * 2. **Provider-independent.** A payment is a local record with a method and an
 *    optional external reference. Stripe (or anything else) supplies an
 *    `externalId` for idempotency; nothing about the model assumes a processor.
 */

import { toNum } from '@/lib/catalog/catalog-core';

// ── Status & type catalogs ───────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
  'void',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};

export const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  sent: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  viewed: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  partially_paid: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  paid: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-300',
  void: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
};

export const INVOICE_TYPES = [
  'deposit',
  'milestone',
  'progress',
  'change_order',
  'time_materials',
  'final',
  'maintenance',
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  deposit: 'Deposit',
  milestone: 'Milestone',
  progress: 'Progress billing',
  change_order: 'Change order',
  time_materials: 'Time & materials',
  final: 'Final invoice',
  maintenance: 'Maintenance',
};

export function isInvoiceType(value: string): value is InvoiceType {
  return (INVOICE_TYPES as readonly string[]).includes(value);
}

export const PAYMENT_METHODS = ['card', 'ach', 'check', 'cash', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Card',
  ach: 'Bank transfer (ACH)',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** A draft invoice is editable; anything issued is a financial record. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === 'draft';
}

/** Issued and not void — it can receive payments. */
export function isCollectable(status: InvoiceStatus): boolean {
  return status !== 'draft' && status !== 'void' && status !== 'paid';
}

export function isVoid(status: InvoiceStatus): boolean {
  return status === 'void';
}

export function formatInvoiceNumber(year: number, seq: number): string {
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

// ── Line items and totals ────────────────────────────────────────────────────

export interface InvoiceLineInput {
  description: string;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  taxable?: boolean;
}

/** Quantity × unit price, rounded to cents. Missing quantity means one. */
export function lineAmount(line: InvoiceLineInput): number {
  const quantity =
    line.quantity === null || line.quantity === undefined || line.quantity === ''
      ? 1
      : toNum(line.quantity);
  return round2(quantity * toNum(line.unitPrice));
}

export interface InvoiceTotals {
  subtotal: number;
  taxableSubtotal: number;
  taxAmount: number;
  credits: number;
  total: number;
}

/**
 * Roll lines up into invoice totals. Tax applies only to taxable lines — labor
 * is commonly exempt while materials are not, so the flag lives per line.
 * `taxRatePercent` is a percentage (6.75 means 6.75%).
 */
export function invoiceTotals(
  lines: InvoiceLineInput[],
  taxRatePercent: string | number | null | undefined = 0,
  credits: string | number | null | undefined = 0,
): InvoiceTotals {
  let subtotal = 0;
  let taxableSubtotal = 0;
  for (const line of lines) {
    const amount = lineAmount(line);
    subtotal += amount;
    if (line.taxable !== false) taxableSubtotal += amount;
  }
  subtotal = round2(subtotal);
  taxableSubtotal = round2(taxableSubtotal);

  const taxAmount = round2((toNum(taxRatePercent) / 100) * taxableSubtotal);
  const creditAmount = round2(Math.abs(toNum(credits)));
  const total = round2(subtotal + taxAmount - creditAmount);

  return { subtotal, taxableSubtotal, taxAmount, credits: creditAmount, total };
}

/** What's still owed. Never negative — an overpayment shows as zero balance. */
export function balanceOf(
  total: string | number | null | undefined,
  amountPaid: string | number | null | undefined,
): number {
  return round2(Math.max(0, toNum(total) - toNum(amountPaid)));
}

/** Amount paid beyond the total, if any — surfaced so it isn't silently lost. */
export function overpayment(
  total: string | number | null | undefined,
  amountPaid: string | number | null | undefined,
): number {
  return round2(Math.max(0, toNum(amountPaid) - toNum(total)));
}

export interface InvoiceValidation {
  ok: boolean;
  error?: string;
}

/** An invoice must have priced lines and a non-negative total. */
export function validateInvoice(
  lines: InvoiceLineInput[],
  totals: InvoiceTotals,
): InvoiceValidation {
  if (lines.length === 0) return { ok: false, error: 'Add at least one line item.' };
  if (lines.some((l) => !l.description.trim())) {
    return { ok: false, error: 'Every line needs a description.' };
  }
  if (lines.some((l) => lineAmount(l) < 0)) {
    return { ok: false, error: 'Line amounts cannot be negative — use a credit instead.' };
  }
  if (totals.total < 0) {
    return { ok: false, error: 'Credits cannot exceed the invoice subtotal and tax.' };
  }
  if (totals.total === 0) {
    return { ok: false, error: 'This invoice totals zero — nothing to bill.' };
  }
  return { ok: true };
}

// ── Status derivation ────────────────────────────────────────────────────────

/**
 * The status a viewer should see, given the stored status and the money.
 * Payment state and lateness are facts about the record, so they are derived
 * rather than depending on a background job having run.
 *
 * `void` and `draft` are respected as-is: a void invoice is never "overdue",
 * and a draft has not been issued so it cannot be late.
 */
export function displayInvoiceStatus(
  stored: InvoiceStatus,
  args: {
    total: string | number | null | undefined;
    amountPaid: string | number | null | undefined;
    dueDate?: string | Date | null;
    now?: Date;
  },
): InvoiceStatus {
  if (stored === 'void' || stored === 'draft') return stored;

  const total = toNum(args.total);
  const paid = toNum(args.amountPaid);

  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0) {
    return isPastDue(args.dueDate, args.now) ? 'overdue' : 'partially_paid';
  }
  if (isPastDue(args.dueDate, args.now)) return 'overdue';
  return stored;
}

/**
 * Reads a value as a local calendar day. A bare `YYYY-MM-DD` has to be parsed as
 * local midnight: `new Date('2026-08-24')` is *UTC* midnight, which is still the
 * 23rd anywhere west of Greenwich — enough to call an invoice overdue a day early
 * and to print the wrong due date on the client's copy. Returns null if unusable.
 */
export function calendarDay(value?: string | Date | null): Date | null {
  if (!value) return null;
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A calendar date for display, or `fallback` when there isn't one. */
export function formatCalendarDate(value?: string | Date | null, fallback = '—'): string {
  return calendarDay(value)?.toLocaleDateString('en-US') ?? fallback;
}

/** Past its due date (end of the due day is still on time). */
export function isPastDue(dueDate?: string | Date | null, now: Date = new Date()): boolean {
  const due = calendarDay(dueDate);
  if (!due) return false;
  // Due dates are calendar days: anything before the end of that day is on time.
  due.setHours(23, 59, 59, 999);
  return now.getTime() > due.getTime();
}

export const AGING_BUCKETS = ['current', '1_30', '31_60', '61_90', '90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Current',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  '90_plus': '90+ days',
};

/** Receivables aging bucket for an unpaid invoice. */
export function agingBucket(dueDate?: string | Date | null, now: Date = new Date()): AgingBucket {
  const due = calendarDay(dueDate);
  if (!due || !isPastDue(dueDate, now)) return 'current';
  due.setHours(23, 59, 59, 999);
  const days = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return '90_plus';
}

// ── Payments & allocation ────────────────────────────────────────────────────

export interface AllocationInput {
  invoiceId: string;
  amount: string | number | null | undefined;
}

/** Sum of a payment's allocations. */
export function allocatedTotal(allocations: AllocationInput[]): number {
  return round2(allocations.reduce((total, a) => total + toNum(a.amount), 0));
}

/** Payment amount not yet applied to any invoice. */
export function unappliedAmount(
  paymentAmount: string | number | null | undefined,
  allocations: AllocationInput[],
): number {
  return round2(toNum(paymentAmount) - allocatedTotal(allocations));
}

/**
 * A payment may not be spread further than it goes, and may not overpay an
 * invoice it is applied to. `invoiceBalances` maps invoice id → current balance.
 */
export function validateAllocations(
  paymentAmount: string | number | null | undefined,
  allocations: AllocationInput[],
  invoiceBalances: Record<string, number> = {},
): InvoiceValidation {
  const amount = toNum(paymentAmount);
  if (amount <= 0) return { ok: false, error: 'Enter a payment amount greater than zero.' };
  if (allocations.length === 0) {
    return { ok: false, error: 'Apply the payment to at least one invoice.' };
  }
  if (allocations.some((a) => toNum(a.amount) <= 0)) {
    return { ok: false, error: 'Each applied amount must be greater than zero.' };
  }

  const allocated = allocatedTotal(allocations);
  if (allocated - amount > 0.01) {
    return {
      ok: false,
      error: `Applied ${formatMoney(allocated)} exceeds the payment of ${formatMoney(amount)}.`,
    };
  }

  for (const allocation of allocations) {
    const balance = invoiceBalances[allocation.invoiceId];
    if (balance !== undefined && toNum(allocation.amount) - balance > 0.01) {
      return {
        ok: false,
        error: `Applied ${formatMoney(allocation.amount)} exceeds that invoice's balance of ${formatMoney(balance)}.`,
      };
    }
  }

  return { ok: true };
}

/** Net cash received: payments less refunds. */
export function netPayments(
  payments: { amount: string | number | null | undefined; isRefund?: boolean | null }[],
): number {
  return round2(
    payments.reduce(
      (total, p) => total + (p.isRefund ? -Math.abs(toNum(p.amount)) : toNum(p.amount)),
      0,
    ),
  );
}

// ── Project-level rollup ─────────────────────────────────────────────────────

export interface ReceivablesSummary {
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
}

/**
 * What a project (or the whole book) is owed. Void invoices are excluded
 * entirely — they were cancelled, not forgiven.
 */
export function summarizeReceivables(
  invoices: {
    status: InvoiceStatus;
    total: string | number | null | undefined;
    amountPaid: string | number | null | undefined;
    dueDate?: string | Date | null;
  }[],
  now: Date = new Date(),
): ReceivablesSummary {
  let invoiced = 0;
  let paid = 0;
  let outstanding = 0;
  let overdue = 0;

  for (const invoice of invoices) {
    if (invoice.status === 'void' || invoice.status === 'draft') continue;
    const total = toNum(invoice.total);
    const amountPaid = toNum(invoice.amountPaid);
    const balance = balanceOf(total, amountPaid);
    invoiced += total;
    paid += amountPaid;
    outstanding += balance;
    if (balance > 0 && isPastDue(invoice.dueDate, now)) overdue += balance;
  }

  return {
    invoiced: round2(invoiced),
    paid: round2(paid),
    outstanding: round2(outstanding),
    overdue: round2(overdue),
  };
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
