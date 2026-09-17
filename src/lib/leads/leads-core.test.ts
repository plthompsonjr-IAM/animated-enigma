import { describe, it, expect } from 'vitest';
import {
  canTransition,
  followUpUrgency,
  formatProjectNumber,
  sortLeads,
  LEAD_STATUSES,
  OPEN_STATUSES,
  CLOSED_STATUSES,
  type SortableLead,
} from './leads-core';

describe('canTransition', () => {
  it('allows moving between non-terminal statuses', () => {
    expect(canTransition('new', 'contacted')).toBe(true);
    expect(canTransition('qualified', 'estimating')).toBe(true);
    expect(canTransition('proposal_sent', 'won')).toBe(true);
  });

  it('rejects a no-op transition', () => {
    expect(canTransition('new', 'new')).toBe(false);
  });

  it('locks a converted lead (no status changes)', () => {
    expect(canTransition('won', 'contacted', { converted: true })).toBe(false);
    expect(canTransition('won', 'lost', { converted: true })).toBe(false);
  });
});

describe('status groupings', () => {
  it('has nine statuses', () => {
    expect(LEAD_STATUSES).toHaveLength(9);
  });
  it('treats won and lost as closed', () => {
    expect(CLOSED_STATUSES).toEqual(['won', 'lost']);
  });
  it('excludes closed and on_hold from open pipeline', () => {
    expect(OPEN_STATUSES).not.toContain('won');
    expect(OPEN_STATUSES).not.toContain('lost');
    expect(OPEN_STATUSES).not.toContain('on_hold');
    expect(OPEN_STATUSES).toContain('new');
  });
});

describe('followUpUrgency', () => {
  const today = new Date('2026-07-21T12:00:00Z');

  it('returns none when there is no date', () => {
    expect(followUpUrgency(null, today)).toBe('none');
  });
  it('flags past dates overdue', () => {
    expect(followUpUrgency('2026-07-20', today)).toBe('overdue');
  });
  it('flags the same calendar day as today', () => {
    expect(followUpUrgency('2026-07-21', today)).toBe('today');
  });
  it('flags within two days as soon', () => {
    expect(followUpUrgency('2026-07-23', today)).toBe('soon');
  });
  it('flags farther out as later', () => {
    expect(followUpUrgency('2026-08-01', today)).toBe('later');
  });
});

describe('formatProjectNumber', () => {
  it('zero-pads the sequence to four digits', () => {
    expect(formatProjectNumber(2026, 7)).toBe('PRJ-2026-0007');
    expect(formatProjectNumber(2026, 1234)).toBe('PRJ-2026-1234');
  });
});

describe('sortLeads', () => {
  const leads: SortableLead[] = [
    { leadName: 'Bravo', priority: 'low', nextFollowUpDate: '2026-07-25', createdAt: '2026-07-10' },
    { leadName: 'Alpha', priority: 'high', nextFollowUpDate: null, createdAt: '2026-07-15' },
    {
      leadName: 'Charlie',
      priority: 'medium',
      nextFollowUpDate: '2026-07-20',
      createdAt: '2026-07-12',
    },
  ];

  it('recent = newest createdAt first', () => {
    expect(sortLeads(leads, 'recent').map((l) => l.leadName)).toEqual([
      'Alpha',
      'Charlie',
      'Bravo',
    ]);
  });
  it('oldest = earliest createdAt first', () => {
    expect(sortLeads(leads, 'oldest').map((l) => l.leadName)).toEqual([
      'Bravo',
      'Charlie',
      'Alpha',
    ]);
  });
  it('name = alphabetical', () => {
    expect(sortLeads(leads, 'name').map((l) => l.leadName)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
  it('priority = high → low, dateless handled', () => {
    expect(sortLeads(leads, 'priority').map((l) => l.leadName)).toEqual([
      'Alpha',
      'Charlie',
      'Bravo',
    ]);
  });
  it('follow_up = earliest due first, nulls last', () => {
    expect(sortLeads(leads, 'follow_up').map((l) => l.leadName)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });
  it('does not mutate the input array', () => {
    const before = leads.map((l) => l.leadName);
    sortLeads(leads, 'name');
    expect(leads.map((l) => l.leadName)).toEqual(before);
  });
});
