import { and, eq, desc, asc, ilike, or, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { ProjectStatus, ProjectSort, PermitStatus, PaymentState } from './projects-core';
import { OPEN_PROJECT_STATUSES } from './projects-core';

export interface ProjectListParams {
  organizationId: string;
  search?: string;
  status?: ProjectStatus | 'all' | 'open';
  assignedTo?: string;
  sort?: ProjectSort;
  includeArchived?: boolean;
}

export interface ProjectListRow {
  id: string;
  projectNumber: string;
  name: string;
  status: ProjectStatus;
  projectType: string | null;
  clientName: string | null;
  projectManagerName: string | null;
  expectedCompletion: string | null;
  contractValue: string | null;
  createdAt: Date;
}

/** List projects for the active org with search, status/assignee filter, sort. */
export async function listProjects(params: ProjectListParams): Promise<ProjectListRow[]> {
  const db = getDb();
  const P = schema.projects;
  const C = schema.clients;
  const pm = schema.users;

  const filters: SQL[] = [eq(P.organizationId, params.organizationId)];
  if (!params.includeArchived) filters.push(isNull(P.deletedAt));

  if (params.status && params.status !== 'all') {
    if (params.status === 'open') {
      filters.push(sql`${P.status} in ${OPEN_PROJECT_STATUSES}`);
    } else {
      filters.push(eq(P.status, params.status));
    }
  }
  if (params.assignedTo) {
    const a = params.assignedTo;
    filters.push(or(eq(P.projectManagerId, a), eq(P.foremanId, a), eq(P.salespersonId, a)) as SQL);
  }
  if (params.search) {
    const term = `%${params.search}%`;
    const match = or(ilike(P.name, term), ilike(P.projectNumber, term), ilike(C.displayName, term));
    if (match) filters.push(match);
  }

  const orderBy =
    params.sort === 'oldest'
      ? [asc(P.createdAt)]
      : params.sort === 'number'
        ? [asc(P.projectNumber)]
        : params.sort === 'name'
          ? [asc(P.name)]
          : params.sort === 'completion'
            ? [sql`${P.expectedCompletion} asc nulls last`, desc(P.createdAt)]
            : [desc(P.createdAt)];

  const rows = await db
    .select({
      id: P.id,
      projectNumber: P.projectNumber,
      name: P.name,
      status: P.status,
      projectType: P.projectType,
      clientName: C.displayName,
      projectManagerName: pm.fullName,
      expectedCompletion: P.expectedCompletion,
      contractValue: P.contractValue,
      createdAt: P.createdAt,
    })
    .from(P)
    .leftJoin(C, eq(C.id, P.clientId))
    .leftJoin(pm, eq(pm.id, P.projectManagerId))
    .where(and(...filters))
    .orderBy(...orderBy);

  return rows as ProjectListRow[];
}

/** Per-status counts for the filter chips (excludes archived). */
export async function projectStatusCounts(organizationId: string): Promise<Record<string, number>> {
  const db = getDb();
  const P = schema.projects;
  const rows = await db
    .select({ status: P.status, count: sql<number>`count(*)::int` })
    .from(P)
    .where(and(eq(P.organizationId, organizationId), isNull(P.deletedAt)))
    .groupBy(P.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}

/** Full project detail with client, property, and the three headline assignees. */
export async function getProject(organizationId: string, projectId: string) {
  const db = getDb();
  const P = schema.projects;
  const C = schema.clients;
  const pm = schema.users;
  const fm = schema.users;
  const sp = schema.users;

  const [row] = await db
    .select({
      project: P,
      clientName: C.displayName,
      clientPhone: C.primaryPhone,
      clientEmail: C.primaryEmail,
      projectManagerName: pm.fullName,
      foremanName: fm.fullName,
      salespersonName: sp.fullName,
    })
    .from(P)
    .leftJoin(C, eq(C.id, P.clientId))
    .leftJoin(pm, eq(pm.id, P.projectManagerId))
    .leftJoin(fm, eq(fm.id, P.foremanId))
    .leftJoin(sp, eq(sp.id, P.salespersonId))
    .where(and(eq(P.organizationId, organizationId), eq(P.id, projectId)));
  return row ?? null;
}

/** The property attached to a project (address + jobsite details), if any. */
export async function getProjectProperty(organizationId: string, propertyId: string) {
  const db = getDb();
  const P = schema.properties;
  const [row] = await db
    .select()
    .from(P)
    .where(and(eq(P.organizationId, organizationId), eq(P.id, propertyId)));
  return row ?? null;
}

/** Additional team members (beyond PM/foreman/salesperson) with their names. */
export async function getProjectTeam(organizationId: string, projectId: string) {
  const db = getDb();
  const T = schema.projectTeamMembers;
  const U = schema.users;
  return db
    .select({
      id: T.id,
      userId: T.userId,
      name: U.fullName,
      email: U.email,
      roleOnProject: T.roleOnProject,
      assignedAt: T.assignedAt,
    })
    .from(T)
    .leftJoin(U, eq(U.id, T.userId))
    .where(and(eq(T.organizationId, organizationId), eq(T.projectId, projectId)))
    .orderBy(asc(T.assignedAt));
}

/** The project activity timeline, newest first, with actor names. */
export async function getProjectActivities(organizationId: string, projectId: string) {
  const db = getDb();
  const A = schema.projectActivities;
  const U = schema.users;
  return db
    .select({
      id: A.id,
      activityType: A.activityType,
      summary: A.summary,
      metadata: A.metadata,
      occurredAt: A.occurredAt,
      actorName: U.fullName,
    })
    .from(A)
    .leftJoin(U, eq(U.id, A.createdBy))
    .where(and(eq(A.organizationId, organizationId), eq(A.projectId, projectId)))
    .orderBy(desc(A.occurredAt));
}

/** Clients for the project form's client picker (active only). */
export async function clientOptions(organizationId: string) {
  const db = getDb();
  const C = schema.clients;
  return db
    .select({ id: C.id, name: C.displayName })
    .from(C)
    .where(and(eq(C.organizationId, organizationId), isNull(C.deletedAt)))
    .orderBy(asc(C.displayName));
}

/** All properties in the org (id, clientId, address) for the form's picker,
 * which filters client-side as the client selection changes. */
export async function allPropertyOptions(organizationId: string) {
  const db = getDb();
  const P = schema.properties;
  return db
    .select({ id: P.id, clientId: P.clientId, address: P.address })
    .from(P)
    .where(eq(P.organizationId, organizationId))
    .orderBy(desc(P.createdAt));
}

/** Active org members for the assignment pickers. */
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

/** Members not already on the extra-team list (for the add-member picker). */
export async function addableTeamMembers(organizationId: string, projectId: string) {
  const db = getDb();
  const M = schema.organizationMembers;
  const U = schema.users;
  const T = schema.projectTeamMembers;
  return db
    .select({ id: U.id, name: U.fullName, email: U.email })
    .from(M)
    .innerJoin(U, eq(U.id, M.userId))
    .where(
      and(
        eq(M.organizationId, organizationId),
        eq(M.isActive, true),
        sql`not exists (
          select 1 from ${T}
          where ${T.projectId} = ${projectId} and ${T.userId} = ${U.id}
        )`,
      ),
    )
    .orderBy(asc(U.fullName));
}

/** Count of open (non-terminal, non-archived) projects — dashboard signal. */
export async function openProjectCount(organizationId: string): Promise<number> {
  const db = getDb();
  const P = schema.projects;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(P)
    .where(
      and(
        eq(P.organizationId, organizationId),
        isNull(P.deletedAt),
        ne(P.status, 'closed'),
        ne(P.status, 'cancelled'),
      ),
    );
  return row?.count ?? 0;
}

export type { PermitStatus, PaymentState };
