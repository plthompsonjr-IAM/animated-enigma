import { describe, it, expect } from 'vitest';
import {
  computeLineCost,
  computeEstimate,
  formatMoney,
  formatMarginPct,
  isLineType,
  nextSortOrder,
  LINE_TYPES,
  type EstimateLineInput,
} from './estimate-core';

describe('line types', () => {
  it('has six types and guards them', () => {
    expect(LINE_TYPES).toHaveLength(6);
    expect(isLineType('labor')).toBe(true);
    expect(isLineType('nonsense')).toBe(false);
  });
});

describe('computeLineCost', () => {
  it('is quantity × unit cost × (1 + waste)', () => {
    expect(
      computeLineCost({
        lineType: 'material',
        quantity: '10',
        unitCost: '5',
        wasteFactorPct: '0.1',
      }),
    ).toBe(55); // 10 * 5 * 1.1
  });
  it('treats missing waste as zero', () => {
    expect(
      computeLineCost({ lineType: 'labor', quantity: '3', unitCost: '40', wasteFactorPct: null }),
    ).toBe(120);
  });
  it('rounds to cents', () => {
    expect(
      computeLineCost({
        lineType: 'material',
        quantity: '2',
        unitCost: '1.257',
        wasteFactorPct: '0',
      }),
    ).toBe(2.51); // 2.514 → 2.51
  });
});

describe('computeEstimate', () => {
  const lines: EstimateLineInput[] = [
    { lineType: 'material', quantity: '100', unitCost: '2', wasteFactorPct: '0', taxable: true }, // 200
    { lineType: 'labor', quantity: '10', unitCost: '50', wasteFactorPct: '0', taxable: false }, // 500
    { lineType: 'equipment', quantity: '1', unitCost: '100', wasteFactorPct: '0', taxable: true }, // 100
  ];

  it('subtotals by type and sums direct cost', () => {
    const t = computeEstimate(lines, { overheadPct: '0', profitPct: '0', taxRate: '0' });
    expect(t.materialSubtotal).toBe(200);
    expect(t.laborSubtotal).toBe(500);
    expect(t.equipmentSubtotal).toBe(100);
    expect(t.directCost).toBe(800);
  });

  it('applies overhead then profit on cost + overhead', () => {
    const t = computeEstimate(lines, { overheadPct: '0.1', profitPct: '0.2', taxRate: '0' });
    // overhead 800*0.1 = 80; profit (800+80)*0.2 = 176; price 1056
    expect(t.overheadAmount).toBe(80);
    expect(t.profitAmount).toBe(176);
    expect(t.priceBeforeTax).toBe(1056);
  });

  it('taxes only the taxable share of the marked-up price', () => {
    const t = computeEstimate(lines, { overheadPct: '0.1', profitPct: '0.2', taxRate: '0.06' });
    // taxable cost = 300 (material+equipment) of 800 direct → fraction 0.375
    // taxable price = 1056 * 0.375 = 396; tax = 396 * 0.06 = 23.76
    expect(t.taxAmount).toBe(23.76);
    expect(t.finalPrice).toBe(1079.76);
  });

  it('computes gross margin on the pre-tax price', () => {
    const t = computeEstimate(lines, { overheadPct: '0.1', profitPct: '0.2', taxRate: '0' });
    // (1056 - 800) / 1056 = 0.2424…
    expect(t.grossMarginPct).toBeCloseTo(0.2424, 4);
    expect(t.markupPct).toBeCloseTo(0.32, 4); // (1056-800)/800
  });

  it('buckets allowance/other into direct cost but not named subtotals', () => {
    const t = computeEstimate(
      [{ lineType: 'allowance', quantity: '1', unitCost: '500', wasteFactorPct: '0' }],
      { overheadPct: '0', profitPct: '0', taxRate: '0' },
    );
    expect(t.otherSubtotal).toBe(500);
    expect(t.directCost).toBe(500);
    expect(t.materialSubtotal).toBe(0);
  });

  it('is all zeros with no lines and avoids divide-by-zero margins', () => {
    const t = computeEstimate([], { overheadPct: '0.1', profitPct: '0.2', taxRate: '0.06' });
    expect(t.directCost).toBe(0);
    expect(t.finalPrice).toBe(0);
    expect(t.grossMarginPct).toBe(0);
    expect(t.markupPct).toBe(0);
  });

  it('treats an all-non-taxable estimate as zero tax', () => {
    const t = computeEstimate(
      [{ lineType: 'labor', quantity: '10', unitCost: '50', wasteFactorPct: '0', taxable: false }],
      { overheadPct: '0', profitPct: '0', taxRate: '0.06' },
    );
    expect(t.taxAmount).toBe(0);
    expect(t.finalPrice).toBe(500);
  });
});

describe('formatting', () => {
  it('formats money', () => {
    expect(formatMoney(1056)).toBe('$1,056.00');
    expect(formatMoney(null)).toBe('$0.00');
  });
  it('formats a margin fraction as a percent', () => {
    expect(formatMarginPct('0.2424')).toBe('24.2%');
    expect(formatMarginPct(0)).toBe('0%');
  });
});

describe('nextSortOrder', () => {
  it('is 0 empty, else max+1', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sortOrder: 3 }, { sortOrder: 7 }])).toBe(8);
  });
});
