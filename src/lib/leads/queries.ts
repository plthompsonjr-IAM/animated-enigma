import { and, eq, desc, asc, ilike, or, isNull, isNotNull, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { LeadStatus, LeadSort, Priority } from './leads-core';

export interface LeadListParams {
  organizationId: string;
  search?: string;
  status?: LeadStatus | 'all' | 'open';
  assignedTo?: string;
  sort?: LeadSort;
  includeArchived?: boolean;
}

export interface LeadListRow {
  id: string;
  leadName: string;
  clientName: string | null;
  phone: string | null;
  email: string | null;
  projectType: string | null;
  estimatedBudget: string | null;
  status: LeadStatus;
  priority: Priority;
  nextFollowUpDate: string | null;
  assignedToName: string | null;
  createdAt: Date;
}

const OPEN = [
  'new',
  'contacted',
  'qualified',
  'site_visit_scheduled',
  'estimating',
  'proposal_sent',
] as const;

/** List leads for the active org with search, status filter, assignment, and sort. */
export async function listLeads(params: LeadListParams): Promise<LeadListRow[]> {
  const db = getDb();
  const L = schema.leads;

  const filters: SQL[] = [eq(L.organizationId, params.organizationId)];
  if (!params.includeArchived) filters.push(isNull(L.deletedAt));

  if (params.status && params.status !== 'all') {
    if (params.status === 'open') {
      filters.push(sql`${L.status} in ${OPEN}`);
    } else {
      filters.push(eq(L.status, params.status));
    }
  }
  if (params.assignedTo) filters.push(eq(L.assignedTo, params.assignedTo));

  if (params.search) {
    const term = `%${params.search}%`;
    const match = or(
      ilike(L.leadName, term),
      ilike(L.clientName, term),
      ilike(L.phone, term),
      ilike(L.email, term),
      ilike(L.projectType, term),
    );
    if (match) filters.push(match);
  }

  const orderBy =
    params.sort === 'oldest'
      ? [asc(L.createdAt)]
      : params.sort === 'name'
        ? [asc(L.leadName)]
        : params.sort === 'priority'
          ? [
              sql`case ${L.priority} when 'high' then 0 when 'medium' then 1 else 2 end`,
              desc(L.createdAt),
            ]
          : params.sort === 'follow_up'
            ? [sql`${L.nextFollowUpDate} asc nulls last`, desc(L.createdAt)]
            : [desc(L.createdAt)];

  const assignee = schema.users;
  const rows = await db
    .select({
      id: L.id,
      leadName: L.leadName,
      clientName: L.clientName,
      phone: L.phone,
      email: L.email,
      projectType: L.projectType,
      estimatedBudget: L.estimatedBudget,
      status: L.status,
      priority: L.priority,
      nextFollowUpDate: L.nextFollowUpDate,
      assignedToName: assignee.fullName,
      createdAt: L.createdAt,
    })
    .from(L)
    .leftJoin(assignee, eq(assignee.id, L.assignedTo))
    .where(and(...filters))
    .orderBy(...orderBy);

  return rows as LeadListRow[];
}

/** Per-status open counts for the filter chips. */
export async function leadStatusCounts(organizationId: string): Promise<Record<string, number>> {
  const db = getDb();
  const L = schema.leads;
  const rows = await db
    .select({ status: L.status, count: sql<number>`count(*)::int` })
    .from(L)
    .where(and(eq(L.organizationId, organizationId), isNull(L.deletedAt)))
    .groupBy(L.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}

/** Count of leads whose follow-up is due today or overdue (dashboard signal). */
export async function overdueFollowUpCount(organizationId: string): Promise<number> {
  const db = getDb();
  const L = schema.leads;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(L)
    .where(
      and(
        eq(L.organizationId, organizationId),
        isNull(L.deletedAt),
        isNotNull(L.nextFollowUpDate),
        sql`${L.nextFollowUpDate} <= current_date`,
        sql`${L.status} not in ('won','lost')`,
      ),
    );
  return row?.count ?? 0;
}

/** Full lead detail with assignee name. */
export async function getLead(organizationId: string, leadId: string) {
  const db = getDb();
  const L = schema.leads;
  const assignee = schema.users;
  const [row] = await db
    .select({
      lead: L,
      assignedToName: assignee.fullName,
      assignedToEmail: assignee.email,
    })
    .from(L)
    .leftJoin(assignee, eq(assignee.id, L.assignedTo))
    .where(and(eq(L.organizationId, organizationId), eq(L.id, leadId)));
  return row ?? null;
}

/** The activity timeline for a lead, newest first, with actor names. */
export async function getLeadActivities(organizationId: string, leadId: string) {
  const db = getDb();
  const A = schema.leadActivities;
  const actor = schema.users;
  return db
    .select({
      id: A.id,
      activityType: A.activityType,
      summary: A.summary,
      metadata: A.metadata,
      occurredAt: A.occurredAt,
      actorName: actor.fullName,
    })
    .from(A)
    .leftJoin(actor, eq(actor.id, A.createdBy))
    .where(and(eq(A.organizationId, organizationId), eq(A.leadId, leadId)))
    .orderBy(desc(A.occurredAt));
}

/** Active org members eligible for lead assignment (for the assignee picker). */
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
