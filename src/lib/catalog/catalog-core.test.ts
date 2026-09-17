import { describe, it, expect } from 'vitest';
import {
  toNum,
  computeUnitCost,
  formatCost,
  formatPct,
  formatUnitCost,
  isUnit,
  isTier,
  UNITS,
  TIERS,
} from './catalog-core';

describe('enums', () => {
  it('has eight units and three tiers', () => {
    expect(UNITS).toHaveLength(8);
    expect(TIERS).toEqual(['economic', 'standard', 'premium']);
  });
  it('guards unit and tier values', () => {
    expect(isUnit('square_foot')).toBe(true);
    expect(isUnit('furlong')).toBe(false);
    expect(isTier('premium')).toBe(true);
    expect(isTier('deluxe')).toBe(false);
  });
});

describe('toNum', () => {
  it('coerces numeric strings and numbers', () => {
    expect(toNum('12.50')).toBe(12.5);
    expect(toNum(3)).toBe(3);
  });
  it('is 0 for null/blank/garbage', () => {
    expect(toNum(null)).toBe(0);
    expect(toNum('')).toBe(0);
    expect(toNum('abc')).toBe(0);
    expect(toNum(undefined)).toBe(0);
  });
});

describe('computeUnitCost', () => {
  it('adds material (with waste), labor, and equipment', () => {
    const cost = computeUnitCost({
      defaultMaterialCost: '100',
      wastePct: '0.1', // 10%
      defaultLaborHours: '2',
      defaultLaborRate: '50',
      equipmentCost: '25',
    });
    // material 100*1.1 = 110, labor 2*50 = 100, equipment 25 → 235
    expect(cost.material).toBe(110);
    expect(cost.labor).toBe(100);
    expect(cost.equipment).toBe(25);
    expect(cost.total).toBe(235);
  });

  it('handles a material-only item', () => {
    expect(computeUnitCost({ defaultMaterialCost: '4.5' }).total).toBe(4.5);
  });

  it('handles a labor-only item', () => {
    expect(computeUnitCost({ defaultLaborHours: '1.5', defaultLaborRate: '40' }).total).toBe(60);
  });

  it('is zero for an empty item', () => {
    expect(computeUnitCost({}).total).toBe(0);
  });

  it('rounds to cents', () => {
    const cost = computeUnitCost({
      defaultMaterialCost: '10',
      wastePct: '0.075', // 7.5% → 10.75
    });
    expect(cost.total).toBe(10.75);
  });

  it('treats missing waste as zero', () => {
    expect(computeUnitCost({ defaultMaterialCost: '80' }).material).toBe(80);
  });
});

describe('formatCost', () => {
  it('formats to two decimals', () => {
    expect(formatCost('12.5')).toBe('$12.50');
    expect(formatCost(1000)).toBe('$1,000.00');
  });
  it('is blank for null/empty', () => {
    expect(formatCost(null)).toBe('');
    expect(formatCost('')).toBe('');
  });
});

describe('formatPct', () => {
  it('renders a stored fraction as a percent', () => {
    expect(formatPct('0.05')).toBe('5%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct('0.125')).toBe('12.5%');
  });
});

describe('formatUnitCost', () => {
  it('appends the unit abbreviation', () => {
    expect(formatUnitCost(4.5, 'linear_foot')).toBe('$4.50 / LF');
    expect(formatUnitCost(120, 'each')).toBe('$120.00 / ea');
  });
});
