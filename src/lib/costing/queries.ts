import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { toNum } from '@/lib/catalog/catalog-core';
import type {
  ExpenseCategory,
  ExpenseLine,
  LabourLine,
  TimeEntryStatus,
} from './costing-core';

export interface TimeEntryRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  taskId: string | null;
  taskTitle: string | null;
  clockIn: Date | null;
  clockOut: Date | null;
  breakMinutes: number;
  hours: string | null;
  status: TimeEntryStatus;
  isManual: boolean;
  notes: string | null;
  /** Only present for someone allowed to see costs. */
  hourlyCostRate: string | null;
}

export interface ExpenseRow {
  id: string;
  projectId: string;
  projectName: string | null;
  projectNumber: string | null;
  category: ExpenseCategory;
  vendor: string | null;
  description: string;
  amount: string;
  expenseDate: string;
  documentId: string | null;
  isBillable: boolean;
  invoicedAt: Date | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: Date;
}

function timeSelection(includeRate: boolean) {
  const T = schema.timeEntries;
  return {
    id: T.id,
    userId: T.userId,
    userName: schema.users.fullName,
    userEmail: schema.users.email,
    projectId: T.projectId,
    projectName: schema.projects.name,
    projectNumber: schema.projects.projectNumber,
    taskId: T.taskId,
    taskTitle: schema.projectTasks.title,
    clockIn: T.clockIn,
    clockOut: T.clockOut,
    breakMinutes: T.breakMinutes,
    hours: T.hours,
    status: T.status,
    isManual: T.isManual,
    notes: T.notes,
    // The rate is what turns hours into money; it is only selected for callers
    // cleared to see cost, so it never reaches a page that shouldn't show it.
    hourlyCostRate: includeRate
      ? sql<string | null>`(
          select m.hourly_cost_rate from organization_members m
          where m.user_id = ${T.userId} and m.organization_id = ${T.organizationId}
        )`
      : sql<string | null>`null`,
  };
}

function timeQuery(organizationId: string, includeRate: boolean) {
  const T = schema.timeEntries;
  return getDb()
    .select(timeSelection(includeRate))
    .from(T)
    .leftJoin(schema.users, eq(schema.users.id, T.userId))
    .leftJoin(schema.projects, eq(schema.projects.id, T.projectId))
    .leftJoin(schema.projectTasks, eq(schema.projectTasks.id, T.taskId))
    .where(eq(T.organizationId, organizationId));
}

function normalizeTime(rows: Record<string, unknown>[]): TimeEntryRow[] {
  return rows.map((r) => ({
    id: r.id as string,
    userId: r.userId as string,
    userName: (r.userName as string | null) ?? null,
    userEmail: (r.userEmail as string | null) ?? null,
    projectId: (r.projectId as string | null) ?? null,
    projectName: (r.projectName as string | null) ?? null,
    projectNumber: (r.projectNumber as string | null) ?? null,
    taskId: (r.taskId as string | null) ?? null,
    taskTitle: (r.taskTitle as string | null) ?? null,
    clockIn: (r.clockIn as Date | null) ?? null,
    clockOut: (r.clockOut as Date | null) ?? null,
    breakMinutes: (r.breakMinutes as number) ?? 0,
    hours: (r.hours as string | null) ?? null,
    status: r.status as TimeEntryStatus,
    isManual: Boolean(r.isManual),
    notes: (r.notes as string | null) ?? null,
    hourlyCostRate: (r.hourlyCostRate as string | null) ?? null,
  }));
}

/** Time logged against one project. */
export async function timeForProject(
  organizationId: string,
  projectId: string,
  includeRate: boolean,
): Promise<TimeEntryRow[]> {
  const T = schema.timeEntries;
  const rows = await timeQuery(organizationId, includeRate)
    .$dynamic()
    .where(and(eq(T.organizationId, organizationId), eq(T.projectId, projectId)))
    .orderBy(desc(T.clockIn));
  return normalizeTime(rows);
}

/** The signed-in person's shift that hasn't been closed, if there is one. */
export async function openShiftFor(
  organizationId: string,
  userId: string,
): Promise<TimeEntryRow | null> {
  const T = schema.timeEntries;
  const rows = await timeQuery(organizationId, false)
    .$dynamic()
    .where(
      and(
        eq(T.organizationId, organizationId),
        eq(T.userId, userId),
        sql`${T.clockOut} is null`,
        sql`${T.status} <> 'rejected'`,
      ),
    )
    .orderBy(desc(T.clockIn))
    .limit(1);
  return normalizeTime(rows)[0] ?? null;
}

/** Time awaiting approval — the payroll queue. */
export async function timeAwaitingApproval(
  organizationId: string,
  includeRate: boolean,
): Promise<TimeEntryRow[]> {
  const T = schema.timeEntries;
  const rows = await timeQuery(organizationId, includeRate)
    .$dynamic()
    .where(and(eq(T.organizationId, organizationId), sql`${T.status} = 'submitted'`))
    .orderBy(desc(T.clockIn));
  return normalizeTime(rows);
}

function expenseSelection() {
  const E = schema.expenses;
  return {
    id: E.id,
    projectId: E.projectId,
    projectName: schema.projects.name,
    projectNumber: schema.projects.projectNumber,
    category: E.category,
    vendor: E.vendor,
    description: E.description,
    amount: E.amount,
    expenseDate: E.expenseDate,
    documentId: E.documentId,
    isBillable: E.isBillable,
    invoicedAt: E.invoicedAt,
    notes: E.notes,
    createdByName: schema.users.fullName,
    createdAt: E.createdAt,
  };
}

/** Expenses on one project, newest first. */
export async function expensesForProject(
  organizationId: string,
  projectId: string,
): Promise<ExpenseRow[]> {
  const E = schema.expenses;
  const rows = await getDb()
    .select(expenseSelection())
    .from(E)
    .leftJoin(schema.projects, eq(schema.projects.id, E.projectId))
    .leftJoin(schema.users, eq(schema.users.id, E.createdBy))
    .where(
      and(
        eq(E.organizationId, organizationId),
        eq(E.projectId, projectId),
        sql`${E.deletedAt} is null`,
      ),
    )
    .orderBy(desc(E.expenseDate), desc(E.createdAt));
  return rows as ExpenseRow[];
}

/**
 * Cost lines for every project in the org, keyed by project. Aggregated in one
 * pass so the financials page doesn't issue a query per job.
 */
export async function costLinesByProject(organizationId: string): Promise<
  Map<string, { labour: LabourLine[]; expenses: ExpenseLine[] }>
> {
  const db = getDb();
  const T = schema.timeEntries;
  const E = schema.expenses;

  const [labourRows, expenseRows] = await Promise.all([
    db
      .select({
        projectId: T.projectId,
        status: T.status,
        hours: sql<string>`coalesce(sum(${T.hours}), 0)`,
        // Hours at one rate collapse into a single line; different rates stay
        // separate so the cost is exact rather than averaged.
        hourlyCostRate: sql<string | null>`(
          select m.hourly_cost_rate from organization_members m
          where m.user_id = ${T.userId} and m.organization_id = ${T.organizationId}
        )`,
      })
      .from(T)
      .where(and(eq(T.organizationId, organizationId), sql`${T.projectId} is not null`))
      .groupBy(T.projectId, T.status, T.userId, T.organizationId),
    db
      .select({ projectId: E.projectId, category: E.category, amount: sql<string>`sum(${E.amount})` })
      .from(E)
      .where(and(eq(E.organizationId, organizationId), sql`${E.deletedAt} is null`))
      .groupBy(E.projectId, E.category),
  ]);

  const byProject = new Map<string, { labour: LabourLine[]; expenses: ExpenseLine[] }>();
  const entry = (projectId: string) => {
    const existing = byProject.get(projectId);
    if (existing) return existing;
    const created = { labour: [] as LabourLine[], expenses: [] as ExpenseLine[] };
    byProject.set(projectId, created);
    return created;
  };

  for (const row of labourRows) {
    if (!row.projectId) continue;
    entry(row.projectId).labour.push({
      hours: toNum(row.hours),
      hourlyCostRate: row.hourlyCostRate,
      status: row.status as TimeEntryStatus,
    });
  }
  for (const row of expenseRows) {
    entry(row.projectId).expenses.push({
      amount: toNum(row.amount),
      category: row.category as ExpenseCategory,
    });
  }
  return byProject;
}

/** How many active members have no cost rate — labour they log won't be costed. */
export async function membersWithoutCostRate(organizationId: string): Promise<number> {
  const M = schema.organizationMembers;
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(M)
    .where(
      and(
        eq(M.organizationId, organizationId),
        eq(M.isActive, true),
        sql`${M.hourlyCostRate} is null`,
      ),
    );
  return row?.count ?? 0;
}
