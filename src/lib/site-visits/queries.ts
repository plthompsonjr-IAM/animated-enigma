import { and, eq, desc, asc, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { VisitStatus, VisitType } from './site-visits-core';

export interface VisitRow {
  id: string;
  visitType: VisitType;
  scheduledAt: Date | null;
  durationMinutes: number;
  completedAt: Date | null;
  status: VisitStatus;
  notes: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  leadId: string | null;
  projectId: string | null;
  /** Human subject: lead name, or "PRJ-… — name". */
  subject: string;
  clientName: string | null;
}

const L = () => schema.leads;
const PR = () => schema.projects;

/** Select shape shared by all visit lists — joins lead/project for context. */
function visitSelection() {
  const V = schema.siteVisits;
  const assignee = schema.users;
  return {
    id: V.id,
    visitType: V.visitType,
    scheduledAt: V.scheduledAt,
    durationMinutes: V.durationMinutes,
    completedAt: V.completedAt,
    status: V.status,
    notes: V.notes,
    assignedTo: V.assignedTo,
    assignedToName: assignee.fullName,
    leadId: V.leadId,
    projectId: V.projectId,
    leadName: L().leadName,
    leadClientName: L().clientName,
    projectName: PR().name,
    projectNumber: PR().projectNumber,
  };
}

function toVisitRow(r: Record<string, unknown>): VisitRow {
  const projectName = r.projectName as string | null;
  const projectNumber = r.projectNumber as string | null;
  const leadName = r.leadName as string | null;
  const subject = projectName
    ? `${projectNumber ?? ''} — ${projectName}`.trim()
    : (leadName ?? 'Site visit');
  return {
    id: r.id as string,
    visitType: r.visitType as VisitType,
    scheduledAt: (r.scheduledAt as Date | null) ?? null,
    durationMinutes: (r.durationMinutes as number) ?? 60,
    completedAt: (r.completedAt as Date | null) ?? null,
    status: r.status as VisitStatus,
    notes: (r.notes as string | null) ?? null,
    assignedTo: (r.assignedTo as string | null) ?? null,
    assignedToName: (r.assignedToName as string | null) ?? null,
    leadId: (r.leadId as string | null) ?? null,
    projectId: (r.projectId as string | null) ?? null,
    subject,
    clientName: (r.leadClientName as string | null) ?? null,
  };
}

function baseVisitQuery(organizationId: string) {
  const V = schema.siteVisits;
  return getDb()
    .select(visitSelection())
    .from(V)
    .leftJoin(schema.users, eq(schema.users.id, V.assignedTo))
    .leftJoin(schema.leads, eq(schema.leads.id, V.leadId))
    .leftJoin(schema.projects, eq(schema.projects.id, V.projectId))
    .where(eq(V.organizationId, organizationId));
}

export interface VisitListParams {
  organizationId: string;
  assignedTo?: string;
  status?: VisitStatus | 'all';
  scope?: 'upcoming' | 'past' | 'all';
}

/** Org-wide visit list for the schedule page, with assignee/status/scope filters. */
export async function listVisits(params: VisitListParams): Promise<VisitRow[]> {
  const db = getDb();
  const V = schema.siteVisits;

  const filters: SQL[] = [eq(V.organizationId, params.organizationId)];
  if (params.assignedTo) filters.push(eq(V.assignedTo, params.assignedTo));
  if (params.status && params.status !== 'all') filters.push(eq(V.status, params.status));
  if (params.scope === 'upcoming') {
    filters.push(eq(V.status, 'scheduled'));
    filters.push(sql`${V.scheduledAt} >= date_trunc('day', now())`);
  } else if (params.scope === 'past') {
    filters.push(sql`(${V.status} <> 'scheduled' or ${V.scheduledAt} < date_trunc('day', now()))`);
  }

  const ascending = params.scope !== 'past';
  const rows = await db
    .select(visitSelection())
    .from(V)
    .leftJoin(schema.users, eq(schema.users.id, V.assignedTo))
    .leftJoin(schema.leads, eq(schema.leads.id, V.leadId))
    .leftJoin(schema.projects, eq(schema.projects.id, V.projectId))
    .where(and(...filters))
    .orderBy(ascending ? asc(V.scheduledAt) : desc(V.scheduledAt));

  return rows.map(toVisitRow);
}

/** Visits attached to a lead (newest scheduled first). */
export async function visitsForLead(organizationId: string, leadId: string): Promise<VisitRow[]> {
  const V = schema.siteVisits;
  const rows = await baseVisitQuery(organizationId)
    .$dynamic()
    .where(and(eq(V.organizationId, organizationId), eq(V.leadId, leadId)))
    .orderBy(desc(V.scheduledAt));
  return rows.map(toVisitRow);
}

/** Visits attached to a project (newest scheduled first). */
export async function visitsForProject(
  organizationId: string,
  projectId: string,
): Promise<VisitRow[]> {
  const V = schema.siteVisits;
  const rows = await baseVisitQuery(organizationId)
    .$dynamic()
    .where(and(eq(V.organizationId, organizationId), eq(V.projectId, projectId)))
    .orderBy(desc(V.scheduledAt));
  return rows.map(toVisitRow);
}

/** A single visit with its measurements (for the detail/complete view). */
export async function getVisit(organizationId: string, visitId: string) {
  const db = getDb();
  const V = schema.siteVisits;
  const [row] = await db
    .select()
    .from(V)
    .where(and(eq(V.organizationId, organizationId), eq(V.id, visitId)));
  return row ?? null;
}

/** Count of upcoming scheduled visits — dashboard signal. */
export async function upcomingVisitCount(organizationId: string): Promise<number> {
  const db = getDb();
  const V = schema.siteVisits;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(V)
    .where(
      and(
        eq(V.organizationId, organizationId),
        eq(V.status, 'scheduled'),
        sql`${V.scheduledAt} >= date_trunc('day', now())`,
      ),
    );
  return row?.count ?? 0;
}

/** Active org members eligible for visit assignment. */
export async function assignableMembers(organizationId: string) {
  const db = getDb();
  const M = schema.organizationMembers;
  const U = schema.users;
  return db
    .select({ id: U.id, name: U.fullName, email: U.email })
    .from(M)
    .innerJoin(U, eq(U.id, M.userId))
    .where(and(eq(M.organizationId, organizationId), eq(M.isActive, true)))
    .orderBy(asc(U.fullName));
}
