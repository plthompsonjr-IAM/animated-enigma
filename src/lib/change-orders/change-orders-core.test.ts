import { describe, it, expect } from 'vitest';
import {
  CHANGE_ORDER_STATUSES,
  allowedTransitions,
  canTransition,
  costBreakdown,
  costChange,
  countsTowardContract,
  formatChangeOrderNumber,
  formatScheduleChange,
  isAwaitingClient,
  isEditable,
  isFrozen,
  isItemDirection,
  itemDelta,
  pendingIncorporation,
  revisedContractValue,
  totalScheduleChange,
  validateChangeOrder,
  type ChangeOrderItemInput,
} from './change-orders-core';

describe('status lifecycle', () => {
  it('has the eight documented statuses', () => {
    expect(CHANGE_ORDER_STATUSES).toHaveLength(8);
    expect(CHANGE_ORDER_STATUSES).toContain('incorporated');
  });

  it('walks draft → sent → approved → incorporated', () => {
    expect(canTransition('draft', 'sent')).toBe(true);
    expect(canTransition('sent', 'approved')).toBe(true);
    expect(canTransition('approved', 'incorporated')).toBe(true);
  });

  it('lets a declined change order be reworked but not approved directly', () => {
    expect(canTransition('declined', 'draft')).toBe(true);
    expect(canTransition('declined', 'approved')).toBe(false);
  });

  it('never un-approves or edits history', () => {
    expect(canTransition('approved', 'draft')).toBe(false);
    expect(canTransition('incorporated', 'draft')).toBe(false);
    expect(allowedTransitions('incorporated')).toEqual([]);
    expect(allowedTransitions('canceled')).toEqual([]);
  });

  it('classifies statuses for the UI', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('internal_review')).toBe(true);
    expect(isEditable('sent')).toBe(false);
    expect(isAwaitingClient('sent')).toBe(true);
    expect(isAwaitingClient('viewed')).toBe(true);
    expect(isFrozen('incorporated')).toBe(true);
    expect(isFrozen('approved')).toBe(false);
  });

  it('counts only approved and incorporated toward the contract', () => {
    expect(countsTowardContract('approved')).toBe(true);
    expect(countsTowardContract('incorporated')).toBe(true);
    expect(countsTowardContract('sent')).toBe(false);
    expect(countsTowardContract('declined')).toBe(false);
  });
});

describe('formatChangeOrderNumber', () => {
  it('zero-pads to four digits', () => {
    expect(formatChangeOrderNumber(2026, 2)).toBe('CO-2026-0002');
  });
});

describe('itemDelta', () => {
  it('added work increases cost, removed work decreases it', () => {
    expect(itemDelta({ direction: 'added', description: 'Tile', amount: 1200 })).toBe(1200);
    expect(itemDelta({ direction: 'removed', description: 'Paint', amount: 300 })).toBe(-300);
  });

  it('ignores a stray minus sign — direction carries the sign', () => {
    expect(itemDelta({ direction: 'added', description: 'Tile', amount: -1200 })).toBe(1200);
    expect(itemDelta({ direction: 'removed', description: 'Paint', amount: -300 })).toBe(-300);
  });

  it('tolerates blank and string amounts', () => {
    expect(itemDelta({ direction: 'added', description: 'x', amount: '' })).toBe(0);
    expect(itemDelta({ direction: 'added', description: 'x', amount: '450.50' })).toBe(450.5);
    expect(itemDelta({ direction: 'added', description: 'x', amount: null })).toBe(0);
  });
});

describe('costChange and costBreakdown', () => {
  const items: ChangeOrderItemInput[] = [
    { direction: 'added', description: 'Heated floor', amount: 2400 },
    { direction: 'added', description: 'Niche', amount: 350 },
    { direction: 'removed', description: 'Standard vanity', amount: 800 },
  ];

  it('nets added against removed', () => {
    expect(costChange(items)).toBe(1950);
  });

  it('breaks the total into added and removed', () => {
    expect(costBreakdown(items)).toEqual({ added: 2750, removed: -800, net: 1950 });
  });

  it('can produce a credit', () => {
    expect(costChange([{ direction: 'removed', description: 'Tub', amount: 1500 }])).toBe(-1500);
  });

  it('is empty-safe', () => {
    expect(costChange([])).toBe(0);
    expect(costBreakdown([])).toEqual({ added: 0, removed: 0, net: 0 });
  });
});

describe('validateChangeOrder', () => {
  it('requires at least one line', () => {
    expect(validateChangeOrder([]).error).toBe('Add at least one added or removed item.');
  });

  it('requires descriptions', () => {
    expect(
      validateChangeOrder([{ direction: 'added', description: '  ', amount: 100 }]).error,
    ).toBe('Every line needs a description.');
  });

  it('rejects a no-op change order', () => {
    const wash: ChangeOrderItemInput[] = [
      { direction: 'added', description: 'A', amount: 500 },
      { direction: 'removed', description: 'B', amount: 500 },
    ];
    expect(validateChangeOrder(wash, 0).ok).toBe(false);
  });

  it('accepts a zero-cost change order that moves the schedule', () => {
    const wash: ChangeOrderItemInput[] = [
      { direction: 'added', description: 'A', amount: 500 },
      { direction: 'removed', description: 'B', amount: 500 },
    ];
    expect(validateChangeOrder(wash, 5).ok).toBe(true);
  });

  it('accepts a normal cost change', () => {
    expect(
      validateChangeOrder([{ direction: 'added', description: 'Tile', amount: 1200 }]).ok,
    ).toBe(true);
  });
});

describe('revisedContractValue', () => {
  it('leaves the signed value alone when nothing is approved', () => {
    expect(
      revisedContractValue(10000, [
        { status: 'sent', costChange: 5000 },
        { status: 'declined', costChange: 9000 },
        { status: 'draft', costChange: 1000 },
      ]),
    ).toBe(10000);
  });

  it('adds approved and incorporated change orders', () => {
    expect(
      revisedContractValue(10000, [
        { status: 'approved', costChange: 1950 },
        { status: 'incorporated', costChange: 500 },
      ]),
    ).toBe(12450);
  });

  it('handles credits and string amounts from the database', () => {
    expect(
      revisedContractValue(10000, [
        { status: 'approved', costChange: '-1500.00' },
        { status: 'approved', costChange: '250.25' },
      ]),
    ).toBe(8750.25);
  });

  it('is exact to the cent across many changes', () => {
    const changes = Array.from({ length: 3 }, () => ({
      status: 'approved' as const,
      costChange: 0.1,
    }));
    expect(revisedContractValue(0, changes)).toBe(0.3);
  });
});

describe('totalScheduleChange and pendingIncorporation', () => {
  it('sums schedule days from approved change orders only', () => {
    expect(
      totalScheduleChange([
        { status: 'approved', costChange: 0, scheduleChangeDays: 5 },
        { status: 'incorporated', costChange: 0, scheduleChangeDays: 3 },
        { status: 'sent', costChange: 0, scheduleChangeDays: 10 },
      ]),
    ).toBe(8);
  });

  it('counts approved-but-not-yet-incorporated change orders', () => {
    expect(
      pendingIncorporation([
        { status: 'approved' },
        { status: 'approved' },
        { status: 'incorporated' },
        { status: 'sent' },
      ]),
    ).toBe(2);
  });
});

describe('formatScheduleChange', () => {
  it('reads naturally in both directions', () => {
    expect(formatScheduleChange(0)).toBe('No schedule change');
    expect(formatScheduleChange(1)).toBe('+1 day');
    expect(formatScheduleChange(7)).toBe('+7 days');
    expect(formatScheduleChange(-2)).toBe('-2 days');
  });
});

describe('isItemDirection', () => {
  it('guards form input', () => {
    expect(isItemDirection('added')).toBe(true);
    expect(isItemDirection('sideways')).toBe(false);
  });
});
