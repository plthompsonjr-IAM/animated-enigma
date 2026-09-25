import { describe, it, expect } from 'vitest';
import {
  agingReport,
  balancesByClient,
  collectionSummary,
  daysLate,
  formatPercent,
  jobBillingRows,
  openReceivables,
  portfolioTotals,
  type AgingInvoice,
  type JobBillingInput,
} from './financials-core';

const now = new Date('2026-08-05T12:00:00Z');

const invoice = (over: Partial<AgingInvoice> & { id: string }): AgingInvoice => ({
  invoiceNumber: `INV-${over.id}`,
  status: 'sent',
  total: 1000,
  amountPaid: 0,
  dueDate: '2026-08-20',
  clientId: 'c1',
  clientName: 'Jane Dorsey',
  projectId: 'p1',
  projectName: 'Hall bath',
  ...over,
});

describe('openReceivables', () => {
  it('keeps only invoices with money still owed', () => {
    const rows = openReceivables(
      [
        invoice({ id: 'a' }),
        invoice({ id: 'b', total: 1000, amountPaid: 1000 }),
        invoice({ id: 'c', total: 1000, amountPaid: 400 }),
      ],
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(rows.find((r) => r.id === 'c')!.balance).toBe(600);
  });

  it('excludes drafts and voids — neither is money owed', () => {
    expect(
      openReceivables(
        [invoice({ id: 'a', status: 'draft' }), invoice({ id: 'b', status: 'void' })],
        now,
      ),
    ).toEqual([]);
  });

  it('never reports a negative balance from an overpayment', () => {
    const [row] = openReceivables([invoice({ id: 'a', total: 100, amountPaid: 150 })], now);
    expect(row).toBeUndefined();
  });

  it('ages each invoice and puts the oldest debt first', () => {
    const rows = openReceivables(
      [
        invoice({ id: 'recent', dueDate: '2026-08-01' }),
        invoice({ id: 'ancient', dueDate: '2026-01-10' }),
        invoice({ id: 'current', dueDate: '2026-09-01' }),
      ],
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(['ancient', 'recent', 'current']);
    expect(rows[0]!.bucket).toBe('90_plus');
    expect(rows[1]!.bucket).toBe('1_30');
    expect(rows[2]!.bucket).toBe('current');
  });

  it('breaks a tie on amount, so the bigger debt is chased first', () => {
    const rows = openReceivables(
      [
        invoice({ id: 'small', dueDate: '2026-08-01', total: 200 }),
        invoice({ id: 'big', dueDate: '2026-08-01', total: 9000 }),
      ],
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(['big', 'small']);
  });

  it('treats an undated invoice as current rather than guessing', () => {
    const [row] = openReceivables([invoice({ id: 'a', dueDate: null })], now);
    expect(row!.bucket).toBe('current');
    expect(row!.daysLate).toBe(0);
  });
});

describe('daysLate', () => {
  it('is forgiving through the end of the due day', () => {
    expect(daysLate('2026-08-05', now)).toBe(0);
    expect(daysLate('2026-08-04', now)).toBe(1);
    expect(daysLate('2026-08-01', now)).toBe(4);
  });
  it('is zero for anything not yet due, or undated, or unusable', () => {
    expect(daysLate('2026-09-01', now)).toBe(0);
    expect(daysLate(null, now)).toBe(0);
    expect(daysLate(undefined, now)).toBe(0);
    expect(daysLate('not-a-date', now)).toBe(0);
  });
});

describe('agingReport', () => {
  it('always reports every bucket, so a zero reads as a zero', () => {
    const report = agingReport([]);
    expect(report.map((r) => r.bucket)).toEqual(['current', '1_30', '31_60', '61_90', '90_plus']);
    expect(report.every((r) => r.amount === 0 && r.count === 0 && r.percent === 0)).toBe(true);
  });

  it('sums and apportions across buckets', () => {
    const receivables = openReceivables(
      [
        invoice({ id: 'a', dueDate: '2026-09-01', total: 1000 }), // current
        invoice({ id: 'b', dueDate: '2026-07-20', total: 2000 }), // 1–30
        invoice({ id: 'c', dueDate: '2026-07-15', total: 1000 }), // 1–30
        invoice({ id: 'd', dueDate: '2026-01-01', total: 4000 }), // 90+
      ],
      now,
    );
    const report = agingReport(receivables);
    const by = (b: string) => report.find((r) => r.bucket === b)!;
    expect(by('current').amount).toBe(1000);
    expect(by('1_30').amount).toBe(3000);
    expect(by('1_30').count).toBe(2);
    expect(by('90_plus').amount).toBe(4000);
    // Percentages are of the $8,000 total.
    expect(by('90_plus').percent).toBe(50);
  });

  it('apportions percentages so the column sums to exactly 100', () => {
    // 1000/3000/4000 of 8000 rounds independently to 13 + 38 + 50 = 101.
    const receivables = openReceivables(
      [
        invoice({ id: 'a', dueDate: '2026-09-01', total: 1000 }),
        invoice({ id: 'b', dueDate: '2026-07-20', total: 3000 }),
        invoice({ id: 'd', dueDate: '2026-01-01', total: 4000 }),
      ],
      now,
    );
    const report = agingReport(receivables);
    expect(report.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
  });

  it('still sums to 100 for an awkward three-way split', () => {
    // Thirds: 33.33 each, which naively rounds to 99.
    const receivables = openReceivables(
      [
        invoice({ id: 'a', dueDate: '2026-09-01', total: 100 }),
        invoice({ id: 'b', dueDate: '2026-07-20', total: 100 }),
        invoice({ id: 'c', dueDate: '2026-06-01', total: 100 }),
      ],
      now,
    );
    const report = agingReport(receivables);
    expect(report.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
    // The spare point goes somewhere, not nowhere.
    expect(report.filter((r) => r.percent > 0).map((r) => r.percent).sort()).toEqual([33, 33, 34]);
  });

  it('leaves every percentage at zero when nothing is owed', () => {
    expect(agingReport([]).every((r) => r.percent === 0)).toBe(true);
  });
});

describe('balancesByClient', () => {
  it('groups by client and totals what each owes', () => {
    const receivables = openReceivables(
      [
        invoice({ id: 'a', clientId: 'c1', clientName: 'Jane', dueDate: '2026-07-01', total: 5000 }),
        invoice({ id: 'b', clientId: 'c1', clientName: 'Jane', dueDate: '2026-09-01', total: 1000 }),
        invoice({ id: 'c', clientId: 'c2', clientName: 'Bob', dueDate: '2026-09-01', total: 9000 }),
      ],
      now,
    );
    const balances = balancesByClient(receivables);
    const jane = balances.find((b) => b.clientId === 'c1')!;
    expect(jane.balance).toBe(6000);
    // Only the late invoice counts as overdue.
    expect(jane.overdue).toBe(5000);
    expect(jane.invoiceCount).toBe(2);
    expect(jane.oldestDaysLate).toBe(35);
  });

  it('puts whoever is most overdue first, not whoever owes most', () => {
    const receivables = openReceivables(
      [
        invoice({ id: 'a', clientId: 'c1', clientName: 'Jane', dueDate: '2026-07-01', total: 5000 }),
        invoice({ id: 'b', clientId: 'c2', clientName: 'Bob', dueDate: '2026-09-01', total: 90_000 }),
      ],
      now,
    );
    expect(balancesByClient(receivables).map((b) => b.clientName)).toEqual(['Jane', 'Bob']);
  });

  it('copes with an invoice that has no client attached', () => {
    const receivables = openReceivables([invoice({ id: 'a', clientId: null, clientName: null })], now);
    const [entry] = balancesByClient(receivables);
    expect(entry!.clientId).toBeNull();
    expect(entry!.balance).toBe(1000);
  });

  it('has nothing to say when nothing is owed', () => {
    expect(balancesByClient([])).toEqual([]);
  });
});

describe('collectionSummary', () => {
  it('measures what was billed against what came in', () => {
    const summary = collectionSummary(
      [
        invoice({ id: 'a', total: 10_000, amountPaid: 10_000, dueDate: '2026-07-01' }),
        invoice({ id: 'b', total: 10_000, amountPaid: 2_000, dueDate: '2026-09-01' }),
      ],
      now,
    );
    expect(summary.billed).toBe(20_000);
    expect(summary.collected).toBe(12_000);
    expect(summary.outstanding).toBe(8_000);
    expect(summary.collectionRate).toBe(60);
    // Nothing outstanding is actually late.
    expect(summary.overdue).toBe(0);
    expect(summary.averageDaysLate).toBe(0);
  });

  it('ignores drafts and voids on both sides of the ratio', () => {
    const summary = collectionSummary(
      [
        invoice({ id: 'a', total: 1000, amountPaid: 1000 }),
        invoice({ id: 'draft', status: 'draft', total: 50_000 }),
        invoice({ id: 'void', status: 'void', total: 50_000 }),
      ],
      now,
    );
    expect(summary.billed).toBe(1000);
    expect(summary.collectionRate).toBe(100);
  });

  it('weights average lateness by amount, not by invoice count', () => {
    // $20,000 thirty days late and $200 ninety days late: the answer should sit
    // near thirty, because that is where the money is.
    const summary = collectionSummary(
      [
        invoice({ id: 'big', total: 20_000, dueDate: '2026-07-06' }),
        invoice({ id: 'small', total: 200, dueDate: '2026-05-07' }),
      ],
      now,
    );
    expect(summary.averageDaysLate).toBeGreaterThan(28);
    expect(summary.averageDaysLate).toBeLessThan(34);
  });

  it('has no opinion on a rate with nothing billed', () => {
    expect(collectionSummary([], now).collectionRate).toBeNull();
    expect(collectionSummary([invoice({ id: 'd', status: 'draft' })], now).collectionRate).toBeNull();
  });
});

describe('jobBillingRows', () => {
  const job = (over: Partial<JobBillingInput> & { projectId: string }): JobBillingInput => ({
    projectName: over.projectId,
    projectNumber: 'PRJ-1',
    clientName: 'Jane',
    status: 'in_progress',
    contractValue: 100_000,
    changeOrderDelta: 0,
    invoiced: 0,
    paid: 0,
    ...over,
  });

  it('derives the revised value, what is outstanding, and what is left to bill', () => {
    const [row] = jobBillingRows([
      job({ projectId: 'a', contractValue: 100_000, changeOrderDelta: 12_000, invoiced: 56_000, paid: 40_000 }),
    ]);
    expect(row!.revisedValue).toBe(112_000);
    expect(row!.outstanding).toBe(16_000);
    expect(row!.unbilled).toBe(56_000);
    expect(row!.billedPercent).toBe(50);
  });

  it('handles a credit change order that reduces the contract', () => {
    const [row] = jobBillingRows([
      job({ projectId: 'a', contractValue: 100_000, changeOrderDelta: -10_000 }),
    ]);
    expect(row!.revisedValue).toBe(90_000);
  });

  it('never reports negative unbilled work when a job is over-billed', () => {
    const [row] = jobBillingRows([job({ projectId: 'a', contractValue: 10_000, invoiced: 12_000 })]);
    expect(row!.unbilled).toBe(0);
    expect(row!.billedPercent).toBe(120);
  });

  it('says nothing rather than zero for a job with no contract', () => {
    const [row] = jobBillingRows([job({ projectId: 'a', contractValue: null, invoiced: 5_000 })]);
    expect(row!.revisedValue).toBeNull();
    expect(row!.unbilled).toBeNull();
    expect(row!.billedPercent).toBeNull();
    expect(row!.outstanding).toBe(5_000);
  });

  it('puts the most money still owed first', () => {
    const rows = jobBillingRows([
      job({ projectId: 'small', invoiced: 1_000, paid: 900 }),
      job({ projectId: 'big', invoiced: 50_000, paid: 10_000 }),
    ]);
    expect(rows.map((r) => r.projectId)).toEqual(['big', 'small']);
  });
});

describe('portfolioTotals', () => {
  it('adds up the book of work and counts jobs with no contract', () => {
    const rows = jobBillingRows([
      {
        projectId: 'a',
        projectName: 'A',
        projectNumber: null,
        clientName: null,
        status: 'in_progress',
        contractValue: 100_000,
        changeOrderDelta: 10_000,
        invoiced: 60_000,
        paid: 45_000,
      },
      {
        projectId: 'b',
        projectName: 'B',
        projectNumber: null,
        clientName: null,
        status: 'planning',
        contractValue: null,
        changeOrderDelta: 0,
        invoiced: 0,
        paid: 0,
      },
    ]);
    const totals = portfolioTotals(rows);
    expect(totals.underContract).toBe(110_000);
    expect(totals.invoiced).toBe(60_000);
    expect(totals.collected).toBe(45_000);
    expect(totals.outstanding).toBe(15_000);
    expect(totals.unbilled).toBe(50_000);
    expect(totals.jobsWithoutContract).toBe(1);
  });

  it('is all zeros with no jobs', () => {
    expect(portfolioTotals([])).toEqual({
      underContract: 0,
      invoiced: 0,
      collected: 0,
      outstanding: 0,
      unbilled: 0,
      jobsWithoutContract: 0,
    });
  });
});

describe('formatPercent', () => {
  it('renders a dash rather than a misleading zero', () => {
    expect(formatPercent(42)).toBe('42%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('—');
  });
});
