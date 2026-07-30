import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { Priority, TaskStatus } from './tasks-core';

export interface ChecklistRow {
  id: string;
  label: string;
  isDone: boolean;
  sortOrder: number;
}

export interface TaskRow {
  id: string;
  projectId: string;
  projectName: string | null;
  projectNumber: string | null;
  scheduleItemId: string | null;
  scheduleItemName: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  priority: Priority;
  status: TaskStatus;
  isPunchList: boolean;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: string | null;
  actualHours: string | null;
  completedAt: Date | null;
  sortOrder: number;
  checklist: ChecklistRow[];
}

function taskSelection() {
  const T = schema.projectTasks;
  const PR = schema.projects;
  const U = schema.users;
  const S = schema.scheduleItems;
  return {
    id: T.id,
    projectId: T.projectId,
    projectName: PR.name,
    projectNumber: PR.projectNumber,
    scheduleItemId: T.scheduleItemId,
    scheduleItemName: S.name,
    title: T.title,
    description: T.description,
    assigneeId: T.assigneeId,
    assigneeName: U.fullName,
    assigneeEmail: U.email,
    priority: T.priority,
    status: T.status,
    isPunchList: T.isPunchList,
    startDate: T.startDate,
    dueDate: T.dueDate,
    estimatedHours: T.estimatedHours,
    actualHours: T.actualHours,
    completedAt: T.completedAt,
    sortOrder: T.sortOrder,
  };
}

function normalize(rows: Record<string, unknown>[]): Omit<TaskRow, 'checklist'>[] {
  return rows.map((r) => ({
    id: r.id as string,
    projectId: r.projectId as string,
    projectName: (r.projectName as string | null) ?? null,
    projectNumber: (r.projectNumber as string | null) ?? null,
    scheduleItemId: (r.scheduleItemId as string | null) ?? null,
    scheduleItemName: (r.scheduleItemName as string | null) ?? null,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    assigneeId: (r.assigneeId as string | null) ?? null,
    assigneeName: (r.assigneeName as string | null) ?? null,
    assigneeEmail: (r.assigneeEmail as string | null) ?? null,
    priority: r.priority as Priority,
    status: r.status as TaskStatus,
    isPunchList: Boolean(r.isPunchList),
    startDate: (r.startDate as string | null) ?? null,
    dueDate: (r.dueDate as string | null) ?? null,
    estimatedHours: (r.estimatedHours as string | null) ?? null,
    actualHours: (r.actualHours as string | null) ?? null,
    completedAt: (r.completedAt as Date | null) ?? null,
    sortOrder: (r.sortOrder as number) ?? 0,
  }));
}

/**
 * Attaches checklists in a second query. A join would multiply the task rows by
 * checklist length and make every downstream count operate on duplicates.
 */
async function withChecklists(
  rows: Omit<TaskRow, 'checklist'>[],
  organizationId: string,
): Promise<TaskRow[]> {
  if (rows.length === 0) return [];
  const C = schema.taskChecklistItems;
  const items = await getDb()
    .select({
      id: C.id,
      taskId: C.taskId,
      label: C.label,
      isDone: C.isDone,
      sortOrder: C.sortOrder,
    })
    .from(C)
    .where(
      and(
        eq(C.organizationId, organizationId),
        inArray(
          C.taskId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(C.sortOrder), asc(C.createdAt));

  const byTask = new Map<string, ChecklistRow[]>();
  for (const item of items) {
    const entry = { id: item.id, label: item.label, isDone: item.isDone, sortOrder: item.sortOrder };
    const list = byTask.get(item.taskId);
    if (list) list.push(entry);
    else byTask.set(item.taskId, [entry]);
  }
  return rows.map((r) => ({ ...r, checklist: byTask.get(r.id) ?? [] }));
}

function baseSelect() {
  const T = schema.projectTasks;
  return getDb()
    .select(taskSelection())
    .from(T)
    .leftJoin(schema.projects, eq(schema.projects.id, T.projectId))
    .leftJoin(schema.users, eq(schema.users.id, T.assigneeId))
    .leftJoin(schema.scheduleItems, eq(schema.scheduleItems.id, T.scheduleItemId));
}

/** Every live task on one project, plus checklists. */
export async function tasksForProject(
  organizationId: string,
  projectId: string,
): Promise<TaskRow[]> {
  const T = schema.projectTasks;
  const rows = await baseSelect()
    .where(
      and(
        eq(T.organizationId, organizationId),
        eq(T.projectId, projectId),
        sql`${T.deletedAt} is null`,
      ),
    )
    .orderBy(asc(T.sortOrder), asc(T.createdAt));
  return withChecklists(normalize(rows), organizationId);
}

export interface TaskListParams {
  organizationId: string;
  projectId?: string;
  assigneeId?: string;
  /** 'open' (default) hides completed work; 'all' shows everything. */
  scope?: 'open' | 'all' | 'punch_list';
}

/** Org-wide task list for the /tasks screen. */
export async function listTasks(params: TaskListParams): Promise<TaskRow[]> {
  const T = schema.projectTasks;
  const PR = schema.projects;

  const filters = [
    eq(T.organizationId, params.organizationId),
    sql`${T.deletedAt} is null`,
    sql`${PR.deletedAt} is null`,
  ];
  if (params.projectId) filters.push(eq(T.projectId, params.projectId));
  if (params.assigneeId) filters.push(eq(T.assigneeId, params.assigneeId));
  if (params.scope === 'punch_list') filters.push(eq(T.isPunchList, true));
  if (params.scope !== 'all') filters.push(sql`${T.status} <> 'completed'`);

  const rows = await baseSelect()
    .where(and(...filters))
    .orderBy(asc(T.dueDate), asc(T.sortOrder));
  return withChecklists(normalize(rows), params.organizationId);
}

/** One task with its checklist, or null. */
export async function getTask(organizationId: string, taskId: string): Promise<TaskRow | null> {
  const T = schema.projectTasks;
  const rows = await baseSelect().where(
    and(eq(T.organizationId, organizationId), eq(T.id, taskId), sql`${T.deletedAt} is null`),
  );
  const [task] = await withChecklists(normalize(rows), organizationId);
  return task ?? null;
}

/** Dependency edges for a project, so blocking can be computed at read time. */
export async function dependenciesForProject(organizationId: string, projectId: string) {
  const D = schema.taskDependencies;
  const T = schema.projectTasks;
  const rows = await getDb()
    .select({ taskId: D.taskId, dependsOnTaskId: D.dependsOnTaskId })
    .from(D)
    .innerJoin(T, eq(T.id, D.taskId))
    .where(and(eq(D.organizationId, organizationId), eq(T.projectId, projectId)));
  return rows;
}

/** Every dependency edge in the org — feeds the org-wide task screen. */
export async function allDependencies(organizationId: string) {
  const D = schema.taskDependencies;
  return getDb()
    .select({ taskId: D.taskId, dependsOnTaskId: D.dependsOnTaskId })
    .from(D)
    .where(eq(D.organizationId, organizationId));
}

/** Open-task counts per project — feeds the project list and dashboards. */
export async function openTaskCounts(organizationId: string): Promise<Map<string, number>> {
  const T = schema.projectTasks;
  const rows = await getDb()
    .select({ projectId: T.projectId, count: sql<number>`count(*)::int` })
    .from(T)
    .where(
      and(
        eq(T.organizationId, organizationId),
        sql`${T.deletedAt} is null`,
        sql`${T.status} <> 'completed'`,
      ),
    )
    .groupBy(T.projectId);
  return new Map(rows.map((r) => [r.projectId, r.count]));
}

/** Count of open tasks past their due date — a dashboard signal. */
export async function overdueTaskCount(organizationId: string): Promise<number> {
  const T = schema.projectTasks;
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(T)
    .where(
      and(
        eq(T.organizationId, organizationId),
        sql`${T.deletedAt} is null`,
        sql`${T.status} <> 'completed'`,
        sql`${T.dueDate} < current_date`,
      ),
    );
  return row?.count ?? 0;
}
