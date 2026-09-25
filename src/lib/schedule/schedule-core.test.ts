import { describe, it, expect } from 'vitest';
import {
  MAX_ITEM_SPAN_DAYS,
  SCHEDULE_ITEM_STATUSES,
  addDays,
  boundingRange,
  conflictsForItem,
  dayDiff,
  daysInRange,
  dependencyProblems,
  describeTiming,
  displayPercent,
  endOfWeek,
  findCrewConflicts,
  formatDay,
  formatRange,
  groupByStartDay,
  isDay,
  isScheduleItemStatus,
  isWeekend,
  itemUrgency,
  itemsOnDay,
  occupiesCrew,
  overlapRange,
  overlaps,
  percentValue,
  scheduleHealth,
  spanDays,
  startOfWeek,
  timelineBars,
  timelineWindow,
  today,
  todayMarker,
  validateScheduleItem,
  weeksInWindow,
  workingDays,
  wouldCycle,
  type AssignedItem,
  type ScheduleItemStatus,
} from './schedule-core';

describe('catalogs', () => {
  it('has the five documented item statuses', () => {
    expect(SCHEDULE_ITEM_STATUSES).toHaveLength(5);
  });
  it('guards form input', () => {
    expect(isScheduleItemStatus('in_progress')).toBe(true);
    expect(isScheduleItemStatus('almost')).toBe(false);
  });
  it('only counts live work against a crew member', () => {
    expect(occupiesCrew('in_progress')).toBe(true);
    expect(occupiesCrew('blocked')).toBe(true);
    expect(occupiesCrew('not_started')).toBe(true);
    expect(occupiesCrew('complete')).toBe(false);
    expect(occupiesCrew('canceled')).toBe(false);
  });
});

describe('isDay', () => {
  it('accepts real calendar days only', () => {
    expect(isDay('2026-07-30')).toBe(true);
    expect(isDay('2024-02-29')).toBe(true); // leap year
  });
  it('rejects impossible and malformed dates', () => {
    expect(isDay('2026-02-29')).toBe(false); // 2026 is not a leap year
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-7-30')).toBe(false);
    expect(isDay('2026-07-30T00:00:00Z')).toBe(false);
    expect(isDay('')).toBe(false);
    expect(isDay(null)).toBe(false);
    expect(isDay(20260730)).toBe(false);
  });
});

describe('day arithmetic', () => {
  it('adds and subtracts whole days across month and year ends', () => {
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-07-30', 0)).toBe('2026-07-30');
    expect(addDays('nope', 1)).toBeNull();
  });

  it('survives a spring-forward DST boundary', () => {
    // US DST starts 2026-03-08. Naive local-midnight arithmetic loses an hour
    // here and can land on the wrong day.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(dayDiff('2026-03-07', '2026-03-09')).toBe(2);
    expect(spanDays('2026-03-06', '2026-03-10')).toBe(5);
  });

  it('measures signed differences and inclusive spans', () => {
    expect(dayDiff('2026-07-30', '2026-08-02')).toBe(3);
    expect(dayDiff('2026-08-02', '2026-07-30')).toBe(-3);
    expect(dayDiff('2026-07-30', '2026-07-30')).toBe(0);
    // A one-day item spans one day, not zero.
    expect(spanDays('2026-07-30', '2026-07-30')).toBe(1);
    expect(spanDays('2026-07-30', '2026-08-02')).toBe(4);
    expect(spanDays('bad', '2026-08-02')).toBeNull();
  });

  it('knows weekends and counts only working days', () => {
    expect(isWeekend('2026-08-01')).toBe(true); // Saturday
    expect(isWeekend('2026-08-02')).toBe(true); // Sunday
    expect(isWeekend('2026-08-03')).toBe(false); // Monday
    // Mon 2026-07-27 → Fri 2026-08-07: ten working days across two weekends.
    expect(workingDays('2026-07-27', '2026-08-07')).toBe(10);
    expect(workingDays('2026-08-01', '2026-08-02')).toBe(0);
    expect(workingDays('2026-08-03', '2026-08-03')).toBe(1);
    expect(workingDays('2026-08-05', '2026-08-03')).toBe(0);
  });

  it('enumerates a range, and refuses to run away', () => {
    expect(daysInRange('2026-07-30', '2026-08-01')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
    expect(daysInRange('2026-08-01', '2026-07-30')).toEqual([]);
    expect(daysInRange('2020-01-01', '2030-01-01')).toHaveLength(400);
    expect(daysInRange('2026-07-30', '2026-08-30', 5)).toHaveLength(5);
  });
});

describe('overlaps', () => {
  const a = { startDate: '2026-08-03', endDate: '2026-08-07' };

  it('counts a shared day as an overlap, including a single touching day', () => {
    expect(overlaps(a, { startDate: '2026-08-07', endDate: '2026-08-10' })).toBe(true);
    expect(overlaps(a, { startDate: '2026-08-01', endDate: '2026-08-03' })).toBe(true);
    expect(overlaps(a, a)).toBe(true);
  });
  it('is false for adjacent-but-separate ranges', () => {
    expect(overlaps(a, { startDate: '2026-08-08', endDate: '2026-08-12' })).toBe(false);
    expect(overlaps(a, { startDate: '2026-07-28', endDate: '2026-08-02' })).toBe(false);
  });
  it('is false when either range is unusable', () => {
    expect(overlaps(a, { startDate: 'x', endDate: '2026-08-05' })).toBe(false);
  });
  it('reports the shared days', () => {
    expect(overlapRange(a, { startDate: '2026-08-05', endDate: '2026-08-12' })).toEqual({
      startDate: '2026-08-05',
      endDate: '2026-08-07',
    });
    // A fully-contained range is its own overlap.
    expect(overlapRange(a, { startDate: '2026-08-04', endDate: '2026-08-05' })).toEqual({
      startDate: '2026-08-04',
      endDate: '2026-08-05',
    });
    expect(overlapRange(a, { startDate: '2026-09-01', endDate: '2026-09-02' })).toBeNull();
  });
  it('bounds a set of ranges, ignoring undated ones', () => {
    expect(
      boundingRange([
        { startDate: '2026-08-10', endDate: '2026-08-12' },
        { startDate: '2026-08-03', endDate: '2026-08-07' },
        { startDate: 'bad', endDate: 'bad' },
      ]),
    ).toEqual({ startDate: '2026-08-03', endDate: '2026-08-12' });
    expect(boundingRange([])).toBeNull();
  });
});

describe('validateScheduleItem', () => {
  const good = { name: 'Rough-in plumbing', startDate: '2026-08-03', endDate: '2026-08-07' };

  it('accepts a well-formed item', () => {
    expect(validateScheduleItem(good).error).toBeUndefined();
    expect(validateScheduleItem({ ...good, endDate: good.startDate }).error).toBeUndefined();
  });
  it('requires a name', () => {
    expect(validateScheduleItem({ ...good, name: '   ' }).error).toContain('name');
    expect(validateScheduleItem({ ...good, name: 'x'.repeat(201) }).error).toContain('200');
  });
  it('requires real dates in the right order', () => {
    expect(validateScheduleItem({ ...good, startDate: '' }).error).toContain('start date');
    expect(validateScheduleItem({ ...good, endDate: '2026-02-30' }).error).toContain('end date');
    expect(validateScheduleItem({ ...good, endDate: '2026-08-02' }).error).toContain(
      'before the start date',
    );
  });
  it('refuses an item longer than a year', () => {
    const end = addDays(good.startDate, MAX_ITEM_SPAN_DAYS)!;
    expect(validateScheduleItem({ ...good, endDate: end }).error).toContain('split');
  });
  it('bounds percent complete', () => {
    expect(validateScheduleItem({ ...good, percentComplete: 50 }).error).toBeUndefined();
    expect(validateScheduleItem({ ...good, percentComplete: 101 }).error).toContain('0 and 100');
    expect(validateScheduleItem({ ...good, percentComplete: -1 }).error).toContain('0 and 100');
    expect(validateScheduleItem({ ...good, percentComplete: '12.5' }).error).toContain(
      'whole number',
    );
  });
});

describe('percent complete', () => {
  it('treats empty as zero and rejects fractions', () => {
    expect(percentValue('')).toBe(0);
    expect(percentValue(null)).toBe(0);
    expect(percentValue('40')).toBe(40);
    expect(percentValue('40.5')).toBeNull();
    expect(percentValue('abc')).toBeNull();
  });
  it('never lets the bar contradict the badge', () => {
    expect(displayPercent('complete', 30)).toBe(100);
    expect(displayPercent('not_started', 30)).toBe(0);
    expect(displayPercent('in_progress', 30)).toBe(30);
    expect(displayPercent('in_progress', 130)).toBe(100);
    expect(displayPercent('blocked', null)).toBe(0);
  });
});

describe('findCrewConflicts', () => {
  const item = (over: Partial<AssignedItem> & { id: string }): AssignedItem => ({
    name: `Item ${over.id}`,
    status: 'not_started',
    projectId: 'p1',
    projectName: 'Bath remodel',
    userId: 'u1',
    userName: 'Mike',
    startDate: '2026-08-03',
    endDate: '2026-08-07',
    ...over,
  });

  it('finds a double-booking and reports the shared days', () => {
    const conflicts = findCrewConflicts([
      item({ id: 'a' }),
      item({ id: 'b', startDate: '2026-08-05', endDate: '2026-08-10' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.userName).toBe('Mike');
    expect(conflicts[0]!.overlap).toEqual({ startDate: '2026-08-05', endDate: '2026-08-07' });
    expect(conflicts[0]!.days).toBe(3);
    expect(conflicts[0]!.crossProject).toBe(false);
  });

  it('reports each pair once, earliest item first', () => {
    const conflicts = findCrewConflicts([
      item({ id: 'b', startDate: '2026-08-05', endDate: '2026-08-10' }),
      item({ id: 'a' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.a.id).toBe('a');
    expect(conflicts[0]!.b.id).toBe('b');
  });

  it('flags a cross-project clash, which is the expensive kind', () => {
    const conflicts = findCrewConflicts([
      item({ id: 'a' }),
      item({ id: 'b', projectId: 'p2', projectName: 'Kitchen' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.crossProject).toBe(true);
  });

  it('does not consider different people to be in conflict', () => {
    expect(
      findCrewConflicts([item({ id: 'a' }), item({ id: 'b', userId: 'u2', userName: 'Dave' })]),
    ).toEqual([]);
  });

  it('ignores completed and canceled work', () => {
    expect(
      findCrewConflicts([item({ id: 'a' }), item({ id: 'b', status: 'complete' })]),
    ).toEqual([]);
    expect(
      findCrewConflicts([item({ id: 'a' }), item({ id: 'b', status: 'canceled' })]),
    ).toEqual([]);
    // But blocked work still holds the crew.
    expect(
      findCrewConflicts([item({ id: 'a' }), item({ id: 'b', status: 'blocked' })]),
    ).toHaveLength(1);
  });

  it('ignores back-to-back work and undated items', () => {
    expect(
      findCrewConflicts([
        item({ id: 'a' }),
        item({ id: 'b', startDate: '2026-08-08', endDate: '2026-08-12' }),
      ]),
    ).toEqual([]);
    expect(
      findCrewConflicts([item({ id: 'a' }), item({ id: 'b', startDate: '', endDate: '' })]),
    ).toEqual([]);
  });

  it('finds every pair when someone is triple-booked', () => {
    const conflicts = findCrewConflicts([
      item({ id: 'a' }),
      item({ id: 'b', startDate: '2026-08-04', endDate: '2026-08-06' }),
      item({ id: 'c', startDate: '2026-08-05', endDate: '2026-08-09' }),
    ]);
    expect(conflicts).toHaveLength(3);
    expect(conflictsForItem(conflicts, 'b')).toHaveLength(2);
    expect(conflictsForItem(conflicts, 'zz')).toHaveLength(0);
  });

  it('handles the same person assigned twice to one item without self-conflict', () => {
    expect(findCrewConflicts([item({ id: 'a' }), item({ id: 'a' })])).toEqual([]);
  });
});

describe('dependencies', () => {
  const items = [
    { id: 'demo', name: 'Demo', startDate: '2026-08-03', endDate: '2026-08-05' },
    {
      id: 'rough',
      name: 'Rough-in',
      startDate: '2026-08-04',
      endDate: '2026-08-10',
      dependsOnId: 'demo',
    },
  ];

  it('flags work starting before its predecessor finishes', () => {
    const problems = dependencyProblems(items);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.item.id).toBe('rough');
    expect(problems[0]!.predecessor.id).toBe('demo');
    expect(problems[0]!.daysEarly).toBe(2); // starts the 4th, predecessor ends the 5th
  });

  it('is quiet when the sequence is clean', () => {
    expect(
      dependencyProblems([items[0]!, { ...items[1]!, startDate: '2026-08-06' }]),
    ).toEqual([]);
  });

  it('ignores missing predecessors rather than throwing', () => {
    expect(dependencyProblems([{ ...items[1]!, dependsOnId: 'gone' }])).toEqual([]);
    expect(dependencyProblems([items[0]!])).toEqual([]);
  });

  it('refuses a dependency that would close a loop', () => {
    const chain = [
      { id: 'a', dependsOnId: null },
      { id: 'b', dependsOnId: 'a' },
      { id: 'c', dependsOnId: 'b' },
    ];
    expect(wouldCycle(chain, 'a', 'a')).toBe(true);
    expect(wouldCycle(chain, 'a', 'c')).toBe(true);
    expect(wouldCycle(chain, 'c', 'a')).toBe(false);
    expect(wouldCycle(chain, 'a', 'missing')).toBe(false);
  });

  it('terminates on a cycle already present in the data', () => {
    const bad = [
      { id: 'a', dependsOnId: 'b' },
      { id: 'b', dependsOnId: 'a' },
    ];
    expect(wouldCycle(bad, 'c', 'a')).toBe(true);
  });
});

describe('itemUrgency & describeTiming', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('reads an item against today', () => {
    const at = (startDate: string, endDate: string) =>
      itemUrgency({ startDate, endDate, status: 'in_progress' }, now);
    expect(at('2026-08-01', '2026-08-04')).toBe('overdue');
    expect(at('2026-08-05', '2026-08-09')).toBe('starts_today');
    expect(at('2026-08-03', '2026-08-09')).toBe('active');
    expect(at('2026-08-10', '2026-08-14')).toBe('upcoming');
    // Ending today is not late.
    expect(at('2026-08-03', '2026-08-05')).toBe('active');
  });

  it('never calls finished work overdue', () => {
    expect(
      itemUrgency({ startDate: '2026-07-01', endDate: '2026-07-04', status: 'complete' }, now),
    ).toBe('done');
    expect(
      itemUrgency({ startDate: '2026-07-01', endDate: '2026-07-04', status: 'canceled' }, now),
    ).toBe('done');
  });

  it('says it in words', () => {
    const say = (startDate: string, endDate: string, status: ScheduleItemStatus = 'in_progress') =>
      describeTiming({ startDate, endDate, status }, now);
    expect(say('2026-08-01', '2026-08-04')).toBe('1 day past due');
    expect(say('2026-08-01', '2026-08-02')).toBe('3 days past due');
    expect(say('2026-08-05', '2026-08-09')).toBe('Starts today');
    expect(say('2026-08-03', '2026-08-05')).toBe('Due today');
    expect(say('2026-08-03', '2026-08-06')).toBe('Due tomorrow');
    expect(say('2026-08-03', '2026-08-09')).toBe('4 days left');
    expect(say('2026-08-06', '2026-08-09')).toBe('Starts tomorrow');
    expect(say('2026-08-10', '2026-08-14')).toBe('Starts in 5 days');
    expect(say('2026-07-01', '2026-07-04', 'complete')).toBe('Complete');
  });
});

describe('scheduleHealth', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('summarises a live schedule', () => {
    const health = scheduleHealth(
      [
        { startDate: '2026-08-01', endDate: '2026-08-04', status: 'in_progress' }, // overdue
        { startDate: '2026-08-03', endDate: '2026-08-09', status: 'in_progress' }, // active
        { startDate: '2026-08-07', endDate: '2026-08-11', status: 'not_started' }, // this week
        { startDate: '2026-08-20', endDate: '2026-08-25', status: 'blocked' },
        { startDate: '2026-07-20', endDate: '2026-07-25', status: 'complete' },
      ],
      now,
    );
    expect(health.total).toBe(5);
    expect(health.overdue).toBe(1);
    // Overdue is its own bucket — the one late item isn't also counted active.
    expect(health.active).toBe(1);
    expect(health.startingThisWeek).toBe(1);
    expect(health.blocked).toBe(1);
    expect(health.complete).toBe(1);
  });

  it('weights progress by duration, so a long phase counts for more', () => {
    // 10 days at 100% and 1 day at 0% is 91%, not 50%.
    const health = scheduleHealth(
      [
        { startDate: '2026-08-01', endDate: '2026-08-10', status: 'complete' },
        { startDate: '2026-08-11', endDate: '2026-08-11', status: 'not_started' },
      ],
      now,
    );
    expect(health.percentComplete).toBe(91);
  });

  it('excludes canceled work from progress and the counts', () => {
    const health = scheduleHealth(
      [
        { startDate: '2026-08-01', endDate: '2026-08-02', status: 'complete' },
        { startDate: '2026-08-01', endDate: '2026-08-02', status: 'canceled' },
      ],
      now,
    );
    expect(health.percentComplete).toBe(100);
    expect(health.complete).toBe(1);
  });

  it('has no opinion on an empty schedule', () => {
    expect(scheduleHealth([], now).percentComplete).toBeNull();
  });
});

describe('timeline geometry', () => {
  const window = { startDate: '2026-08-02', endDate: '2026-08-29' }; // 28 days

  it('places a bar as a percentage of the window', () => {
    const [bar] = timelineBars([{ startDate: '2026-08-09', endDate: '2026-08-15' }], window);
    expect(bar!.offset).toBeCloseTo((7 / 28) * 100);
    expect(bar!.width).toBeCloseTo((7 / 28) * 100);
    expect(bar!.clippedStart).toBe(false);
    expect(bar!.clippedEnd).toBe(false);
  });

  it('clips at the window edges and flags it', () => {
    const [bar] = timelineBars([{ startDate: '2026-07-20', endDate: '2026-09-20' }], window);
    expect(bar!.offset).toBe(0);
    expect(bar!.width).toBe(100);
    expect(bar!.clippedStart).toBe(true);
    expect(bar!.clippedEnd).toBe(true);
  });

  it('drops items entirely outside the window', () => {
    expect(timelineBars([{ startDate: '2026-09-01', endDate: '2026-09-05' }], window)).toEqual([]);
  });

  it('gives a single day real width rather than zero', () => {
    const [bar] = timelineBars([{ startDate: '2026-08-02', endDate: '2026-08-02' }], window);
    expect(bar!.width).toBeCloseTo((1 / 28) * 100);
  });

  it('refuses a backwards window', () => {
    expect(
      timelineBars([{ startDate: '2026-08-02', endDate: '2026-08-03' }], {
        startDate: '2026-08-29',
        endDate: '2026-08-02',
      }),
    ).toEqual([]);
  });

  it('snaps to whole weeks, always includes today, and honours a minimum', () => {
    const now = new Date('2026-08-05T12:00:00Z'); // Wednesday
    const win = timelineWindow([{ startDate: '2026-08-10', endDate: '2026-08-14' }], now);
    expect(startOfWeek(win.startDate)).toBe(win.startDate);
    expect(endOfWeek(win.endDate)).toBe(win.endDate);
    expect(win.startDate <= today(now)).toBe(true);
    expect((spanDays(win.startDate, win.endDate) ?? 0) % 7).toBe(0);
    expect(spanDays(win.startDate, win.endDate)).toBeGreaterThanOrEqual(28);
  });

  it('caps the window so one stray date cannot stretch the axis over years', () => {
    const now = new Date('2026-08-05T12:00:00Z');
    const win = timelineWindow([{ startDate: '2026-08-03', endDate: '2029-01-05' }], now);
    // 26 weeks, not two and a half years.
    expect(spanDays(win.startDate, win.endDate)).toBe(26 * 7);
    expect(win.endDate).toBe(endOfWeek(win.endDate));
  });

  it('still produces a usable window with nothing scheduled', () => {
    const win = timelineWindow([], new Date('2026-08-05T12:00:00Z'));
    expect(spanDays(win.startDate, win.endDate)).toBe(28);
  });

  it('lays out weekly columns and marks today inside its own column', () => {
    const now = new Date('2026-08-05T12:00:00Z');
    expect(weeksInWindow(window)).toEqual([
      '2026-08-02',
      '2026-08-09',
      '2026-08-16',
      '2026-08-23',
    ]);
    const marker = todayMarker(window, now);
    // Wed 2026-08-05 is day 3 of 28 → inside the fourth column.
    expect(marker).toBeCloseTo((3.5 / 28) * 100);
    expect(todayMarker({ startDate: '2027-01-01', endDate: '2027-01-07' }, now)).toBeNull();
  });

  it('knows the ends of a week', () => {
    expect(startOfWeek('2026-08-05')).toBe('2026-08-02'); // Sunday
    expect(endOfWeek('2026-08-05')).toBe('2026-08-08'); // Saturday
    expect(startOfWeek('2026-08-02')).toBe('2026-08-02');
    expect(endOfWeek('2026-08-08')).toBe('2026-08-08');
  });
});

describe('formatting', () => {
  it('formats days independently of the viewer’s timezone', () => {
    expect(formatDay('2026-08-05')).toBe('Aug 5');
    expect(formatDay(null)).toBe('');
    expect(formatDay('garbage')).toBe('');
  });
  it('describes a range with its working-day count', () => {
    expect(formatRange('2026-08-03', '2026-08-07')).toBe('Aug 3 – Aug 7 · 5 working days');
    expect(formatRange('2026-08-03', '2026-08-03')).toBe('Aug 3 · 1 working day');
    expect(formatRange('2026-08-01', '2026-08-01')).toBe('Aug 1 · 0 working days');
    expect(formatRange('bad', '2026-08-07')).toBe('');
  });
});

describe('grouping', () => {
  const items = [
    { id: 'c', name: 'Tile', startDate: '2026-08-10', endDate: '2026-08-14', status: 'not_started' as const },
    { id: 'a', name: 'Demo', startDate: '2026-08-03', endDate: '2026-08-05', status: 'complete' as const },
    { id: 'b', name: 'Rough-in', startDate: '2026-08-03', endDate: '2026-08-12', status: 'in_progress' as const },
  ];

  it('groups by start day in date then name order', () => {
    const groups = groupByStartDay(items);
    expect(groups.map((g) => g.day)).toEqual(['2026-08-03', '2026-08-10']);
    expect(groups[0]!.items.map((i) => i.name)).toEqual(['Demo', 'Rough-in']);
  });

  it('answers "who is on this day", excluding finished work', () => {
    // Rough-in spans the 10th; Demo is complete; Tile starts that day.
    expect(itemsOnDay(items, '2026-08-10').map((i) => i.id)).toEqual(['b', 'c']);
    expect(itemsOnDay(items, '2026-08-04').map((i) => i.id)).toEqual(['b']);
    expect(itemsOnDay(items, '2026-09-01')).toEqual([]);
  });
});
