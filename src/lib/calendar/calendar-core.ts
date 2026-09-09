/**
 * Calendar mirror (Task 33): the pure parts of putting the schedule on a
 * Google Calendar.
 *
 * Three decisions shape this module.
 *
 * **The app is the source of truth; the calendar is a mirror.** Sync runs one
 * way, after a record is saved, and a calendar failure never blocks the record.
 * Nothing here reads a calendar back. That keeps the failure modes simple: the
 * worst case is a stale event, never a lost site visit.
 *
 * **A mirror belongs to the person who made it.** Each connected account is
 * its own consent; the app never uses one person's token to act for another.
 * So a record you schedule or change lands on *your* calendar, keyed by
 * `(record, you)`. If a teammate later edits the same record, their calendar
 * gets its own copy and yours is not touched — the honest limitation of
 * per-person consent, stated in the deployment notes rather than papered over.
 *
 * **Work items are calendar days, never instants.** A schedule item spanning
 * Tuesday to Friday becomes an all-day event with an *exclusive* end of
 * Saturday, which is how Google represents "through Friday". A site visit is a
 * timed event at a real instant, labelled with the organisation's timezone so
 * it shows at the right hour on a phone in Ohio and on a laptop anywhere.
 *
 * Pure. No I/O.
 */

import { formatAddress } from '@/lib/clients/clients-core';
import { addDays, isDay, SCHEDULE_ITEM_STATUS_LABELS, type ScheduleItemStatus } from '@/lib/schedule/schedule-core';
import { VISIT_STATUS_LABELS, VISIT_TYPE_LABELS, type VisitStatus, type VisitType } from '@/lib/site-visits/site-visits-core';

// ── Constants ────────────────────────────────────────────────────────────────

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events' as const;

/** The signed-in person's primary calendar. Events live at `.../events/{id}`. */
export const CALENDAR_EVENTS_ENDPOINT =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export const CALENDAR_SOURCE_KINDS = ['site_visit', 'schedule_item'] as const;
export type CalendarSourceKind = (typeof CALENDAR_SOURCE_KINDS)[number];

export function isCalendarSourceKind(value: string): value is CalendarSourceKind {
  return (CALENDAR_SOURCE_KINDS as readonly string[]).includes(value);
}

/** Keys the app stamps on every event it creates, so a copy can be traced back. */
export const EVENT_PROPERTY_KEYS = {
  kind: 'tfKind',
  id: 'tfId',
  org: 'tfOrg',
} as const;

// ── Event shape ──────────────────────────────────────────────────────────────

/** A timed instant, in a named zone, the way Google's API takes it. */
export interface TimedPoint {
  dateTime: string;
  timeZone: string;
}

/** A whole day. Google treats the end as exclusive. */
export interface AllDayPoint {
  date: string;
}

/** The subset of a Google Calendar event the app writes. */
export interface CalendarEvent {
  summary: string;
  description: string;
  location?: string;
  start: TimedPoint | AllDayPoint;
  end: TimedPoint | AllDayPoint;
  extendedProperties: { private: Record<string, string> };
}

export function isAllDay(event: CalendarEvent): boolean {
  return 'date' in event.start;
}

// ── Site visits ──────────────────────────────────────────────────────────────

export interface SiteVisitForCalendar {
  id: string;
  organizationId: string;
  visitType: VisitType;
  status: VisitStatus;
  scheduledAt: Date | string | null;
  durationMinutes: number;
  notes: string | null;
  /** Lead name, or "PRJ-… — name" for a project visit. */
  subject: string | null;
  clientName: string | null;
  /** Lead property address or project property address, as stored (jsonb). */
  address: unknown;
  assignedToName: string | null;
  leadId: string | null;
  projectId: string | null;
}

const MIN_MS = 60_000;

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Trailing-slash-safe join of the app origin and a path. */
function link(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * A site visit as a timed event. Null when the visit has no time yet — an
 * unscheduled visit has nothing to put on a calendar.
 */
export function siteVisitToEvent(
  visit: SiteVisitForCalendar,
  timeZone: string,
  appUrl: string,
): CalendarEvent | null {
  const start = toDate(visit.scheduledAt);
  if (!start) return null;
  const minutes = Number.isFinite(visit.durationMinutes) && visit.durationMinutes > 0
    ? Math.round(visit.durationMinutes)
    : 60;
  const end = new Date(start.getTime() + minutes * MIN_MS);

  const where = formatAddress(visit.address);
  const who = visit.clientName ?? visit.subject;
  const summary = [VISIT_TYPE_LABELS[visit.visitType], who, where].filter(Boolean).join(' — ');

  const lines: string[] = [];
  if (visit.subject && visit.subject !== who) lines.push(visit.subject);
  lines.push(`Status: ${VISIT_STATUS_LABELS[visit.status]}`);
  if (visit.assignedToName) lines.push(`Assigned to: ${visit.assignedToName}`);
  if (visit.notes?.trim()) lines.push('', visit.notes.trim());
  const path = visit.projectId
    ? `/projects/${visit.projectId}`
    : visit.leadId
      ? `/leads/${visit.leadId}`
      : '/schedule';
  lines.push('', `Open in Tactical Foreman: ${link(appUrl, path)}`);

  const event: CalendarEvent = {
    summary,
    description: lines.join('\n'),
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    extendedProperties: {
      private: {
        [EVENT_PROPERTY_KEYS.kind]: 'site_visit',
        [EVENT_PROPERTY_KEYS.id]: visit.id,
        [EVENT_PROPERTY_KEYS.org]: visit.organizationId,
      },
    },
  };
  if (where) event.location = where;
  return event;
}

/** A visit belongs on a calendar while it is scheduled or done — not once cancelled. */
export function siteVisitMirrorState(visit: {
  status: VisitStatus;
  scheduledAt: Date | string | null;
}): MirrorState {
  if (visit.status === 'cancelled') return 'absent';
  return toDate(visit.scheduledAt) ? 'present' : 'absent';
}

// ── Schedule items ───────────────────────────────────────────────────────────

export interface ScheduleItemForCalendar {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  phase: string | null;
  startDate: string;
  endDate: string;
  status: ScheduleItemStatus;
  percentComplete: number;
  notes: string | null;
  projectNumber: string | null;
  projectName: string | null;
}

/**
 * A work item as an all-day event spanning its calendar days. Null when the
 * dates are not usable — the database rejects those, so this is belt and
 * braces rather than an expected path.
 */
export function scheduleItemToEvent(
  item: ScheduleItemForCalendar,
  appUrl: string,
): CalendarEvent | null {
  if (!isDay(item.startDate) || !isDay(item.endDate)) return null;
  const endExclusive = addDays(item.endDate, 1);
  if (!endExclusive || item.endDate < item.startDate) return null;

  const project = [item.projectNumber, item.projectName].filter(Boolean).join(' — ');
  const summary = project ? `${item.name} — ${project}` : item.name;

  const lines: string[] = [];
  if (item.phase && item.phase !== item.name) lines.push(`Phase: ${item.phase}`);
  const pct = Math.max(0, Math.min(100, Math.round(item.percentComplete || 0)));
  lines.push(`Status: ${SCHEDULE_ITEM_STATUS_LABELS[item.status]} (${pct}% complete)`);
  if (item.notes?.trim()) lines.push('', item.notes.trim());
  lines.push('', `Open in Tactical Foreman: ${link(appUrl, `/projects/${item.projectId}`)}`);

  return {
    summary,
    description: lines.join('\n'),
    start: { date: item.startDate },
    end: { date: endExclusive },
    extendedProperties: {
      private: {
        [EVENT_PROPERTY_KEYS.kind]: 'schedule_item',
        [EVENT_PROPERTY_KEYS.id]: item.id,
        [EVENT_PROPERTY_KEYS.org]: item.organizationId,
      },
    },
  };
}

/** A work item stays on the calendar until it is canceled; a finished phase is still history. */
export function scheduleItemMirrorState(item: { status: ScheduleItemStatus }): MirrorState {
  return item.status === 'canceled' ? 'absent' : 'present';
}

// ── Sync decision ────────────────────────────────────────────────────────────

/** Whether the record *should* have an event right now. */
export type MirrorState = 'present' | 'absent';

export type SyncAction = 'insert' | 'update' | 'delete' | 'skip';

/**
 * What to do, given what should exist and what the app already put there.
 *
 * `existingEventId` is the event this same person's calendar already holds for
 * this record, or null. The table is truthful about that pairing; the decision
 * is the whole of the idempotency logic, so it lives here where it can be
 * tested four ways.
 */
export function syncDecision(state: MirrorState, existingEventId: string | null): SyncAction {
  if (state === 'present') return existingEventId ? 'update' : 'insert';
  return existingEventId ? 'delete' : 'skip';
}

/** One line for the log, so a failure reads as a sentence. */
export function describeSync(
  kind: CalendarSourceKind,
  action: SyncAction,
  outcome: 'done' | 'skipped' | 'failed',
): string {
  const noun = kind === 'site_visit' ? 'site visit' : 'work item';
  const verb =
    action === 'insert'
      ? 'add'
      : action === 'update'
        ? 'update'
        : action === 'delete'
          ? 'remove'
          : 'leave';
  const state =
    outcome === 'done' ? 'done' : outcome === 'skipped' ? 'nothing to do' : 'failed';
  return `calendar: ${verb} ${noun} on Google Calendar — ${state}`;
}
