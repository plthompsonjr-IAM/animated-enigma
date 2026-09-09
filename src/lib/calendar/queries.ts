import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type {
  CalendarSourceKind,
  ScheduleItemForCalendar,
  SiteVisitForCalendar,
} from './calendar-core';

/**
 * Everything the calendar needs to describe a site visit, in one round trip:
 * the visit, who it is for, where it is, and the organisation's timezone.
 * Null when the visit is not in this organisation.
 */
export async function siteVisitForCalendar(
  organizationId: string,
  visitId: string,
): Promise<{ visit: SiteVisitForCalendar; timeZone: string } | null> {
  const V = schema.siteVisits;
  const [row] = await getDb()
    .select({
      id: V.id,
      organizationId: V.organizationId,
      visitType: V.visitType,
      status: V.status,
      scheduledAt: V.scheduledAt,
      durationMinutes: V.durationMinutes,
      notes: V.notes,
      leadId: V.leadId,
      projectId: V.projectId,
      leadName: schema.leads.leadName,
      leadClientName: schema.leads.clientName,
      leadAddress: schema.leads.propertyAddress,
      projectNumber: schema.projects.projectNumber,
      projectName: schema.projects.name,
      projectClientName: schema.clients.displayName,
      projectAddress: schema.properties.address,
      assignedToName: schema.users.fullName,
      timeZone: schema.organizations.timezone,
    })
    .from(V)
    .innerJoin(schema.organizations, eq(schema.organizations.id, V.organizationId))
    .leftJoin(schema.users, eq(schema.users.id, V.assignedTo))
    .leftJoin(schema.leads, eq(schema.leads.id, V.leadId))
    .leftJoin(schema.projects, eq(schema.projects.id, V.projectId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .leftJoin(schema.properties, eq(schema.properties.id, schema.projects.propertyId))
    .where(and(eq(V.organizationId, organizationId), eq(V.id, visitId)));
  if (!row) return null;

  const subject = row.projectName
    ? `${row.projectNumber ?? ''} — ${row.projectName}`.trim()
    : (row.leadName ?? null);
  return {
    timeZone: row.timeZone,
    visit: {
      id: row.id,
      organizationId: row.organizationId,
      visitType: row.visitType,
      status: row.status,
      scheduledAt: row.scheduledAt,
      durationMinutes: row.durationMinutes,
      notes: row.notes,
      subject,
      clientName: row.projectId ? row.projectClientName : row.leadClientName,
      address: row.projectId ? row.projectAddress : row.leadAddress,
      assignedToName: row.assignedToName,
      leadId: row.leadId,
      projectId: row.projectId,
    },
  };
}

/** A work item with its project's label. Null when it is not in this organisation. */
export async function scheduleItemForCalendar(
  organizationId: string,
  itemId: string,
): Promise<ScheduleItemForCalendar | null> {
  const S = schema.scheduleItems;
  const [row] = await getDb()
    .select({
      id: S.id,
      organizationId: S.organizationId,
      projectId: S.projectId,
      name: S.name,
      phase: S.phase,
      startDate: S.startDate,
      endDate: S.endDate,
      status: S.status,
      percentComplete: S.percentComplete,
      notes: S.notes,
      projectNumber: schema.projects.projectNumber,
      projectName: schema.projects.name,
    })
    .from(S)
    .leftJoin(schema.projects, eq(schema.projects.id, S.projectId))
    .where(and(eq(S.organizationId, organizationId), eq(S.id, itemId)));
  return row ?? null;
}

// ── Mirror rows ──────────────────────────────────────────────────────────────

/** The event this person's own calendar holds for a record, or null. */
export async function ownMirror(
  organizationId: string,
  userId: string,
  kind: CalendarSourceKind,
  sourceId: string,
): Promise<{ id: string; externalEventId: string } | null> {
  const M = schema.calendarEvents;
  const [row] = await getDb()
    .select({ id: M.id, externalEventId: M.externalEventId })
    .from(M)
    .where(
      and(
        eq(M.organizationId, organizationId),
        eq(M.userId, userId),
        eq(M.sourceKind, kind),
        eq(M.sourceId, sourceId),
      ),
    );
  return row ?? null;
}

/** Record (or refresh) the pairing after Google has accepted the event. */
export async function recordMirror(args: {
  organizationId: string;
  userId: string;
  kind: CalendarSourceKind;
  sourceId: string;
  externalEventId: string;
}): Promise<void> {
  const M = schema.calendarEvents;
  await getDb()
    .insert(M)
    .values({
      organizationId: args.organizationId,
      userId: args.userId,
      sourceKind: args.kind,
      sourceId: args.sourceId,
      provider: 'google',
      externalEventId: args.externalEventId,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [M.sourceKind, M.sourceId, M.userId],
      set: { externalEventId: args.externalEventId, syncedAt: new Date() },
    });
}

/** Forget the pairing once the event is gone (or was never reachable). */
export async function removeMirror(
  organizationId: string,
  userId: string,
  kind: CalendarSourceKind,
  sourceId: string,
): Promise<void> {
  const M = schema.calendarEvents;
  await getDb()
    .delete(M)
    .where(
      and(
        eq(M.organizationId, organizationId),
        eq(M.userId, userId),
        eq(M.sourceKind, kind),
        eq(M.sourceId, sourceId),
      ),
    );
}
