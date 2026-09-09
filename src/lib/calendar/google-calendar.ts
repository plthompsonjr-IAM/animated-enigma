/**
 * Google Calendar as the calendar provider (Task 33).
 *
 * Plain module, deliberately not `'use server'`: nothing here checks a
 * permission, so nothing here may be reachable from a browser. The actions
 * that call it have already verified the caller may change the schedule.
 *
 * Everything is best-effort. Every function returns an outcome and never
 * throws, because a calendar that is down must never stop a site visit from
 * being scheduled. The record is the source of truth; this is its mirror.
 */

import { publicEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { accessTokenFor } from '@/lib/google/tokens';
import { hasScope } from '@/lib/google/google-core';
import {
  CALENDAR_EVENTS_ENDPOINT,
  CALENDAR_SCOPE,
  describeSync,
  scheduleItemMirrorState,
  scheduleItemToEvent,
  siteVisitMirrorState,
  siteVisitToEvent,
  syncDecision,
  type CalendarEvent,
  type CalendarSourceKind,
  type MirrorState,
  type SyncAction,
} from './calendar-core';
import {
  ownMirror,
  recordMirror,
  removeMirror,
  scheduleItemForCalendar,
  siteVisitForCalendar,
} from './queries';

export type SyncOutcome =
  | { ok: true; action: SyncAction }
  | { ok: false; action: SyncAction; reason: string };

interface SyncTarget {
  organizationId: string;
  userId: string;
  kind: CalendarSourceKind;
  sourceId: string;
}

// ── Public entry points ──────────────────────────────────────────────────────

/** Mirror a site visit to the acting person's calendar, whatever its state. */
export async function mirrorSiteVisit(
  organizationId: string,
  userId: string,
  visitId: string,
): Promise<SyncOutcome> {
  const target: SyncTarget = { organizationId, userId, kind: 'site_visit', sourceId: visitId };
  try {
    const found = await siteVisitForCalendar(organizationId, visitId);
    if (!found) return sync(target, 'absent', null);
    const state = siteVisitMirrorState(found.visit);
    const event =
      state === 'present'
        ? siteVisitToEvent(found.visit, found.timeZone, publicEnv.appUrl)
        : null;
    return sync(target, event ? state : 'absent', event);
  } catch (error) {
    return failed(target, 'skip', error);
  }
}

/**
 * Mirror a work item. Also the right call after a hard delete: the row is gone,
 * the lookup finds nothing, and the mirror comes off the calendar.
 */
export async function mirrorScheduleItem(
  organizationId: string,
  userId: string,
  itemId: string,
): Promise<SyncOutcome> {
  const target: SyncTarget = { organizationId, userId, kind: 'schedule_item', sourceId: itemId };
  try {
    const item = await scheduleItemForCalendar(organizationId, itemId);
    if (!item) return sync(target, 'absent', null);
    const state = scheduleItemMirrorState(item);
    const event = state === 'present' ? scheduleItemToEvent(item, publicEnv.appUrl) : null;
    return sync(target, event ? state : 'absent', event);
  } catch (error) {
    return failed(target, 'skip', error);
  }
}

// ── The sync itself ──────────────────────────────────────────────────────────

async function sync(
  target: SyncTarget,
  state: MirrorState,
  event: CalendarEvent | null,
): Promise<SyncOutcome> {
  const existing = await ownMirror(
    target.organizationId,
    target.userId,
    target.kind,
    target.sourceId,
  );
  const action = syncDecision(state, existing?.externalEventId ?? null);
  if (action === 'skip') return { ok: true, action };

  const grant = await accessTokenFor(target.organizationId, target.userId);
  if (!grant || !hasScope(grant.scopes, CALENDAR_SCOPE)) {
    // No usable calendar. A stale pairing for a record that should be gone is
    // forgotten so it cannot mislead later; nothing else can be done.
    if (action === 'delete') {
      await removeMirror(target.organizationId, target.userId, target.kind, target.sourceId);
    }
    logger.info(describeSync(target.kind, action, 'skipped'), {
      ...target,
      reason: grant ? 'calendar scope not granted' : 'no Google connection',
    });
    return { ok: true, action: 'skip' };
  }

  try {
    if (action === 'insert' && event) {
      const id = await insertEvent(grant.accessToken, event);
      await recordMirror({ ...target, externalEventId: id });
    } else if (action === 'update' && event && existing) {
      const id = await updateEvent(grant.accessToken, existing.externalEventId, event);
      if (id !== existing.externalEventId) await recordMirror({ ...target, externalEventId: id });
    } else if (action === 'delete' && existing) {
      await deleteEvent(grant.accessToken, existing.externalEventId);
      await removeMirror(target.organizationId, target.userId, target.kind, target.sourceId);
    }
  } catch (error) {
    return failed(target, action, error);
  }

  logger.info(describeSync(target.kind, action, 'done'), { ...target });
  return { ok: true, action };
}

function failed(target: SyncTarget, action: SyncAction, error: unknown): SyncOutcome {
  const reason = error instanceof Error ? error.message : String(error);
  logger.warn(describeSync(target.kind, action, 'failed'), { ...target, reason });
  return { ok: false, action, reason };
}

// ── Google Calendar API ──────────────────────────────────────────────────────

class CalendarApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Google Calendar responded ${status}${detail ? `: ${detail}` : ''}`);
  }
}

async function call(
  accessToken: string,
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: CalendarEvent,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function errorDetail(response: Response): Promise<string> {
  const json = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return json?.error?.message ?? '';
}

async function insertEvent(accessToken: string, event: CalendarEvent): Promise<string> {
  const response = await call(accessToken, 'POST', CALENDAR_EVENTS_ENDPOINT, event);
  if (!response.ok) throw new CalendarApiError(response.status, await errorDetail(response));
  const json = (await response.json()) as { id?: string };
  if (!json.id) throw new Error('Google Calendar returned no event id');
  return json.id;
}

/**
 * Replace the event. If the person deleted it from their calendar by hand,
 * Google answers 404 (or 410 for a purged one); the honest response is to put
 * it back, since the record still exists — and to return the new id.
 */
async function updateEvent(
  accessToken: string,
  eventId: string,
  event: CalendarEvent,
): Promise<string> {
  const url = `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`;
  const response = await call(accessToken, 'PUT', url, event);
  if (response.status === 404 || response.status === 410) {
    return insertEvent(accessToken, event);
  }
  if (!response.ok) throw new CalendarApiError(response.status, await errorDetail(response));
  const json = (await response.json()) as { id?: string };
  return json.id ?? eventId;
}

/** Remove the event. Already gone counts as done. */
async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  const url = `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`;
  const response = await call(accessToken, 'DELETE', url);
  if (response.ok || response.status === 404 || response.status === 410) return;
  throw new CalendarApiError(response.status, await errorDetail(response));
}
