import { describe, it, expect } from 'vitest';
import {
  EXPENSE_CATEGORIES,
  MAX_EXPENSE_AMOUNT,
  MAX_SHIFT_HOURS,
  TIME_ENTRY_STATUSES,
  computeHours,
  costBreakdown,
  countsTowardCost,
  formatHours,
  guessExpenseCategory,
  isExpenseCategory,
  isTimeEntryStatus,
  jobCostPosition,
  parseAmount,
  labourCost,
  marginIsFinal,
  portfolioCost,
  profitLabel,
  shiftsOverlap,
  validateExpense,
  validateTimeEntry,
  type ExpenseLine,
  type LabourLine,
} from './costing-core';

const now = new Date('2026-08-05T18:00:00Z');

describe('catalogs', () => {
  it('has the documented statuses and expense categories', () => {
    expect(TIME_ENTRY_STATUSES).toEqual(['open', 'submitted', 'approved', 'rejected']);
    expect(EXPENSE_CATEGORIES).toHaveLength(7);
  });
  it('guards input from a form', () => {
    expect(isTimeEntryStatus('approved')).toBe(true);
    expect(isTimeEntryStatus('maybe')).toBe(false);
    expect(isExpenseCategory('material')).toBe(true);
    expect(isExpenseCategory('vibes')).toBe(false);
  });
  it('excludes rejected time from cost — nobody is paying for it', () => {
    expect(countsTowardCost('approved')).toBe(true);
    expect(countsTowardCost('open')).toBe(true);
    expect(countsTowardCost('submitted')).toBe(true);
    expect(countsTowardCost('rejected')).toBe(false);
  });
});

describe('computeHours', () => {
  it('works out a shift less its breaks', () => {
    expect(computeHours('2026-08-05T08:00:00Z', '2026-08-05T16:00:00Z', 30)).toBe(7.5);
    expect(computeHours('2026-08-05T08:00:00Z', '2026-08-05T16:00:00Z', 0)).toBe(8);
    expect(computeHours('2026-08-05T08:00:00Z', '2026-08-05T11:15:00Z')).toBe(3.25);
  });

  it('reports nothing for a shift still running, rather than inventing a total', () => {
    expect(computeHours('2026-08-05T08:00:00Z', null)).toBeNull();
    expect(computeHours('2026-08-05T08:00:00Z', undefined)).toBeNull();
    expect(computeHours(null, '2026-08-05T16:00:00Z')).toBeNull();
  });

  it('refuses a backwards or zero-length shift', () => {
    expect(computeHours('2026-08-05T16:00:00Z', '2026-08-05T08:00:00Z')).toBeNull();
    expect(computeHours('2026-08-05T08:00:00Z', '2026-08-05T08:00:00Z')).toBeNull();
  });

  it('floors at zero when the break swallows the shift', () => {
    expect(computeHours('2026-08-05T08:00:00Z', '2026-08-05T09:00:00Z', 90)).toBe(0);
  });

  it('ignores a negative break rather than paying someone for it', () => {
    expect(computeHours('2026-08-05T08:00:00Z', '2026-08-05T16:00:00Z', -60)).toBe(8);
  });

  it('handles unusable input', () => {
    expect(computeHours('nonsense', '2026-08-05T16:00:00Z')).toBeNull();
  });
});

describe('validateTimeEntry', () => {
  it('accepts a normal shift and an open one', () => {
    expect(
      validateTimeEntry(
        { clockIn: '2026-08-05T08:00:00Z', clockOut: '2026-08-05T16:00:00Z', breakMinutes: 30 },
        now,
      ).error,
    ).toBeUndefined();
    // Still on the clock.
    expect(validateTimeEntry({ clockIn: '2026-08-05T08:00:00Z' }, now).error).toBeUndefined();
  });

  it('requires a start', () => {
    expect(validateTimeEntry({}, now).error).toContain('start time');
    expect(validateTimeEntry({ clockIn: 'nope' }, now).error).toContain('isn’t valid');
  });

  it('refuses clocking in or out ahead of time', () => {
    expect(validateTimeEntry({ clockIn: '2026-08-06T08:00:00Z' }, now).error).toContain(
      'ahead of time',
    );
    expect(
      validateTimeEntry(
        { clockIn: '2026-08-05T08:00:00Z', clockOut: '2026-08-06T08:00:00Z' },
        now,
      ).error,
    ).toContain('ahead of time');
  });

  it('tolerates small clock skew between a phone and the server', () => {
    // Two minutes into the future is a phone clock, not a lie.
    expect(validateTimeEntry({ clockIn: '2026-08-05T18:02:00Z' }, now).error).toBeUndefined();
  });

  it('refuses a backwards shift', () => {
    expect(
      validateTimeEntry(
        { clockIn: '2026-08-05T16:00:00Z', clockOut: '2026-08-05T08:00:00Z' },
        now,
      ).error,
    ).toContain('after the start time');
  });

  it('flags a forgotten clock-out rather than recording a 20-hour day', () => {
    const error = validateTimeEntry(
      { clockIn: '2026-08-04T20:00:00Z', clockOut: '2026-08-05T18:00:00Z' },
      now,
    ).error;
    expect(error).toContain('22 hours');
    expect(MAX_SHIFT_HOURS).toBe(16);
  });

  it('refuses a break longer than the shift, or a negative one', () => {
    expect(
      validateTimeEntry(
        { clockIn: '2026-08-05T08:00:00Z', clockOut: '2026-08-05T09:00:00Z', breakMinutes: 90 },
        now,
      ).error,
    ).toContain('longer than the shift');
    expect(validateTimeEntry({ clockIn: '2026-08-05T08:00:00Z', breakMinutes: -5 }, now).error).toContain(
      'negative',
    );
  });
});

describe('shiftsOverlap', () => {
  const shift = (clockIn: string, clockOut: string | null) => ({ clockIn, clockOut });

  it('spots two shifts sharing time', () => {
    expect(
      shiftsOverlap(
        shift('2026-08-05T08:00:00Z', '2026-08-05T12:00:00Z'),
        shift('2026-08-05T11:00:00Z', '2026-08-05T15:00:00Z'),
      ),
    ).toBe(true);
  });

  it('allows back-to-back shifts', () => {
    expect(
      shiftsOverlap(
        shift('2026-08-05T08:00:00Z', '2026-08-05T12:00:00Z'),
        shift('2026-08-05T12:00:00Z', '2026-08-05T15:00:00Z'),
      ),
    ).toBe(false);
  });

  it('treats an open shift as running to infinity — you can’t start a second', () => {
    expect(
      shiftsOverlap(
        shift('2026-08-05T08:00:00Z', null),
        shift('2026-08-05T14:00:00Z', '2026-08-05T15:00:00Z'),
      ),
    ).toBe(true);
    // Even one starting days later.
    expect(
      shiftsOverlap(shift('2026-08-05T08:00:00Z', null), shift('2026-08-09T08:00:00Z', null)),
    ).toBe(true);
  });

  it('has no opinion without a start time', () => {
    expect(shiftsOverlap(shift('2026-08-05T08:00:00Z', null), { clockIn: null, clockOut: null })).toBe(
      false,
    );
  });
});

describe('labourCost', () => {
  it('multiplies hours by the cost rate', () => {
    expect(labourCost(7.5, 42)).toBe(315);
    expect(labourCost('7.5', '42')).toBe(315);
  });
  it('is zero without hours or a rate, rather than guessing one', () => {
    expect(labourCost(0, 42)).toBe(0);
    expect(labourCost(8, 0)).toBe(0);
    expect(labourCost(8, null)).toBe(0);
    expect(labourCost(null, 42)).toBe(0);
  });
});

describe('validateExpense', () => {
  const good = { description: 'Tile and thinset', amount: 420.5, expenseDate: '2026-08-04' };

  it('accepts a normal expense', () => {
    expect(validateExpense(good, now).error).toBeUndefined();
  });

  it('accepts a negative amount — that is a refund or a return', () => {
    expect(validateExpense({ ...good, amount: -120 }, now).error).toBeUndefined();
  });

  it('requires a description and an amount that means something', () => {
    expect(validateExpense({ ...good, description: '  ' }, now).error).toContain('what this expense');
    expect(validateExpense({ ...good, amount: 0 }, now).error).toContain('zero');
    expect(validateExpense({ ...good, amount: 'lots' }, now).error).toContain('has to be a number');
    expect(validateExpense({ ...good, amount: MAX_EXPENSE_AMOUNT + 1 }, now).error).toContain(
      'looks wrong',
    );
  });

  it('refuses a date that hasn’t happened', () => {
    expect(validateExpense({ ...good, expenseDate: '2026-08-06' }, now).error).toContain(
      'can’t be dated ahead',
    );
    expect(validateExpense({ ...good, expenseDate: '2026-08-05' }, now).error).toBeUndefined();
    expect(validateExpense({ ...good, expenseDate: '2026-02-30' }, now).error).toContain('valid date');
  });
});

describe('parseAmount', () => {
  it('reads what people actually paste', () => {
    expect(parseAmount('$1,250.75')).toBe(1250.75);
    expect(parseAmount(' 420 ')).toBe(420);
    expect(parseAmount(-120)).toBe(-120);
  });
  it('returns null for anything that is not a number, rather than zero', () => {
    expect(parseAmount('lots')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
    expect(parseAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('guessExpenseCategory', () => {
  it('lands the common vendors and words', () => {
    expect(guessExpenseCategory('Home Depot — tile')).toBe('material');
    expect(guessExpenseCategory('Dumpster rental — debris haul away')).toBe('disposal');
    expect(guessExpenseCategory('City building permit')).toBe('permit_fee');
    expect(guessExpenseCategory('Sunbelt scissor lift rental')).toBe('equipment_rental');
    expect(guessExpenseCategory('Diesel for the truck')).toBe('fuel_mileage');
    expect(guessExpenseCategory('Smith Plumbing rough-in')).toBe('subcontractor');
  });
  it('defaults to materials, which is what most receipts are', () => {
    expect(guessExpenseCategory('misc')).toBe('material');
  });
});

describe('costBreakdown', () => {
  const labour: LabourLine[] = [
    { hours: 8, hourlyCostRate: 40, status: 'approved' },
    { hours: 4, hourlyCostRate: 55, status: 'submitted' },
    { hours: 8, hourlyCostRate: 40, status: 'rejected' },
  ];
  const expenses: ExpenseLine[] = [
    { amount: 1000, category: 'material' },
    { amount: 250, category: 'material' },
    { amount: 3000, category: 'subcontractor' },
    { amount: 180, category: 'disposal' },
    { amount: 60, category: 'fuel_mileage' },
  ];

  it('adds up labour and expenses by kind', () => {
    const cost = costBreakdown(labour, expenses);
    expect(cost.labourHours).toBe(12); // the rejected 8 hours are excluded
    expect(cost.labour).toBe(540); // 8×40 + 4×55
    expect(cost.material).toBe(1250);
    expect(cost.subcontractor).toBe(3000);
    expect(cost.otherExpenses).toBe(240);
    expect(cost.total).toBe(5030);
  });

  it('is all zeros for a job with nothing recorded', () => {
    expect(costBreakdown([], [])).toEqual({
      labour: 0,
      labourHours: 0,
      material: 0,
      subcontractor: 0,
      otherExpenses: 0,
      total: 0,
    });
  });

  it('lets a credit reduce the total', () => {
    const cost = costBreakdown([], [
      { amount: 1000, category: 'material' },
      { amount: -150, category: 'material' },
    ]);
    expect(cost.material).toBe(850);
  });
});

describe('jobCostPosition', () => {
  const labour: LabourLine[] = [{ hours: 100, hourlyCostRate: 40, status: 'approved' }];
  const expenses: ExpenseLine[] = [{ amount: 20_000, category: 'material' }];

  it('reports spend and billing against the contract', () => {
    const position = jobCostPosition({
      phase: 'in_progress',
      labour,
      expenses,
      contractValue: 100_000,
      invoiced: 50_000,
    });
    expect(position.cost.total).toBe(24_000);
    expect(position.spentPercent).toBe(24);
    expect(position.billedPercent).toBe(50);
    expect(position.grossProfit).toBe(76_000);
    expect(position.marginPercent).toBe(76);
  });

  it('flags spending running ahead of billing — the useful mid-job signal', () => {
    const behind = jobCostPosition({
      phase: 'in_progress',
      labour,
      expenses: [{ amount: 60_000, category: 'material' }],
      contractValue: 100_000,
      invoiced: 20_000,
    });
    expect(behind.spentPercent).toBe(64);
    expect(behind.billedPercent).toBe(20);
    expect(behind.spendingAheadOfBilling).toBe(true);
  });

  it('does not cry wolf over a small gap', () => {
    const position = jobCostPosition({
      phase: 'in_progress',
      labour: [],
      expenses: [{ amount: 55_000, category: 'material' }],
      contractValue: 100_000,
      invoiced: 50_000,
    });
    expect(position.spendingAheadOfBilling).toBe(false);
  });

  it('says nothing rather than zero for a job with no contract', () => {
    const position = jobCostPosition({
      phase: 'in_progress',
      labour,
      expenses,
      contractValue: null,
      invoiced: 0,
    });
    expect(position.contractValue).toBeNull();
    expect(position.spentPercent).toBeNull();
    expect(position.grossProfit).toBeNull();
    expect(position.marginPercent).toBeNull();
    expect(position.spendingAheadOfBilling).toBe(false);
    // The cost itself is still real and still reported.
    expect(position.cost.total).toBe(24_000);
  });

  it('labels the profit figure honestly for the phase it is in', () => {
    expect(profitLabel('in_progress')).toBe('Value less cost so far');
    expect(profitLabel('complete')).toBe('Gross profit');
    expect(marginIsFinal('in_progress')).toBe(false);
    expect(marginIsFinal('complete')).toBe(true);
  });

  it('can go negative when a job has overrun', () => {
    const position = jobCostPosition({
      phase: 'complete',
      labour: [],
      expenses: [{ amount: 130_000, category: 'material' }],
      contractValue: 100_000,
      invoiced: 100_000,
    });
    expect(position.grossProfit).toBe(-30_000);
    expect(position.marginPercent).toBe(-30);
  });
});

describe('portfolioCost', () => {
  const position = (
    phase: 'in_progress' | 'complete',
    contractValue: number | null,
    materialCost: number,
  ) =>
    jobCostPosition({
      phase,
      labour: [{ hours: 10, hourlyCostRate: 50, status: 'approved' }],
      expenses: [{ amount: materialCost, category: 'material' }],
      contractValue,
      invoiced: 0,
    });

  it('totals costs across every job', () => {
    const totals = portfolioCost([
      position('complete', 100_000, 50_000),
      position('in_progress', 80_000, 10_000),
    ]);
    expect(totals.labourHours).toBe(20);
    expect(totals.labour).toBe(1000);
    expect(totals.expenses).toBe(60_000);
    expect(totals.total).toBe(61_000);
  });

  it('computes margin from finished jobs only', () => {
    // The running job is cheap so far and would flatter a blended margin.
    const totals = portfolioCost([
      position('complete', 100_000, 50_000), // cost 50,500 → 49.5% margin
      position('in_progress', 900_000, 100),
    ]);
    expect(totals.completedRevenue).toBe(100_000);
    expect(totals.completedCost).toBe(50_500);
    expect(totals.completedMarginPercent).toBe(50);
  });

  it('has no margin to report with nothing finished', () => {
    expect(portfolioCost([position('in_progress', 100_000, 10)]).completedMarginPercent).toBeNull();
    expect(portfolioCost([]).completedMarginPercent).toBeNull();
  });

  it('skips a finished job with no contract rather than treating it as zero revenue', () => {
    const totals = portfolioCost([position('complete', null, 5_000)]);
    expect(totals.completedRevenue).toBe(0);
    expect(totals.completedMarginPercent).toBeNull();
    // Its cost still counts toward the company total.
    expect(totals.total).toBe(5_500);
  });
});

describe('formatHours', () => {
  it('writes hours the way a person does', () => {
    expect(formatHours(7.25)).toBe('7.25 h');
    expect(formatHours('8')).toBe('8 h');
    expect(formatHours(0)).toBe('0 h');
    expect(formatHours(null)).toBe('0 h');
  });
});
