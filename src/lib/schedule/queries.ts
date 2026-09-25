import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { ScheduleItemStatus } from './schedule-core';

export interface CrewMember {
  userId: string;
  name: string | null;
  email: string;
}

export interface ScheduleItemRow {
  id: string;
  projectId: string;
  projectName: string | null;
  projectNumber: string | null;
  clientName: string | null;
  name: string;
  phase: string | null;
  startDate: string;
  endDate: string;
  status: ScheduleItemStatus;
  percentComplete: number;
  dependsOnId: string | null;
  notes: string | null;
  sortOrder: number;
  crew: CrewMember[];
}

/**
 * Loads work items with their crew. Assignments come back in a second query and
 * are stitched in — a join would multiply the item rows by crew size and make
 * the date arithmetic downstream operate on duplicates.
 */
async function withCrew(
  rows: Omit<ScheduleItemRow, 'crew'>[],
  organizationId: string,
): Promise<ScheduleItemRow[]> {
  if (rows.length === 0) return [];
  const A = schema.scheduleAssignments;
  const U = schema.users;

  const assignments = await getDb()
    .select({
      scheduleItemId: A.scheduleItemId,
      userId: A.userId,
      name: U.fullName,
      email: U.email,
    })
    .from(A)
    .innerJoin(U, eq(U.id, A.userId))
    .where(
      and(
        eq(A.organizationId, organizationId),
        inArray(
          A.scheduleItemId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(U.fullName));

  const byItem = new Map<string, CrewMember[]>();
  for (const a of assignments) {
    const list = byItem.get(a.scheduleItemId);
    const member = { userId: a.userId, name: a.name, email: a.email };
    if (list) list.push(member);
    else byItem.set(a.scheduleItemId, [member]);
  }
  return rows.map((r) => ({ ...r, crew: byItem.get(r.id) ?? [] }));
}

function itemSelection() {
  const S = schema.scheduleItems;
  const PR = schema.projects;
  const CL = schema.clients;
  return {
    id: S.id,
    projectId: S.projectId,
    projectName: PR.name,
    projectNumber: PR.projectNumber,
    clientName: CL.displayName,
    name: S.name,
    phase: S.phase,
    startDate: S.startDate,
    endDate: S.endDate,
    status: S.status,
    percentComplete: S.percentComplete,
    dependsOnId: S.dependsOnId,
    notes: S.notes,
    sortOrder: S.sortOrder,
  };
}

function normalize(rows: Record<string, unknown>[]): Omit<ScheduleItemRow, 'crew'>[] {
  return rows.map((r) => ({
    id: r.id as string,
    projectId: r.projectId as string,
    projectName: (r.projectName as string | null) ?? null,
    projectNumber: (r.projectNumber as string | null) ?? null,
    clientName: (r.clientName as string | null) ?? null,
    name: r.name as string,
    phase: (r.phase as string | null) ?? null,
    startDate: r.startDate as string,
    endDate: r.endDate as string,
    status: r.status as ScheduleItemStatus,
    percentComplete: (r.percentComplete as number) ?? 0,
    dependsOnId: (r.dependsOnId as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    sortOrder: (r.sortOrder as number) ?? 0,
  }));
}

/** Every work item on one project, in schedule order. */
export async function scheduleForProject(
  organizationId: string,
  projectId: string,
): Promise<ScheduleItemRow[]> {
  const S = schema.scheduleItems;
  const rows = await getDb()
    .select(itemSelection())
    .from(S)
    .leftJoin(schema.projects, eq(schema.projects.id, S.projectId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(and(eq(S.organizationId, organizationId), eq(S.projectId, projectId)))
    .orderBy(asc(S.startDate), asc(S.sortOrder), asc(S.name));
  return withCrew(normalize(rows), organizationId);
}

export interface ScheduleListParams {
  organizationId: string;
  /** Only items overlapping this window. Both ends inclusive. */
  from?: string;
  to?: string;
  projectId?: string;
  /** Only items this person is booked on. */
  userId?: string;
  includeArchived?: boolean;
}

/**
 * Org-wide work items for the schedule screen. Deleted projects are excluded —
 * a soft-deleted project's schedule is not something anyone needs to see.
 */
export async function listScheduleItems(params: ScheduleListParams): Promise<ScheduleItemRow[]> {
  const S = schema.scheduleItems;
  const PR = schema.projects;

  const filters = [eq(S.organizationId, params.organizationId), sql`${PR.deletedAt} is null`];
  if (params.projectId) filters.push(eq(S.projectId, params.projectId));
  // Overlap, not containment: a phase that started last month and runs into the
  // window still belongs on the screen.
  if (params.from) filters.push(sql`${S.endDate} >= ${params.from}`);
  if (params.to) filters.push(sql`${S.startDate} <= ${params.to}`);
  if (params.userId) {
    filters.push(
      sql`exists (
        select 1 from schedule_assignments a
        where a.schedule_item_id = ${S.id} and a.user_id = ${params.userId}
      )`,
    );
  }

  const rows = await getDb()
    .select(itemSelection())
    .from(S)
    .leftJoin(PR, eq(PR.id, S.projectId))
    .leftJoin(schema.clients, eq(schema.clients.id, PR.clientId))
    .where(and(...filters))
    .orderBy(asc(S.startDate), asc(S.sortOrder), asc(S.name));

  return withCrew(normalize(rows), params.organizationId);
}

/** One work item, or null. */
export async function getScheduleItem(
  organizationId: string,
  itemId: string,
): Promise<ScheduleItemRow | null> {
  const S = schema.scheduleItems;
  const rows = await getDb()
    .select(itemSelection())
    .from(S)
    .leftJoin(schema.projects, eq(schema.projects.id, S.projectId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(and(eq(S.organizationId, organizationId), eq(S.id, itemId)));
  const [item] = await withCrew(normalize(rows), organizationId);
  return item ?? null;
}

/**
 * Flattened assignment rows for conflict detection: one row per person per work
 * item, org-wide, so a clash between two different projects is visible.
 */
export async function assignmentsForConflicts(organizationId: string, from?: string) {
  const S = schema.scheduleItems;
  const A = schema.scheduleAssignments;
  const U = schema.users;
  const PR = schema.projects;

  const filters = [
    eq(S.organizationId, organizationId),
    sql`${PR.deletedAt} is null`,
    // Live work only — finished and canceled items don't hold anyone's time.
    sql`${S.status} not in ('complete','canceled')`,
  ];
  if (from) filters.push(sql`${S.endDate} >= ${from}`);

  const rows = await getDb()
    .select({
      id: S.id,
      name: S.name,
      startDate: S.startDate,
      endDate: S.endDate,
      status: S.status,
      projectId: S.projectId,
      projectName: PR.name,
      userId: A.userId,
      userName: U.fullName,
    })
    .from(A)
    .innerJoin(S, eq(S.id, A.scheduleItemId))
    .innerJoin(U, eq(U.id, A.userId))
    .leftJoin(PR, eq(PR.id, S.projectId))
    .where(and(...filters));

  return rows.map((r) => ({
    ...r,
    status: r.status as ScheduleItemStatus,
    startDate: r.startDate as string,
    endDate: r.endDate as string,
  }));
}

/** Projects that can carry a schedule — for the org-wide filter. */
export async function schedulableProjects(organizationId: string) {
  const PR = schema.projects;
  return getDb()
    .select({ id: PR.id, name: PR.name, number: PR.projectNumber })
    .from(PR)
    .where(and(eq(PR.organizationId, organizationId), sql`${PR.deletedAt} is null`))
    .orderBy(asc(PR.projectNumber));
}

/** Count of work items running late — a dashboard signal. */
export async function overdueItemCount(organizationId: string): Promise<number> {
  const S = schema.scheduleItems;
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(S)
    .where(
      and(
        eq(S.organizationId, organizationId),
        sql`${S.status} not in ('complete','canceled')`,
        sql`${S.endDate} < current_date`,
      ),
    );
  return row?.count ?? 0;
}
