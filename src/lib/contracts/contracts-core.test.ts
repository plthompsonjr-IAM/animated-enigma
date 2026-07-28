import { describe, it, expect } from 'vitest';
import {
  CONTRACT_STATUSES,
  allowedTransitions,
  canTransition,
  defaultMilestones,
  formatContractNumber,
  isEditable,
  isFrozen,
  isPaymentStructure,
  milestoneAmount,
  sumMilestones,
  validateSchedule,
  type MilestoneInput,
} from './contracts-core';

describe('status lifecycle', () => {
  it('has the four PRD statuses', () => {
    expect(CONTRACT_STATUSES).toEqual(['draft', 'active', 'completed', 'cancelled']);
  });

  it('allows draft → active/cancelled and active → completed/cancelled', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('active', 'completed')).toBe(true);
    expect(canTransition('active', 'cancelled')).toBe(true);
  });

  it('never reopens a contract or skips activation', () => {
    expect(canTransition('completed', 'active')).toBe(false);
    expect(canTransition('cancelled', 'active')).toBe(false);
    expect(canTransition('active', 'draft')).toBe(false);
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(allowedTransitions('completed')).toEqual([]);
  });

  it('is editable only while draft', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('active')).toBe(false);
    expect(isFrozen('active')).toBe(true);
    expect(isFrozen('draft')).toBe(false);
  });
});

describe('formatContractNumber', () => {
  it('zero-pads to four digits', () => {
    expect(formatContractNumber(2026, 3)).toBe('CON-2026-0003');
    expect(formatContractNumber(2026, 1042)).toBe('CON-2026-1042');
  });
});

describe('milestoneAmount', () => {
  it('prefers an explicit amount over a percentage', () => {
    expect(milestoneAmount({ name: 'Deposit', amount: 500, percentage: 90 }, 10000)).toBe(500);
  });
  it('resolves a percentage against the contract value', () => {
    expect(milestoneAmount({ name: 'Deposit', percentage: 75 }, 14500)).toBe(10875);
  });
  it('rounds to cents', () => {
    expect(milestoneAmount({ name: 'Third', percentage: 33.333 }, 1000)).toBe(333.33);
  });
  it('treats empty strings as unset rather than zero-amount', () => {
    expect(milestoneAmount({ name: 'x', amount: '', percentage: 50 }, 1000)).toBe(500);
    expect(milestoneAmount({ name: 'x', amount: '', percentage: '' }, 1000)).toBe(0);
  });
});

describe('sumMilestones', () => {
  it('adds mixed amount/percentage rows', () => {
    const rows: MilestoneInput[] = [
      { name: 'Deposit', amount: 1000 },
      { name: 'Draw', percentage: 50 },
    ];
    expect(sumMilestones(rows, 10000)).toBe(6000);
  });
});

describe('validateSchedule', () => {
  const value = 10000;

  it('accepts a schedule that accounts for the whole contract', () => {
    const rows: MilestoneInput[] = [
      { name: 'Deposit', percentage: 75 },
      { name: 'Balance', percentage: 25 },
    ];
    const result = validateSchedule(rows, value, 'deposit_balance');
    expect(result.ok).toBe(true);
    expect(result.total).toBe(10000);
    expect(result.remainder).toBe(0);
  });

  it('rejects an under-scheduled contract and says how short it is', () => {
    const result = validateSchedule([{ name: 'Deposit', amount: 4000 }], value, 'milestone');
    expect(result.ok).toBe(false);
    expect(result.remainder).toBe(6000);
    expect(result.error).toContain('$6,000.00');
    expect(result.error).toContain('short of');
  });

  it('rejects an over-scheduled contract', () => {
    const result = validateSchedule([{ name: 'All', amount: 12000 }], value, 'milestone');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('over');
  });

  it('requires at least one named, non-negative payment', () => {
    expect(validateSchedule([], value, 'milestone').error).toBe('Add at least one payment.');
    expect(validateSchedule([{ name: '  ', amount: 10000 }], value, 'milestone').error).toBe(
      'Every payment needs a name.',
    );
    expect(
      validateSchedule(
        [
          { name: 'Credit', amount: -100 },
          { name: 'Rest', amount: 10100 },
        ],
        value,
        'milestone',
      ).error,
    ).toBe('Payments cannot be negative.');
  });

  it('tolerates sub-cent rounding drift from percentages', () => {
    const thirds: MilestoneInput[] = [
      { name: 'A', percentage: 33.333 },
      { name: 'B', percentage: 33.333 },
      { name: 'C', percentage: 33.334 },
    ];
    expect(validateSchedule(thirds, 1000, 'percentage').ok).toBe(true);
  });

  it('exempts time & materials and maintenance, which have no fixed draws', () => {
    expect(validateSchedule([], value, 'time_materials').ok).toBe(true);
    expect(validateSchedule([], value, 'maintenance').ok).toBe(true);
  });
});

describe('defaultMilestones', () => {
  it('offers a 75/25 deposit-and-balance split that validates', () => {
    const rows = defaultMilestones('deposit_balance');
    expect(rows.map((r) => r.percentage)).toEqual([75, 25]);
    expect(validateSchedule(rows, 8000, 'deposit_balance').ok).toBe(true);
  });

  it('produces schedules totalling 100% for every fixed structure', () => {
    for (const structure of ['deposit_balance', 'percentage', 'milestone'] as const) {
      expect(validateSchedule(defaultMilestones(structure), 12345.67, structure).ok).toBe(true);
    }
  });

  it('leaves T&M and maintenance empty', () => {
    expect(defaultMilestones('time_materials')).toEqual([]);
    expect(defaultMilestones('maintenance')).toEqual([]);
  });
});

describe('isPaymentStructure', () => {
  it('guards unknown input from forms', () => {
    expect(isPaymentStructure('milestone')).toBe(true);
    expect(isPaymentStructure('whatever')).toBe(false);
  });
});
