/**
 * Pure financial-reporting logic (Task 28): receivables aging, collection
 * performance, and per-job billing position.
 *
 * Deliberately *not* here: job profitability. Profit needs actual costs — labour
 * hours and material spend — and neither is tracked yet. Reporting a margin from
 * the estimate alone would be reporting a guess as a fact, so this module
 * reports what the ledger actually knows and says plainly what it doesn't.
 *
 * No I/O, so all of it is unit-testable.
 */

import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  agingBucket,
  balanceOf,
  isPastDue,
  type AgingBucket,
  type InvoiceStatus,
} from '@/lib/invoices/invoices-core';
import { toNum } from '@/lib/catalog/catalog-core';

export interface AgingInvoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  total: string | number | null | undefined;
  amountPaid: string | number | null | undefined;
  dueDate?: string | null;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
}

/** An invoice still owed money, with its age worked out. */
export interface OpenReceivable extends AgingInvoice {
  balance: number;
  bucket: AgingBucket;
  daysLate: number;
}

/**
 * Invoices with a balance outstanding. Drafts and voids are excluded — a draft
 * hasn't been billed and a void was withdrawn, so neither is money owed.
 */
export function openReceivables(
  invoices: AgingInvoice[],
  now: Date = new Date(),
): OpenReceivable[] {
  const rows: OpenReceivable[] = [];
  for (const invoice of invoices) {
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    const balance = balanceOf(toNum(invoice.total), toNum(invoice.amountPaid));
    if (balance <= 0) continue;
    rows.push({
      ...invoice,
      balance,
      bucket: agingBucket(invoice.dueDate, now),
      daysLate: daysLate(invoice.dueDate, now),
    });
  }
  // Oldest debt first: that's the order you chase in.
  return rows.sort((a, b) => b.daysLate - a.daysLate || b.balance - a.balance);
}

/** How many days past due, or 0 if it isn't. */
export function daysLate(dueDate: string | Date | null | undefined, now: Date = new Date()): number {
  if (!dueDate || !isPastDue(dueDate, now)) return 0;
  const due = new Date(typeof dueDate === 'string' ? `${dueDate}T00:00:00` : dueDate);
  if (Number.isNaN(due.getTime())) return 0;
  due.setHours(23, 59, 59, 999);
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86_400_000) + 1);
}

export interface AgingRow {
  bucket: AgingBucket;
  label: string;
  amount: number;
  count: number;
  /** Share of total outstanding, 0–100. */
  percent: number;
}

/**
 * The classic A/R aging report: what's owed, grouped by how late it is. Every
 * bucket is present even when empty, so the shape of the report doesn't change
 * from week to week and a zero reads as a zero rather than a gap.
 */
export function agingReport(receivables: OpenReceivable[]): AgingRow[] {
  const totals = new Map<AgingBucket, { amount: number; count: number }>();
  for (const bucket of AGING_BUCKETS) totals.set(bucket, { amount: 0, count: 0 });

  let grand = 0;
  for (const row of receivables) {
    const entry = totals.get(row.bucket)!;
    entry.amount = round2(entry.amount + row.balance);
    entry.count++;
    grand = round2(grand + row.balance);
  }

  const rows = AGING_BUCKETS.map((bucket) => {
    const entry = totals.get(bucket)!;
    return {
      bucket,
      label: AGING_BUCKET_LABELS[bucket],
      amount: entry.amount,
      count: entry.count,
      percent: 0,
    };
  });

  return apportion(rows, grand);
}

/**
 * Assigns whole-number percentages that sum to exactly 100.
 *
 * Rounding each share independently doesn't add up — $1,000 / $3,000 / $4,000 of
 * an $8,000 total rounds to 13 + 38 + 50 = 101. On an aging report that reads as
 * an error, so the remainders are distributed largest-first (the standard
 * largest-remainder method) and the column totals what it should.
 */
function apportion(rows: AgingRow[], grand: number): AgingRow[] {
  if (grand <= 0) return rows;

  const exact = rows.map((row) => (row.amount / grand) * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((sum, n) => sum + n, 0);

  // Buckets with the largest fractional part get the spare points first.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const percents = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    percents[index]! += 1;
    remaining--;
  }

  return rows.map((row, i) => ({ ...row, percent: percents[i]! }));
}

export interface ClientBalance {
  clientId: string | null;
  clientName: string | null;
  balance: number;
  overdue: number;
  invoiceCount: number;
  /** Days late on the oldest unpaid invoice. */
  oldestDaysLate: number;
}

/**
 * Who owes what, worst first. Grouped by client rather than by invoice because
 * chasing money is a conversation with a person, not with a document.
 */
export function balancesByClient(receivables: OpenReceivable[]): ClientBalance[] {
  const byClient = new Map<string, ClientBalance>();

  for (const row of receivables) {
    const key = row.clientId ?? '';
    const entry = byClient.get(key);
    if (entry) {
      entry.balance = round2(entry.balance + row.balance);
      if (row.daysLate > 0) entry.overdue = round2(entry.overdue + row.balance);
      entry.invoiceCount++;
      entry.oldestDaysLate = Math.max(entry.oldestDaysLate, row.daysLate);
    } else {
      byClient.set(key, {
        clientId: row.clientId,
        clientName: row.clientName,
        balance: row.balance,
        overdue: row.daysLate > 0 ? row.balance : 0,
        invoiceCount: 1,
        oldestDaysLate: row.daysLate,
      });
    }
  }

  return [...byClient.values()].sort(
    (a, b) => b.overdue - a.overdue || b.balance - a.balance || b.oldestDaysLate - a.oldestDaysLate,
  );
}

// ── Collection performance ───────────────────────────────────────────────────

export interface CollectionSummary {
  /** Everything billed, excluding drafts and voids. */
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
  /** Collected as a share of billed, 0–100. Null when nothing has been billed. */
  collectionRate: number | null;
  /**
   * Weighted average days an outstanding invoice is late. Zero when everything
   * owed is still within terms.
   */
  averageDaysLate: number;
}

export function collectionSummary(
  invoices: AgingInvoice[],
  now: Date = new Date(),
): CollectionSummary {
  let billed = 0;
  let collected = 0;

  for (const invoice of invoices) {
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    billed = round2(billed + toNum(invoice.total));
    collected = round2(collected + toNum(invoice.amountPaid));
  }

  const open = openReceivables(invoices, now);
  const outstanding = round2(open.reduce((sum, r) => sum + r.balance, 0));
  const late = open.filter((r) => r.daysLate > 0);
  const overdue = round2(late.reduce((sum, r) => sum + r.balance, 0));

  // Weighted by amount: a $20,000 invoice thirty days late matters more than a
  // $200 one ninety days late, and a plain average would say the opposite.
  const weighted = late.reduce((sum, r) => sum + r.balance * r.daysLate, 0);

  return {
    billed,
    collected,
    outstanding,
    overdue,
    collectionRate: billed > 0 ? Math.round((collected / billed) * 100) : null,
    averageDaysLate: overdue > 0 ? Math.round(weighted / overdue) : 0,
  };
}

// ── Per-job billing position ─────────────────────────────────────────────────

export interface JobBillingInput {
  projectId: string;
  projectName: string | null;
  projectNumber: string | null;
  clientName: string | null;
  status: string;
  /** Original contract value; null when the job has no contract yet. */
  contractValue: number | null;
  changeOrderDelta: number;
  invoiced: number;
  paid: number;
}

export interface JobBillingRow extends JobBillingInput {
  revisedValue: number | null;
  outstanding: number;
  /** Revised value not yet invoiced — the work left to bill. */
  unbilled: number | null;
  /** Invoiced as a share of the revised value, 0–100. Null without a contract. */
  billedPercent: number | null;
}

/**
 * Billing position per job: what's under contract, what's been billed, what's
 * been collected, and what's left to bill.
 *
 * This is *not* profitability. Without actual labour and material costs there is
 * no honest margin to report, and a number derived from the estimate would be a
 * projection dressed up as a result.
 */
export function jobBillingRows(jobs: JobBillingInput[]): JobBillingRow[] {
  return jobs
    .map((job) => {
      const revisedValue =
        job.contractValue === null ? null : round2(job.contractValue + job.changeOrderDelta);
      const unbilled = revisedValue === null ? null : round2(Math.max(0, revisedValue - job.invoiced));
      return {
        ...job,
        revisedValue,
        outstanding: round2(Math.max(0, job.invoiced - job.paid)),
        unbilled,
        billedPercent:
          revisedValue !== null && revisedValue > 0
            ? Math.round((job.invoiced / revisedValue) * 100)
            : null,
      };
    })
    // Most money still owed first.
    .sort((a, b) => b.outstanding - a.outstanding || b.invoiced - a.invoiced);
}

export interface PortfolioTotals {
  underContract: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  unbilled: number;
  jobsWithoutContract: number;
}

/** The book of work, added up. */
export function portfolioTotals(rows: JobBillingRow[]): PortfolioTotals {
  let underContract = 0;
  let invoiced = 0;
  let collected = 0;
  let outstanding = 0;
  let unbilled = 0;
  let jobsWithoutContract = 0;

  for (const row of rows) {
    if (row.revisedValue === null) jobsWithoutContract++;
    else underContract = round2(underContract + row.revisedValue);
    invoiced = round2(invoiced + row.invoiced);
    collected = round2(collected + row.paid);
    outstanding = round2(outstanding + row.outstanding);
    unbilled = round2(unbilled + (row.unbilled ?? 0));
  }

  return { underContract, invoiced, collected, outstanding, unbilled, jobsWithoutContract };
}

/** "42% billed" style label, or a plain dash when there's nothing to compare. */
export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
