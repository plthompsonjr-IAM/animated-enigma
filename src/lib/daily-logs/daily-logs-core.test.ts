import { describe, it, expect } from 'vitest';
import {
  CORE_FIELD_KEYS,
  DAILY_LOG_FIELDS,
  DAILY_LOG_FIELD_KEYS,
  EDIT_WINDOW_DAYS,
  WEATHER_PRESETS,
  changedFields,
  contentFromSnapshot,
  describeChanges,
  describeEditWindow,
  editWindowEndsOn,
  fieldLabel,
  flaggedFields,
  formatLogDate,
  formatLogDateShort,
  isDailyLogField,
  isEmptyLog,
  isWithinEditWindow,
  logCompleteness,
  logCoverage,
  missingLogDays,
  snakeCase,
  summarizeLog,
  validateDailyLog,
} from './daily-logs-core';

describe('field catalogue', () => {
  it('defines every field once, with a label and a prompt', () => {
    expect(DAILY_LOG_FIELDS.length).toBeGreaterThan(8);
    expect(new Set(DAILY_LOG_FIELD_KEYS).size).toBe(DAILY_LOG_FIELD_KEYS.length);
    for (const field of DAILY_LOG_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(field.prompt.length).toBeGreaterThan(0);
    }
  });
  it('marks the fields a log is not a log without', () => {
    expect(CORE_FIELD_KEYS).toContain('workCompleted');
    expect(CORE_FIELD_KEYS).toContain('crewPresent');
    expect(CORE_FIELD_KEYS).toContain('weather');
    expect(CORE_FIELD_KEYS).not.toContain('equipmentUsed');
  });
  it('guards field names coming off a form', () => {
    expect(isDailyLogField('workCompleted')).toBe(true);
    expect(isDailyLogField('vibes')).toBe(false);
  });
  it('resolves labels, falling back to the raw key', () => {
    expect(fieldLabel('workCompleted')).toBe('Work completed');
    expect(fieldLabel('unknown')).toBe('unknown');
  });
  it('offers weather presets rather than making someone type conditions', () => {
    expect(WEATHER_PRESETS.length).toBeGreaterThan(4);
    expect(WEATHER_PRESETS.some((w) => w.toLowerCase().includes('rain'))).toBe(true);
  });
});

describe('the edit window', () => {
  it('runs to the end of the day after the log’s day', () => {
    expect(EDIT_WINDOW_DAYS).toBe(1);
    // A log for the 5th is editable through the 6th, i.e. up to the start of the 7th.
    expect(editWindowEndsOn('2026-08-05')).toBe('2026-08-07');
    expect(editWindowEndsOn('not-a-day')).toBeNull();
  });

  it('is open before the bound and shut after it', () => {
    const until = new Date('2026-08-07T00:00:00Z');
    expect(isWithinEditWindow(until, new Date('2026-08-06T23:00:00Z'))).toBe(true);
    expect(isWithinEditWindow(until, new Date('2026-08-07T00:00:01Z'))).toBe(false);
    expect(isWithinEditWindow(until.toISOString(), new Date('2026-08-06T12:00:00Z'))).toBe(true);
  });

  it('treats a missing or unusable bound as locked, never as open', () => {
    expect(isWithinEditWindow(null)).toBe(false);
    expect(isWithinEditWindow(undefined)).toBe(false);
    expect(isWithinEditWindow('nonsense')).toBe(false);
  });

  it('says where things stand in plain language', () => {
    const until = new Date('2026-08-07T00:00:00Z');
    expect(describeEditWindow(until, new Date('2026-08-06T20:00:00Z'))).toBe(
      'Editable for about 4 more hours.',
    );
    expect(describeEditWindow(until, new Date('2026-08-06T23:30:00Z'))).toBe(
      'Editable for about 1 more hour.',
    );
    expect(describeEditWindow(until, new Date('2026-08-09T00:00:00Z'))).toContain('Locked');
    expect(describeEditWindow(until, new Date('2026-08-09T00:00:00Z'))).toContain('today’s log');
    expect(describeEditWindow(null)).toContain('Locked');
  });
});

describe('validateDailyLog', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  const good = { logDate: '2026-08-05', workCompleted: 'Framed the wet wall.' };

  it('accepts a log with something in it', () => {
    expect(validateDailyLog(good, now).error).toBeUndefined();
  });

  it('refuses a log dated ahead — it records work, it isn’t a plan', () => {
    expect(validateDailyLog({ ...good, logDate: '2026-08-06' }, now).error).toContain(
      'can’t be dated ahead',
    );
    // Today is fine.
    expect(validateDailyLog({ ...good, logDate: '2026-08-05' }, now).error).toBeUndefined();
  });

  it('refuses an unreal date and one over a year old', () => {
    expect(validateDailyLog({ ...good, logDate: '2026-02-30' }, now).error).toContain('valid date');
    expect(validateDailyLog({ ...good, logDate: '2025-01-01' }, now).error).toContain(
      'over a year ago',
    );
  });

  it('refuses an empty log, which reads worse than no log at all', () => {
    expect(validateDailyLog({ logDate: '2026-08-05' }, now).error).toContain('at least something');
    expect(
      validateDailyLog({ logDate: '2026-08-05', workCompleted: '   ' }, now).error,
    ).toContain('at least something');
  });

  it('accepts a log that only explains why nothing happened', () => {
    expect(
      validateDailyLog({ logDate: '2026-08-05', delays: 'Rained out. No work.' }, now).error,
    ).toBeUndefined();
  });

  it('caps a runaway field', () => {
    expect(
      validateDailyLog({ ...good, problems: 'x'.repeat(5001) }, now).error,
    ).toContain('too long');
  });
});

describe('completeness & preview', () => {
  it('knows an empty log from a filled one', () => {
    expect(isEmptyLog({})).toBe(true);
    expect(isEmptyLog({ weather: '  ' })).toBe(true);
    expect(isEmptyLog({ weather: 'Clear' })).toBe(false);
  });

  it('counts what’s filled and names the missing core fields', () => {
    const completeness = logCompleteness({ workCompleted: 'Framed.', weather: 'Clear' });
    expect(completeness.filled).toBe(2);
    expect(completeness.total).toBe(DAILY_LOG_FIELD_KEYS.length);
    expect(completeness.missingCore).toEqual(['Crew on site']);
    expect(completeness.percent).toBeGreaterThan(0);
  });

  it('has nothing to nudge about when the core fields are in', () => {
    expect(
      logCompleteness({ workCompleted: 'a', crewPresent: 'b', weather: 'c' }).missingCore,
    ).toEqual([]);
  });

  it('previews from the most important filled field, collapsing whitespace', () => {
    expect(summarizeLog({ workCompleted: 'Framed  the\n wet wall.' })).toBe('Framed the wet wall.');
    expect(summarizeLog({ delays: 'Rained out.' })).toBe('Rained out.');
    expect(summarizeLog({ equipmentUsed: 'Lift' })).toBe('No details recorded.');
    expect(summarizeLog({})).toBe('No details recorded.');
    expect(summarizeLog({ workCompleted: 'x'.repeat(200) })).toHaveLength(140);
  });

  it('flags the fields that matter in a dispute', () => {
    expect(flaggedFields({ delays: 'Inspector no-showed.' })).toEqual(['Delays']);
    expect(flaggedFields({ safetyIncidents: 'Near miss.', problems: 'Rot found.' })).toEqual([
      'Problems found',
      'Safety',
    ]);
    expect(flaggedFields({ workCompleted: 'Framed.' })).toEqual([]);
  });
});

describe('coverage', () => {
  const now = new Date('2026-08-14T12:00:00Z'); // Friday

  it('reports working days with no log, ignoring weekends', () => {
    // Mon 2026-08-03 → Fri 2026-08-07 is five working days.
    const missing = missingLogDays(['2026-08-03', '2026-08-05'], '2026-08-03', '2026-08-07');
    expect(missing).toEqual(['2026-08-04', '2026-08-06', '2026-08-07']);
    // The weekend is never missing.
    expect(missingLogDays([], '2026-08-08', '2026-08-09')).toEqual([]);
  });

  it('scores coverage over a window', () => {
    const coverage = logCoverage(
      ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'],
      '2026-08-03',
      '2026-08-07',
      now,
    );
    expect(coverage.workingDays).toBe(5);
    expect(coverage.logged).toBe(5);
    expect(coverage.missing).toEqual([]);
    expect(coverage.percent).toBe(100);
  });

  it('never counts a day that has not happened yet as missing', () => {
    // Window runs a week past today; only up to today can be missing.
    const coverage = logCoverage([], '2026-08-10', '2026-08-21', now);
    expect(coverage.missing.every((d) => d <= '2026-08-14')).toBe(true);
    expect(coverage.workingDays).toBe(5); // Mon 10th → Fri 14th
  });

  it('has no opinion on a window with no working days or a backwards one', () => {
    expect(logCoverage([], '2026-08-08', '2026-08-09', now).percent).toBeNull();
    expect(logCoverage([], '2026-08-07', '2026-08-03', now).percent).toBeNull();
  });
});

describe('revisions', () => {
  it('reports which fields a revision changed', () => {
    const changes = changedFields(
      { workCompleted: 'Framed.', weather: 'Clear' },
      { workCompleted: 'Framed and sheathed.', weather: 'Clear', delays: 'Late delivery.' },
    );
    expect(changes.map((c) => c.key)).toEqual(['workCompleted', 'delays']);
    expect(changes[0]!.before).toBe('Framed.');
    expect(changes[0]!.after).toBe('Framed and sheathed.');
  });

  it('ignores whitespace-only differences', () => {
    expect(changedFields({ weather: 'Clear' }, { weather: '  Clear  ' })).toEqual([]);
  });

  it('describes a revision in one line, naming what happened', () => {
    expect(
      describeChanges(
        changedFields({ workCompleted: 'Framed.' }, { workCompleted: 'Framed.', delays: 'Rain.' }),
      ),
    ).toBe('Added delays');
    expect(
      describeChanges(changedFields({ delays: 'Rain.' }, { delays: '' })),
    ).toBe('Cleared delays');
    expect(
      describeChanges(changedFields({ weather: 'Clear' }, { weather: 'Overcast' })),
    ).toBe('Changed weather');
    expect(describeChanges([])).toBe('No content changed.');
  });

  it('summarises a big revision without listing everything', () => {
    const before = {};
    const after = {
      workCompleted: 'a',
      crewPresent: 'b',
      weather: 'c',
      delays: 'd',
      problems: 'e',
      equipmentUsed: 'f',
    };
    expect(describeChanges(changedFields(before, after))).toContain('+2 more');
  });

  it('reads a trigger-written snake_case snapshot back into content', () => {
    const content = contentFromSnapshot({
      work_completed: 'Framed.',
      crew_present: 'Mike, Dave',
      log_date: '2026-08-05',
      percent_complete: 40,
    });
    expect(content.workCompleted).toBe('Framed.');
    expect(content.crewPresent).toBe('Mike, Dave');
    // Non-content and non-string keys are dropped.
    expect(Object.keys(content)).toEqual(['workCompleted', 'crewPresent']);
  });

  it('tolerates a missing or malformed snapshot', () => {
    expect(contentFromSnapshot(null)).toEqual({});
    expect(contentFromSnapshot('nope')).toEqual({});
    expect(contentFromSnapshot(42)).toEqual({});
  });

  it('converts keys to the column names snapshots use', () => {
    expect(snakeCase('workCompleted')).toBe('work_completed');
    expect(snakeCase('weather')).toBe('weather');
    expect(snakeCase('workPlannedTomorrow')).toBe('work_planned_tomorrow');
  });
});

describe('formatting', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('formats a log date independently of the viewer’s timezone', () => {
    expect(formatLogDate('2026-08-05')).toBe('Wednesday, August 5');
    expect(formatLogDate(null)).toBe('');
    expect(formatLogDate('garbage')).toBe('');
  });

  it('uses relative wording where it actually helps', () => {
    expect(formatLogDateShort('2026-08-05', now)).toBe('Today');
    expect(formatLogDateShort('2026-08-04', now)).toBe('Yesterday');
    expect(formatLogDateShort('2026-08-01', now)).toBe('Sat, Aug 1');
    expect(formatLogDateShort(null, now)).toBe('');
  });
});
