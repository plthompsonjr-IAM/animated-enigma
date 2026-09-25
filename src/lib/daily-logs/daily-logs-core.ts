/**
 * Pure daily-log logic (Task 25). A daily log is the contemporaneous record of
 * what happened on a jobsite — the document that decides delay claims and
 * disputes. Its value comes from being written *that day*, so this module is
 * built around a controlled edit window and an honest revision history rather
 * than around free editing.
 *
 * No I/O, so all of it is unit-testable.
 */

import { addDays, dayDiff, daysInRange, isDay, isWeekend, today } from '@/lib/schedule/schedule-core';

/**
 * The log's content fields, defined once so the form, the list preview, the
 * printable copy, and the revision diff all agree on what a log contains and
 * what each field is for.
 */
export const DAILY_LOG_FIELDS = [
  {
    key: 'workCompleted',
    label: 'Work completed',
    prompt: 'What actually got done today.',
    rows: 4,
    /** Fields a log is not really a log without. */
    core: true,
  },
  {
    key: 'crewPresent',
    label: 'Crew on site',
    prompt: 'Who worked, and roughly what hours.',
    rows: 2,
    core: true,
  },
  {
    key: 'subsPresent',
    label: 'Subcontractors on site',
    prompt: 'Which trades were here, and for how long.',
    rows: 2,
    core: false,
  },
  {
    key: 'weather',
    label: 'Weather',
    prompt: 'Conditions, and anything that stopped work.',
    rows: 1,
    core: true,
  },
  {
    key: 'delays',
    label: 'Delays',
    prompt: 'What held things up and for how long. Write it the day it happens.',
    rows: 3,
    core: false,
  },
  {
    key: 'problems',
    label: 'Problems found',
    prompt: 'Conditions discovered, damage, anything unexpected.',
    rows: 3,
    core: false,
  },
  {
    key: 'materialsDelivered',
    label: 'Materials delivered',
    prompt: 'What arrived, from whom, and whether it was right.',
    rows: 2,
    core: false,
  },
  {
    key: 'equipmentUsed',
    label: 'Equipment used',
    prompt: 'Rented or owned equipment on site.',
    rows: 2,
    core: false,
  },
  {
    key: 'clientConversations',
    label: 'Client conversations',
    prompt: 'What was discussed, agreed, or asked for. This is where verbal change requests get caught.',
    rows: 3,
    core: false,
  },
  {
    key: 'inspectionActivity',
    label: 'Inspections',
    prompt: 'Who inspected what, and the outcome.',
    rows: 2,
    core: false,
  },
  {
    key: 'safetyIncidents',
    label: 'Safety',
    prompt: 'Incidents, near-misses, or corrective action. Blank means none.',
    rows: 2,
    core: false,
  },
  {
    key: 'workPlannedTomorrow',
    label: 'Planned for tomorrow',
    prompt: 'What the crew is set up to do next.',
    rows: 2,
    core: false,
  },
] as const;

export type DailyLogField = (typeof DAILY_LOG_FIELDS)[number]['key'];

export const DAILY_LOG_FIELD_KEYS = DAILY_LOG_FIELDS.map((f) => f.key);

/** The fields a log is not really a log without. */
export const CORE_FIELD_KEYS = DAILY_LOG_FIELDS.filter((f) => f.core).map((f) => f.key);

export function isDailyLogField(value: string): value is DailyLogField {
  return (DAILY_LOG_FIELD_KEYS as readonly string[]).includes(value);
}

export function fieldLabel(key: string): string {
  return DAILY_LOG_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** Common conditions, offered as one-tap fills rather than free typing. */
export const WEATHER_PRESETS = [
  'Clear, mild',
  'Overcast',
  'Rain — work continued inside',
  'Rain — outside work stopped',
  'High wind',
  'Snow / ice',
  'Extreme heat',
  'Extreme cold',
] as const;

export type DailyLogContent = Partial<Record<DailyLogField, string | null>>;

// ── The edit window ──────────────────────────────────────────────────────────

/** How long after the log's day it stays editable. */
export const EDIT_WINDOW_DAYS = 1;

/**
 * When a log for `logDate` stops being editable: the end of the following day.
 * Late enough that a foreman who writes it up the next morning isn't fighting
 * the app, short enough that the log stays a contemporaneous record.
 *
 * Returned as a `YYYY-MM-DD` *exclusive* bound — the log is editable up to the
 * start of this day. The database stores the timestamp; keeping the pure
 * function on days avoids pretending to know the org's timezone.
 */
export function editWindowEndsOn(logDate: string): string | null {
  if (!isDay(logDate)) return null;
  return addDays(logDate, EDIT_WINDOW_DAYS + 1);
}

/** Is a log still open for editing, given the stored bound? */
export function isWithinEditWindow(
  editableUntil: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!editableUntil) return false;
  const until = editableUntil instanceof Date ? editableUntil : new Date(editableUntil);
  if (Number.isNaN(until.getTime())) return false;
  return now.getTime() < until.getTime();
}

/** Plain-language state of the edit window, for the UI. */
export function describeEditWindow(
  editableUntil: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!editableUntil) return 'Locked — this log is part of the project record.';
  if (!isWithinEditWindow(editableUntil, now)) {
    return 'Locked — this log is part of the project record. Corrections go in today’s log.';
  }
  const until = editableUntil instanceof Date ? editableUntil : new Date(editableUntil);
  const hours = Math.max(1, Math.round((until.getTime() - now.getTime()) / 3_600_000));
  if (hours <= 24) return `Editable for about ${hours} more ${hours === 1 ? 'hour' : 'hours'}.`;
  const days = Math.round(hours / 24);
  return `Editable for about ${days} more ${days === 1 ? 'day' : 'days'}.`;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface DailyLogInput extends DailyLogContent {
  logDate: string;
}

/**
 * Everything that must hold before a log is saved. The two rules that matter:
 * a log can't be dated in the future (it's a record of work, not a plan), and it
 * can't be empty (an empty log is worse than no log — it looks like a day where
 * nothing happened).
 */
export function validateDailyLog(
  input: DailyLogInput,
  now: Date = new Date(),
): { error?: string } {
  if (!isDay(input.logDate)) return { error: 'Pick a valid date for this log.' };
  if (input.logDate > today(now)) {
    return { error: 'A daily log records work that has happened — it can’t be dated ahead.' };
  }
  // A year back is generous; beyond that it's a typo, not a late entry.
  const age = dayDiff(input.logDate, today(now)) ?? 0;
  if (age > 365) return { error: 'That date is over a year ago — check it.' };

  if (isEmptyLog(input)) {
    return { error: 'Write at least something — what got done, or why nothing did.' };
  }
  for (const key of DAILY_LOG_FIELD_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 5000) {
      return { error: `${fieldLabel(key)} is too long — keep it under 5,000 characters.` };
    }
  }
  return {};
}

/** No content at all in any field. */
export function isEmptyLog(content: DailyLogContent): boolean {
  return DAILY_LOG_FIELD_KEYS.every((key) => (content[key] ?? '').trim().length === 0);
}

export interface LogCompleteness {
  filled: number;
  total: number;
  /** Core fields left blank, so the UI can nudge without nagging. */
  missingCore: string[];
  percent: number;
}

/**
 * How complete a log is. This drives a gentle nudge, never a block — a foreman
 * who writes three lines has still written a log, and refusing it means no log.
 */
export function logCompleteness(content: DailyLogContent): LogCompleteness {
  const filled = DAILY_LOG_FIELD_KEYS.filter(
    (key) => (content[key] ?? '').trim().length > 0,
  ).length;
  const missingCore = CORE_FIELD_KEYS.filter(
    (key) => (content[key] ?? '').trim().length === 0,
  ).map(fieldLabel);
  return {
    filled,
    total: DAILY_LOG_FIELD_KEYS.length,
    missingCore,
    percent: Math.round((filled / DAILY_LOG_FIELD_KEYS.length) * 100),
  };
}

/** A one-line preview for a list, taken from the most important filled field. */
export function summarizeLog(content: DailyLogContent, limit = 140): string {
  for (const key of ['workCompleted', 'delays', 'problems', 'crewPresent'] as const) {
    const value = (content[key] ?? '').trim();
    if (value.length === 0) continue;
    const oneLine = value.replace(/\s+/g, ' ');
    return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine;
  }
  return 'No details recorded.';
}

/** Fields carrying something worth flagging in a list — a delay or an incident. */
export function flaggedFields(content: DailyLogContent): string[] {
  return (['delays', 'problems', 'safetyIncidents'] as const)
    .filter((key) => (content[key] ?? '').trim().length > 0)
    .map(fieldLabel);
}

// ── Coverage ─────────────────────────────────────────────────────────────────

/**
 * Working days in a range with no log. Gaps in the daily record are exactly what
 * sinks a delay claim, so this is surfaced rather than left for someone to
 * notice. Weekends are excluded — no log is expected for a day nobody worked.
 */
export function missingLogDays(
  loggedDates: string[],
  from: string,
  to: string,
  limit = 200,
): string[] {
  const logged = new Set(loggedDates.filter(isDay));
  return daysInRange(from, to, limit).filter((day) => !isWeekend(day) && !logged.has(day));
}

export interface LogCoverage {
  workingDays: number;
  logged: number;
  missing: string[];
  /** 0–100, or null when the window contains no working days. */
  percent: number | null;
}

/**
 * Log coverage over a window — how much of the working record actually exists.
 * `to` is clamped to today: no log is missing for a day that hasn't happened.
 */
export function logCoverage(
  loggedDates: string[],
  from: string,
  to: string,
  now: Date = new Date(),
): LogCoverage {
  const day = today(now);
  const end = to > day ? day : to;
  if (!isDay(from) || !isDay(end) || end < from) {
    return { workingDays: 0, logged: 0, missing: [], percent: null };
  }
  const working = daysInRange(from, end).filter((d) => !isWeekend(d));
  const missing = missingLogDays(loggedDates, from, end);
  const logged = working.length - missing.length;
  return {
    workingDays: working.length,
    logged,
    missing,
    percent: working.length > 0 ? Math.round((logged / working.length) * 100) : null,
  };
}

// ── Revisions ────────────────────────────────────────────────────────────────

export interface FieldChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

/**
 * What a revision changed. Compares two snapshots field by field so the history
 * view can say "delays was added" rather than showing two walls of text.
 */
export function changedFields(before: DailyLogContent, after: DailyLogContent): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of DAILY_LOG_FIELD_KEYS) {
    const wasValue = (before[key] ?? '').trim();
    const isValue = (after[key] ?? '').trim();
    if (wasValue === isValue) continue;
    changes.push({ key, label: fieldLabel(key), before: wasValue, after: isValue });
  }
  return changes;
}

/** "Added delays, changed work completed" — a one-line revision summary. */
export function describeChanges(changes: FieldChange[]): string {
  if (changes.length === 0) return 'No content changed.';
  const parts = changes.slice(0, 4).map((change) => {
    const verb =
      change.before.length === 0 ? 'added' : change.after.length === 0 ? 'cleared' : 'changed';
    return `${verb} ${change.label.toLowerCase()}`;
  });
  const rest = changes.length > 4 ? `, +${changes.length - 4} more` : '';
  // Sentence-case the first entry.
  const joined = parts.join(', ') + rest;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Reads a stored revision snapshot back into content. Snapshots are jsonb
 * written by a database trigger, so this tolerates anything and keeps only the
 * string fields it recognises.
 */
export function contentFromSnapshot(snapshot: unknown): DailyLogContent {
  if (typeof snapshot !== 'object' || snapshot === null) return {};
  const record = snapshot as Record<string, unknown>;
  const content: DailyLogContent = {};
  for (const key of DAILY_LOG_FIELD_KEYS) {
    // Snapshots come from the row, so keys are snake_case.
    const value = record[snakeCase(key)] ?? record[key];
    if (typeof value === 'string') content[key] = value;
  }
  return content;
}

/** `workCompleted` → `work_completed`. */
export function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "Thursday, July 30" — the heading on a log. */
export function formatLogDate(logDate: string | null | undefined): string {
  if (!logDate || !isDay(logDate)) return '';
  return new Date(`${logDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Today" / "Yesterday" / "Thu, Jul 30" — compact, relative where it helps. */
export function formatLogDateShort(
  logDate: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!logDate || !isDay(logDate)) return '';
  const day = today(now);
  if (logDate === day) return 'Today';
  if (logDate === addDays(day, -1)) return 'Yesterday';
  return new Date(`${logDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
