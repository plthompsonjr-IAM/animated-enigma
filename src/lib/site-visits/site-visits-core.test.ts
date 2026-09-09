import { describe, it, expect } from 'vitest';
import {
  visitUrgency,
  partitionVisits,
  groupByDay,
  dayKey,
  VISIT_STATUSES,
  VISIT_TYPES,
  type SchedulableVisit,
} from './site-visits-core';

describe('enums', () => {
  it('has three statuses and five types', () => {
    expect(VISIT_STATUSES).toEqual(['scheduled', 'completed', 'cancelled']);
    expect(VISIT_TYPES).toHaveLength(5);
  });
});

describe('visitUrgency', () => {
  const now = new Date('2026-07-23T12:00:00');

  it('is none for non-scheduled or dateless visits', () => {
    expect(visitUrgency('completed', '2026-07-24T10:00:00', now)).toBe('none');
    expect(visitUrgency('cancelled', '2026-07-24T10:00:00', now)).toBe('none');
    expect(visitUrgency('scheduled', null, now)).toBe('none');
  });
  it('flags a past scheduled visit overdue', () => {
    expect(visitUrgency('scheduled', '2026-07-23T09:00:00', now)).toBe('overdue');
    expect(visitUrgency('scheduled', '2026-07-20T09:00:00', now)).toBe('overdue');
  });
  it('flags later today as today', () => {
    expect(visitUrgency('scheduled', '2026-07-23T18:00:00', now)).toBe('today');
  });
  it('flags tomorrow', () => {
    expect(visitUrgency('scheduled', '2026-07-24T08:00:00', now)).toBe('tomorrow');
  });
  it('flags further out as upcoming', () => {
    expect(visitUrgency('scheduled', '2026-07-30T08:00:00', now)).toBe('upcoming');
  });
});

describe('partitionVisits', () => {
  const now = new Date('2026-07-23T12:00:00');
  const visits: SchedulableVisit[] = [
    { id: 'a', status: 'scheduled', scheduledAt: '2026-07-25T09:00:00' },
    { id: 'b', status: 'scheduled', scheduledAt: '2026-07-24T09:00:00' },
    { id: 'c', status: 'completed', scheduledAt: '2026-07-20T09:00:00' },
    { id: 'd', status: 'cancelled', scheduledAt: '2026-07-28T09:00:00' },
    { id: 'e', status: 'scheduled', scheduledAt: '2026-07-10T09:00:00' },
  ];

  it('puts future scheduled visits in upcoming, soonest first', () => {
    const { upcoming } = partitionVisits(visits, now);
    expect(upcoming.map((v) => v.id)).toEqual(['b', 'a']);
  });
  it('puts completed, cancelled, and past-scheduled in past, newest first', () => {
    const { past } = partitionVisits(visits, now);
    expect(past.map((v) => v.id)).toEqual(['d', 'c', 'e']);
  });
});

describe('groupByDay', () => {
  it('groups visits sharing a calendar day', () => {
    const visits: SchedulableVisit[] = [
      { id: 'a', status: 'scheduled', scheduledAt: '2026-07-24T09:00:00' },
      { id: 'b', status: 'scheduled', scheduledAt: '2026-07-24T14:00:00' },
      { id: 'c', status: 'scheduled', scheduledAt: '2026-07-25T09:00:00' },
    ];
    const groups = groupByDay(visits);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.visits.map((v) => v.id)).toEqual(['a', 'b']);
    expect(groups[1]?.visits.map((v) => v.id)).toEqual(['c']);
  });
  it('skips visits with no scheduled time', () => {
    const groups = groupByDay([{ id: 'x', status: 'scheduled', scheduledAt: null }]);
    expect(groups).toEqual([]);
  });
});

describe('dayKey', () => {
  it('formats YYYY-MM-DD with zero padding', () => {
    expect(dayKey('2026-03-05T23:59:00')).toBe('2026-03-05');
  });
});
