import { describe, it, expect } from 'vitest';
import {
  CALENDAR_EVENTS_ENDPOINT,
  CALENDAR_SCOPE,
  CALENDAR_SOURCE_KINDS,
  EVENT_PROPERTY_KEYS,
  describeSync,
  isAllDay,
  isCalendarSourceKind,
  scheduleItemMirrorState,
  scheduleItemToEvent,
  siteVisitMirrorState,
  siteVisitToEvent,
  syncDecision,
  type ScheduleItemForCalendar,
  type SiteVisitForCalendar,
} from './calendar-core';
import { GOOGLE_SCOPES } from '@/lib/google/google-core';

const APP = 'https://foreman.example.com/';

const visit: SiteVisitForCalendar = {
  id: 'v-1',
  organizationId: 'org-a',
  visitType: 'estimate',
  status: 'scheduled',
  scheduledAt: new Date('2026-09-14T13:30:00.000Z'),
  durationMinutes: 90,
  notes: 'Bring the laser measure.',
  subject: 'Jane Dorsey',
  clientName: 'Jane Dorsey',
  address: { line1: '412 Oak St', city: 'Edgewood', state: 'MD', zip: '21040' },
  assignedToName: 'Pat Thompson',
  leadId: 'lead-1',
  projectId: null,
};

const item: ScheduleItemForCalendar = {
  id: 'i-1',
  organizationId: 'org-a',
  projectId: 'p-1',
  name: 'Framing',
  phase: 'Framing',
  startDate: '2026-09-15',
  endDate: '2026-09-18',
  status: 'in_progress',
  percentComplete: 40,
  notes: null,
  projectNumber: 'PRJ-2026-004',
  projectName: 'Hall bath remodel',
};

describe('constants', () => {
  it('asks for exactly the calendar scope the connection was granted', () => {
    expect(GOOGLE_SCOPES).toContain(CALENDAR_SCOPE);
  });

  it('writes to the primary calendar', () => {
    expect(CALENDAR_EVENTS_ENDPOINT).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    );
  });

  it('knows the two things that get mirrored', () => {
    expect(CALENDAR_SOURCE_KINDS).toEqual(['site_visit', 'schedule_item']);
    expect(isCalendarSourceKind('site_visit')).toBe(true);
    expect(isCalendarSourceKind('invoice')).toBe(false);
  });
});

describe('siteVisitToEvent', () => {
  it('is a timed event in the org timezone, ending after the duration', () => {
    const e = siteVisitToEvent(visit, 'America/New_York', APP);
    expect(e).not.toBeNull();
    expect(isAllDay(e!)).toBe(false);
    expect(e!.start).toEqual({ dateTime: '2026-09-14T13:30:00.000Z', timeZone: 'America/New_York' });
    expect(e!.end).toEqual({ dateTime: '2026-09-14T15:00:00.000Z', timeZone: 'America/New_York' });
  });

  it('reads as "type — client — address" on the calendar', () => {
    const e = siteVisitToEvent(visit, 'America/New_York', APP)!;
    expect(e.summary).toBe('Estimate visit — Jane Dorsey — 412 Oak St, Edgewood, MD 21040');
    expect(e.location).toBe('412 Oak St, Edgewood, MD 21040');
  });

  it('carries status, notes, and a link back to the lead, without a double slash', () => {
    const e = siteVisitToEvent(visit, 'America/New_York', APP)!;
    expect(e.description).toContain('Status: Scheduled');
    expect(e.description).toContain('Assigned to: Pat Thompson');
    expect(e.description).toContain('Bring the laser measure.');
    expect(
      siteVisitToEvent({ ...visit, assignedToName: null }, 'UTC', APP)!.description,
    ).not.toContain('Assigned to');
    expect(e.description).toContain('https://foreman.example.com/leads/lead-1');
    expect(e.description).not.toContain('.com//');
  });

  it('links a project visit to the project and names the project', () => {
    const e = siteVisitToEvent(
      {
        ...visit,
        leadId: null,
        projectId: 'p-9',
        subject: 'PRJ-2026-009 — Kitchen',
        clientName: 'Bob Ray',
      },
      'America/New_York',
      APP,
    )!;
    expect(e.summary).toContain('Bob Ray');
    expect(e.description).toContain('PRJ-2026-009 — Kitchen');
    expect(e.description).toContain('/projects/p-9');
  });

  it('copes with no address and no client', () => {
    const e = siteVisitToEvent(
      { ...visit, address: null, clientName: null, subject: 'Walk-in lead' },
      'UTC',
      APP,
    )!;
    expect(e.summary).toBe('Estimate visit — Walk-in lead');
    expect(e.location).toBeUndefined();
  });

  it('defaults a nonsense duration to an hour', () => {
    const e = siteVisitToEvent({ ...visit, durationMinutes: 0 }, 'UTC', APP)!;
    expect(e.end).toEqual({ dateTime: '2026-09-14T14:30:00.000Z', timeZone: 'UTC' });
  });

  it('accepts an ISO string for the time', () => {
    const e = siteVisitToEvent({ ...visit, scheduledAt: '2026-09-14T13:30:00Z' }, 'UTC', APP)!;
    expect(e.start).toEqual({ dateTime: '2026-09-14T13:30:00.000Z', timeZone: 'UTC' });
  });

  it('has nothing to put on a calendar when the visit has no time', () => {
    expect(siteVisitToEvent({ ...visit, scheduledAt: null }, 'UTC', APP)).toBeNull();
    expect(siteVisitToEvent({ ...visit, scheduledAt: 'not a date' }, 'UTC', APP)).toBeNull();
  });

  it('stamps the event so it can be traced back to the record', () => {
    const e = siteVisitToEvent(visit, 'UTC', APP)!;
    expect(e.extendedProperties.private).toEqual({
      [EVENT_PROPERTY_KEYS.kind]: 'site_visit',
      [EVENT_PROPERTY_KEYS.id]: 'v-1',
      [EVENT_PROPERTY_KEYS.org]: 'org-a',
    });
  });
});

describe('siteVisitMirrorState', () => {
  it('scheduled and completed visits stay on the calendar; cancelled ones come off', () => {
    expect(siteVisitMirrorState({ status: 'scheduled', scheduledAt: new Date() })).toBe('present');
    expect(siteVisitMirrorState({ status: 'completed', scheduledAt: new Date() })).toBe('present');
    expect(siteVisitMirrorState({ status: 'cancelled', scheduledAt: new Date() })).toBe('absent');
  });

  it('an unscheduled visit is absent', () => {
    expect(siteVisitMirrorState({ status: 'scheduled', scheduledAt: null })).toBe('absent');
  });
});

describe('scheduleItemToEvent', () => {
  it('is an all-day event with an exclusive end the day after the last day', () => {
    const e = scheduleItemToEvent(item, APP)!;
    expect(isAllDay(e)).toBe(true);
    expect(e.start).toEqual({ date: '2026-09-15' });
    expect(e.end).toEqual({ date: '2026-09-19' });
  });

  it('a one-day item ends the next day, not the same day', () => {
    const e = scheduleItemToEvent({ ...item, endDate: '2026-09-15' }, APP)!;
    expect(e.end).toEqual({ date: '2026-09-16' });
  });

  it('crosses a month end and a DST change without flinching', () => {
    expect(scheduleItemToEvent({ ...item, startDate: '2026-10-30', endDate: '2026-10-31' }, APP)!.end)
      .toEqual({ date: '2026-11-01' });
    expect(scheduleItemToEvent({ ...item, startDate: '2026-11-01', endDate: '2026-11-01' }, APP)!.end)
      .toEqual({ date: '2026-11-02' });
  });

  it('names the work and the job', () => {
    const e = scheduleItemToEvent(item, APP)!;
    expect(e.summary).toBe('Framing — PRJ-2026-004 — Hall bath remodel');
    expect(e.description).toContain('Status: In progress (40% complete)');
    expect(e.description).toContain('https://foreman.example.com/projects/p-1');
    expect(e.location).toBeUndefined();
  });

  it('does not repeat the phase when it is the name', () => {
    expect(scheduleItemToEvent(item, APP)!.description).not.toContain('Phase:');
    expect(
      scheduleItemToEvent({ ...item, name: 'Rough framing', phase: 'Framing' }, APP)!.description,
    ).toContain('Phase: Framing');
  });

  it('clamps progress into 0–100 and copes with a missing project label', () => {
    const e = scheduleItemToEvent(
      { ...item, percentComplete: 140, projectNumber: null, projectName: null },
      APP,
    )!;
    expect(e.summary).toBe('Framing');
    expect(e.description).toContain('(100% complete)');
  });

  it('refuses unusable dates rather than guessing', () => {
    expect(scheduleItemToEvent({ ...item, startDate: '2026-02-30' }, APP)).toBeNull();
    expect(scheduleItemToEvent({ ...item, startDate: '2026-09-20' }, APP)).toBeNull();
  });

  it('stamps the event with its source', () => {
    expect(scheduleItemToEvent(item, APP)!.extendedProperties.private[EVENT_PROPERTY_KEYS.kind]).toBe(
      'schedule_item',
    );
  });
});

describe('scheduleItemMirrorState', () => {
  it('only a canceled item leaves the calendar', () => {
    expect(scheduleItemMirrorState({ status: 'not_started' })).toBe('present');
    expect(scheduleItemMirrorState({ status: 'in_progress' })).toBe('present');
    expect(scheduleItemMirrorState({ status: 'blocked' })).toBe('present');
    expect(scheduleItemMirrorState({ status: 'complete' })).toBe('present');
    expect(scheduleItemMirrorState({ status: 'canceled' })).toBe('absent');
  });
});

describe('syncDecision', () => {
  it('covers all four cases', () => {
    expect(syncDecision('present', null)).toBe('insert');
    expect(syncDecision('present', 'evt-1')).toBe('update');
    expect(syncDecision('absent', 'evt-1')).toBe('delete');
    expect(syncDecision('absent', null)).toBe('skip');
  });

  it('is idempotent: running it again after an update is still an update', () => {
    expect(syncDecision('present', 'evt-1')).toBe(syncDecision('present', 'evt-1'));
  });
});

describe('describeSync', () => {
  it('reads as a sentence', () => {
    expect(describeSync('site_visit', 'insert', 'done')).toBe(
      'calendar: add site visit on Google Calendar — done',
    );
    expect(describeSync('schedule_item', 'delete', 'failed')).toBe(
      'calendar: remove work item on Google Calendar — failed',
    );
    expect(describeSync('schedule_item', 'skip', 'skipped')).toBe(
      'calendar: leave work item on Google Calendar — nothing to do',
    );
  });
});
