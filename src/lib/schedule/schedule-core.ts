/**
 * Pure project-scheduling logic (Task 23): work-item lifecycle, calendar-day
 * arithmetic, crew conflict detection, dependency checking, and the geometry
 * behind the timeline bars. No I/O, so all of it is unit-testable.
 *
 * Everything here works in *calendar days* (`YYYY-MM-DD`), not timestamps. A
 * framing crew works Tuesday through Friday, not 09:00 Tuesday to 17:00 Friday,
 * and treating those days as UTC instants is how schedules end up off by one.
 */

export const SCHEDULE_ITEM_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'complete',
  'canceled',
] as const;
export type ScheduleItemStatus = (typeof SCHEDULE_ITEM_STATUSES)[number];

export const SCHEDULE_ITEM_STATUS_LABELS: Record<ScheduleItemStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  complete: 'Complete',
  canceled: 'Canceled',
};

export const SCHEDULE_ITEM_STATUS_STYLES: Record<ScheduleItemStatus, string> = {
  not_started: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  in_progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  blocked: 'bg-red-500/15 text-red-700 dark:text-red-300',
  complete: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  canceled: 'bg-slate-500/10 text-slate-500 dark:text-slate-500',
};

/** Bar fill for the timeline view, keyed by status. */
export const SCHEDULE_BAR_STYLES: Record<ScheduleItemStatus, string> = {
  not_started: 'bg-slate-400/70',
  in_progress: 'bg-primary',
  blocked: 'bg-red-500/80',
  complete: 'bg-emerald-500/80',
  canceled: 'bg-slate-300 dark:bg-slate-700',
};

export function isScheduleItemStatus(value: string): value is ScheduleItemStatus {
  return (SCHEDULE_ITEM_STATUSES as readonly string[]).includes(value);
}

/** A canceled or completed item no longer competes for crew time. */
export function occupiesCrew(status: ScheduleItemStatus): boolean {
  return status !== 'canceled' && status !== 'complete';
}

/**
 * The standard trade sequence for a renovation, offered when building out a
 * schedule. Deliberately generic — a bath and a kitchen run the same order.
 */
export const SCHEDULE_PHASES = [
  'Pre-construction',
  'Demolition',
  'Rough-in',
  'Inspection',
  'Insulation & drywall',
  'Finishes',
  'Fixtures & trim',
  'Punch list',
  'Final walkthrough',
] as const;

// ── Calendar-day arithmetic ──────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed, real `YYYY-MM-DD` (rejects 2026-02-30). */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Days as UTC-noon instants. Noon rather than midnight so that arithmetic can
 * never be pushed across a day boundary by a DST transition.
 */
function instant(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/** `YYYY-MM-DD` for a UTC-noon instant. */
function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today as `YYYY-MM-DD` in the viewer's local calendar. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Shifts a day by whole days. Returns null for an unusable input. */
export function addDays(day: string, delta: number): string | null {
  if (!isDay(day)) return null;
  return toDay(instant(day) + delta * DAY_MS);
}

/** Calendar days from `a` to `b`, signed. Same day is 0. */
export function dayDiff(a: string, b: string): number | null {
  if (!isDay(a) || !isDay(b)) return null;
  return Math.round((instant(b) - instant(a)) / DAY_MS);
}

/** Inclusive duration in calendar days — a one-day item spans 1, not 0. */
export function spanDays(start: string, end: string): number | null {
  const diff = dayDiff(start, end);
  return diff === null ? null : diff + 1;
}

/** Saturday or Sunday. */
export function isWeekend(day: string): boolean {
  if (!isDay(day)) return false;
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Working days in an inclusive range, weekends excluded. Crews don't normally
 * work Saturdays, so this is the honest number for "how long will this take".
 */
export function workingDays(start: string, end: string): number | null {
  const span = spanDays(start, end);
  if (span === null || span <= 0) return span === null ? null : 0;
  let count = 0;
  for (let i = 0; i < span; i++) {
    const day = addDays(start, i);
    if (day && !isWeekend(day)) count++;
  }
  return count;
}

/** Every day in an inclusive range. Capped so a typo can't spin the loop. */
export function daysInRange(start: string, end: string, limit = 400): string[] {
  const span = spanDays(start, end);
  if (span === null || span <= 0) return [];
  const days: string[] = [];
  for (let i = 0; i < Math.min(span, limit); i++) {
    const day = addDays(start, i);
    if (day) days.push(day);
  }
  return days;
}

export interface DayRange {
  startDate: string;
  endDate: string;
}

/** Do two inclusive day ranges share at least one day? */
export function overlaps(a: DayRange, b: DayRange): boolean {
  if (!isDay(a.startDate) || !isDay(a.endDate) || !isDay(b.startDate) || !isDay(b.endDate)) {
    return false;
  }
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** The days two ranges share, as a range — null when they don't touch. */
export function overlapRange(a: DayRange, b: DayRange): DayRange | null {
  if (!overlaps(a, b)) return null;
  return {
    startDate: a.startDate > b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate < b.endDate ? a.endDate : b.endDate,
  };
}

/** The smallest range covering everything given — null if nothing is dated. */
export function boundingRange(ranges: DayRange[]): DayRange | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const r of ranges) {
    if (!isDay(r.startDate) || !isDay(r.endDate)) continue;
    if (start === null || r.startDate < start) start = r.startDate;
    if (end === null || r.endDate > end) end = r.endDate;
  }
  return start && end ? { startDate: start, endDate: end } : null;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ScheduleItemInput {
  name: string;
  phase?: string | null;
  startDate: string;
  endDate: string;
  status?: ScheduleItemStatus;
  percentComplete?: number | string | null;
  notes?: string | null;
}

export const MAX_ITEM_SPAN_DAYS = 365;

/**
 * Everything that must hold before a work item is saved. Returns the first
 * problem in plain language — these surface directly in the form.
 */
export function validateScheduleItem(input: ScheduleItemInput): { error?: string } {
  const name = input.name?.trim() ?? '';
  if (name.length === 0) return { error: 'Give this work item a name.' };
  if (name.length > 200) return { error: 'Keep the name under 200 characters.' };

  if (!isDay(input.startDate)) return { error: 'Pick a valid start date.' };
  if (!isDay(input.endDate)) return { error: 'Pick a valid end date.' };
  if (input.endDate < input.startDate) {
    return { error: 'The end date can’t be before the start date.' };
  }

  const span = spanDays(input.startDate, input.endDate) ?? 0;
  if (span > MAX_ITEM_SPAN_DAYS) {
    return {
      error: `That’s ${span} days — split anything longer than a year into separate items.`,
    };
  }

  const pct = percentValue(input.percentComplete);
  if (pct === null) return { error: 'Percent complete must be a whole number.' };
  if (pct < 0 || pct > 100) return { error: 'Percent complete has to be between 0 and 100.' };

  if (input.status && !isScheduleItemStatus(input.status)) {
    return { error: 'Unrecognised status.' };
  }
  return {};
}

/** Normalises percent-complete input; null means "not a whole number". */
export function percentValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/**
 * The percentage to *show*. A complete item reads 100 and a not-started one
 * reads 0 regardless of what's stored, so the bar never contradicts the badge.
 */
export function displayPercent(status: ScheduleItemStatus, stored: number | string | null): number {
  if (status === 'complete') return 100;
  if (status === 'not_started') return 0;
  const pct = percentValue(stored) ?? 0;
  return Math.min(100, Math.max(0, pct));
}

// ── Crew conflicts ───────────────────────────────────────────────────────────

export interface AssignedItem extends DayRange {
  id: string;
  name: string;
  status: ScheduleItemStatus;
  projectId: string;
  projectName?: string | null;
  userId: string;
  userName?: string | null;
}

export interface CrewConflict {
  userId: string;
  userName: string | null;
  a: AssignedItem;
  b: AssignedItem;
  overlap: DayRange;
  days: number;
  crossProject: boolean;
}

/**
 * Double-bookings: the same person on two live work items that share days.
 * Completed and canceled items are ignored — they aren't competing for anyone's
 * time. Each pair is reported once, oldest-starting item first, so the UI can
 * say "X overlaps Y" without also saying "Y overlaps X".
 */
export function findCrewConflicts(assignments: AssignedItem[]): CrewConflict[] {
  const byUser = new Map<string, AssignedItem[]>();
  for (const a of assignments) {
    if (!occupiesCrew(a.status)) continue;
    if (!isDay(a.startDate) || !isDay(a.endDate)) continue;
    const list = byUser.get(a.userId);
    if (list) list.push(a);
    else byUser.set(a.userId, [a]);
  }

  const conflicts: CrewConflict[] = [];
  for (const [userId, items] of byUser) {
    const sorted = [...items].sort(
      (x, y) => x.startDate.localeCompare(y.startDate) || x.id.localeCompare(y.id),
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        // Sorted by start date: once b starts after a ends, so does everything
        // after it, so there is nothing left to compare against a.
        if (b.startDate > a.endDate) break;
        if (a.id === b.id) continue;
        const overlap = overlapRange(a, b);
        if (!overlap) continue;
        conflicts.push({
          userId,
          userName: a.userName ?? b.userName ?? null,
          a,
          b,
          overlap,
          days: spanDays(overlap.startDate, overlap.endDate) ?? 0,
          crossProject: a.projectId !== b.projectId,
        });
      }
    }
  }
  return conflicts.sort(
    (x, y) =>
      x.overlap.startDate.localeCompare(y.overlap.startDate) || y.days - x.days,
  );
}

/** Conflicts touching one work item, for the warning on its own row. */
export function conflictsForItem(conflicts: CrewConflict[], itemId: string): CrewConflict[] {
  return conflicts.filter((c) => c.a.id === itemId || c.b.id === itemId);
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface DependentItem extends DayRange {
  id: string;
  name: string;
  dependsOnId?: string | null;
}

export interface DependencyProblem {
  item: DependentItem;
  predecessor: DependentItem;
  /** Days the successor starts too early. Always ≥ 1. */
  daysEarly: number;
}

/**
 * Items scheduled to start before the work they depend on is finished. This is
 * advice, not a block — a foreman may deliberately overlap trades — so it
 * surfaces as a warning and never refuses a save.
 */
export function dependencyProblems(items: DependentItem[]): DependencyProblem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const problems: DependencyProblem[] = [];
  for (const item of items) {
    if (!item.dependsOnId) continue;
    const predecessor = byId.get(item.dependsOnId);
    if (!predecessor) continue;
    if (!isDay(item.startDate) || !isDay(predecessor.endDate)) continue;
    if (item.startDate > predecessor.endDate) continue;
    const diff = dayDiff(item.startDate, predecessor.endDate);
    if (diff === null) continue;
    problems.push({ item, predecessor, daysEarly: diff + 1 });
  }
  return problems;
}

/**
 * Would setting `dependsOnId` on `itemId` create a cycle? Walks the existing
 * chain; a cycle already in the data terminates the walk rather than hanging.
 */
export function wouldCycle(
  items: { id: string; dependsOnId?: string | null }[],
  itemId: string,
  dependsOnId: string,
): boolean {
  if (itemId === dependsOnId) return true;
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>([itemId]);
  let cursor: string | null | undefined = dependsOnId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.dependsOnId ?? null;
  }
  return false;
}

// ── Status & health ──────────────────────────────────────────────────────────

export type ItemUrgency = 'overdue' | 'active' | 'starts_today' | 'upcoming' | 'done';

/**
 * How a work item stands relative to `now`. "Overdue" means its end date has
 * passed with work unfinished — the single most useful thing on a jobsite.
 */
export function itemUrgency(
  item: DayRange & { status: ScheduleItemStatus },
  now: Date = new Date(),
): ItemUrgency {
  if (item.status === 'complete' || item.status === 'canceled') return 'done';
  const day = today(now);
  if (!isDay(item.startDate) || !isDay(item.endDate)) return 'upcoming';
  if (item.endDate < day) return 'overdue';
  if (item.startDate === day) return 'starts_today';
  if (item.startDate <= day) return 'active';
  return 'upcoming';
}

export interface ScheduleHealth {
  total: number;
  active: number;
  overdue: number;
  startingThisWeek: number;
  blocked: number;
  complete: number;
  /** 0–100 across everything not canceled; null when there's nothing to weigh. */
  percentComplete: number | null;
}

/**
 * The at-a-glance numbers for a project or the whole company. Progress is
 * weighted by each item's duration, so a three-week phase counts for more than
 * a one-day punch list.
 */
export function scheduleHealth(
  items: (DayRange & { status: ScheduleItemStatus; percentComplete?: number | string | null })[],
  now: Date = new Date(),
): ScheduleHealth {
  const day = today(now);
  const weekOut = addDays(day, 7) ?? day;
  let active = 0;
  let overdue = 0;
  let startingThisWeek = 0;
  let blocked = 0;
  let complete = 0;
  let weight = 0;
  let earned = 0;

  for (const item of items) {
    if (item.status === 'canceled') continue;
    const urgency = itemUrgency(item, now);
    if (urgency === 'overdue') overdue++;
    if (urgency === 'active' || urgency === 'starts_today') active++;
    if (item.startDate > day && item.startDate <= weekOut) startingThisWeek++;
    if (item.status === 'blocked') blocked++;
    if (item.status === 'complete') complete++;

    const span = spanDays(item.startDate, item.endDate) ?? 1;
    weight += span;
    earned += (span * displayPercent(item.status, item.percentComplete ?? null)) / 100;
  }

  return {
    total: items.length,
    active,
    overdue,
    startingThisWeek,
    blocked,
    complete,
    percentComplete: weight > 0 ? Math.round((earned / weight) * 100) : null,
  };
}

// ── Timeline geometry ────────────────────────────────────────────────────────

export interface TimelineBar<T> {
  item: T;
  /** Percentage from the left edge of the window. */
  offset: number;
  /** Percentage of the window's width. */
  width: number;
  /** True when the item extends beyond the window on that side. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Positions items as percentage bars inside a window, so the timeline needs no
 * measuring in the browser and renders correctly on a phone. Items entirely
 * outside the window are dropped; ones that straddle an edge are clipped and
 * flagged so the UI can show an arrow.
 */
export function timelineBars<T extends DayRange>(
  items: T[],
  window: DayRange,
): TimelineBar<T>[] {
  const total = spanDays(window.startDate, window.endDate);
  if (total === null || total <= 0) return [];

  const bars: TimelineBar<T>[] = [];
  for (const item of items) {
    if (!overlaps(item, window)) continue;
    const visible = overlapRange(item, window);
    if (!visible) continue;
    const fromStart = dayDiff(window.startDate, visible.startDate) ?? 0;
    const span = spanDays(visible.startDate, visible.endDate) ?? 1;
    bars.push({
      item,
      offset: (fromStart / total) * 100,
      width: (span / total) * 100,
      clippedStart: item.startDate < window.startDate,
      clippedEnd: item.endDate > window.endDate,
    });
  }
  return bars;
}

/**
 * A window covering everything, padded and snapped to whole weeks (Sunday to
 * Saturday) so the timeline's column headers line up with real weeks.
 *
 * Capped at `maxWeeks`: a single mistyped 2029 date would otherwise stretch the
 * axis over years and squeeze every real bar down to a hairline. Items past the
 * cap are clipped or dropped from the chart — the work-item list below it is the
 * complete view, and the chart prints the window it's showing.
 */
export function timelineWindow(
  ranges: DayRange[],
  now: Date = new Date(),
  minWeeks = 4,
  maxWeeks = 26,
): DayRange {
  const day = today(now);
  const bounds = boundingRange(ranges) ?? { startDate: day, endDate: day };
  // Always include today so "now" has somewhere to sit on the axis.
  const start = startOfWeek(bounds.startDate < day ? bounds.startDate : day);
  let end = endOfWeek(bounds.endDate > day ? bounds.endDate : day);
  const weeks = Math.ceil((spanDays(start, end) ?? 7) / 7);
  if (weeks < minWeeks) end = endOfWeek(addDays(start, minWeeks * 7 - 1) ?? end);
  if (weeks > maxWeeks) end = endOfWeek(addDays(start, maxWeeks * 7 - 1) ?? end);
  return { startDate: start, endDate: end };
}

/** The Sunday of a day's week. */
export function startOfWeek(day: string): string {
  if (!isDay(day)) return day;
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -dow) ?? day;
}

/** The Saturday of a day's week. */
export function endOfWeek(day: string): string {
  if (!isDay(day)) return day;
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, 6 - dow) ?? day;
}

/** The week-starting Sundays spanning a window, for timeline column headers. */
export function weeksInWindow(window: DayRange): string[] {
  if (!isDay(window.startDate) || !isDay(window.endDate)) return [];
  const weeks: string[] = [];
  let cursor = startOfWeek(window.startDate);
  // Bounded: a year of weekly columns is already past useful on any screen.
  for (let i = 0; i < 60 && cursor <= window.endDate; i++) {
    weeks.push(cursor);
    const next = addDays(cursor, 7);
    if (!next) break;
    cursor = next;
  }
  return weeks;
}

/** Where today sits in the window, as a percentage — null if outside it. */
export function todayMarker(window: DayRange, now: Date = new Date()): number | null {
  const day = today(now);
  const total = spanDays(window.startDate, window.endDate);
  if (total === null || total <= 0) return null;
  if (day < window.startDate || day > window.endDate) return null;
  const fromStart = dayDiff(window.startDate, day) ?? 0;
  // Mid-day, so the marker sits inside today's column rather than on its edge.
  return ((fromStart + 0.5) / total) * 100;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "Jul 30" — the compact form used in lists and on bars. */
export function formatDay(day: string | null | undefined): string {
  if (!day || !isDay(day)) return '';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Thu, Jul 30" — used for day headings in the agenda. */
export function formatDayLong(day: string | null | undefined): string {
  if (!day || !isDay(day)) return '';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Jul 30 – Aug 4 · 4 working days", collapsing a single-day range. */
export function formatRange(start: string, end: string): string {
  if (!isDay(start) || !isDay(end)) return '';
  const days = workingDays(start, end) ?? 0;
  const label = `${days} ${days === 1 ? 'working day' : 'working days'}`;
  return start === end
    ? `${formatDay(start)} · ${label}`
    : `${formatDay(start)} – ${formatDay(end)} · ${label}`;
}

/** "3 days late" / "starts in 2 days" — the human read on an item's timing. */
export function describeTiming(
  item: DayRange & { status: ScheduleItemStatus },
  now: Date = new Date(),
): string {
  const urgency = itemUrgency(item, now);
  const day = today(now);
  switch (urgency) {
    case 'done':
      return SCHEDULE_ITEM_STATUS_LABELS[item.status];
    case 'overdue': {
      const late = dayDiff(item.endDate, day) ?? 0;
      return late === 1 ? '1 day past due' : `${late} days past due`;
    }
    case 'starts_today':
      return 'Starts today';
    case 'active': {
      const left = dayDiff(day, item.endDate) ?? 0;
      if (left === 0) return 'Due today';
      return left === 1 ? 'Due tomorrow' : `${left} days left`;
    }
    default: {
      const until = dayDiff(day, item.startDate) ?? 0;
      return until === 1 ? 'Starts tomorrow' : `Starts in ${until} days`;
    }
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Groups items by the day they start, ascending — the agenda view. Items are
 * sorted by start date then name so the order is stable between renders.
 */
export function groupByStartDay<T extends { startDate: string; name: string }>(
  items: T[],
): { day: string; items: T[] }[] {
  const sorted = [...items].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name),
  );
  const groups: { day: string; items: T[] }[] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.day === item.startDate) last.items.push(item);
    else groups.push({ day: item.startDate, items: [item] });
  }
  return groups;
}

/** Items live on a given day, in start order — "who's where today". */
export function itemsOnDay<T extends DayRange & { status: ScheduleItemStatus }>(
  items: T[],
  day: string,
): T[] {
  return items
    .filter((i) => occupiesCrew(i.status) && i.startDate <= day && day <= i.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
