import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { DailyLogContent } from './daily-logs-core';

export interface DailyLogRow extends DailyLogContent {
  id: string;
  projectId: string;
  projectName: string | null;
  projectNumber: string | null;
  logDate: string;
  editableUntil: Date | null;
  createdBy: string | null;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  revisionCount: number;
}

function logSelection() {
  const L = schema.dailyLogs;
  const PR = schema.projects;
  const U = schema.users;
  return {
    id: L.id,
    projectId: L.projectId,
    projectName: PR.name,
    projectNumber: PR.projectNumber,
    logDate: L.logDate,
    crewPresent: L.crewPresent,
    subsPresent: L.subsPresent,
    workCompleted: L.workCompleted,
    materialsDelivered: L.materialsDelivered,
    equipmentUsed: L.equipmentUsed,
    weather: L.weather,
    delays: L.delays,
    problems: L.problems,
    clientConversations: L.clientConversations,
    safetyIncidents: L.safetyIncidents,
    inspectionActivity: L.inspectionActivity,
    workPlannedTomorrow: L.workPlannedTomorrow,
    editableUntil: L.editableUntil,
    createdBy: L.createdBy,
    authorName: U.fullName,
    authorEmail: U.email,
    createdAt: L.createdAt,
    updatedAt: L.updatedAt,
    revisionCount: sql<number>`(
      select count(*)::int from daily_log_revisions r where r.daily_log_id = ${L.id}
    )`,
  };
}

function baseSelect() {
  const L = schema.dailyLogs;
  return getDb()
    .select(logSelection())
    .from(L)
    .leftJoin(schema.projects, eq(schema.projects.id, L.projectId))
    .leftJoin(schema.users, eq(schema.users.id, L.createdBy));
}

function normalize(rows: Record<string, unknown>[]): DailyLogRow[] {
  return rows.map((r) => ({
    id: r.id as string,
    projectId: r.projectId as string,
    projectName: (r.projectName as string | null) ?? null,
    projectNumber: (r.projectNumber as string | null) ?? null,
    logDate: r.logDate as string,
    crewPresent: (r.crewPresent as string | null) ?? null,
    subsPresent: (r.subsPresent as string | null) ?? null,
    workCompleted: (r.workCompleted as string | null) ?? null,
    materialsDelivered: (r.materialsDelivered as string | null) ?? null,
    equipmentUsed: (r.equipmentUsed as string | null) ?? null,
    weather: (r.weather as string | null) ?? null,
    delays: (r.delays as string | null) ?? null,
    problems: (r.problems as string | null) ?? null,
    clientConversations: (r.clientConversations as string | null) ?? null,
    safetyIncidents: (r.safetyIncidents as string | null) ?? null,
    inspectionActivity: (r.inspectionActivity as string | null) ?? null,
    workPlannedTomorrow: (r.workPlannedTomorrow as string | null) ?? null,
    editableUntil: (r.editableUntil as Date | null) ?? null,
    createdBy: (r.createdBy as string | null) ?? null,
    authorName: (r.authorName as string | null) ?? null,
    authorEmail: (r.authorEmail as string | null) ?? null,
    createdAt: r.createdAt as Date,
    updatedAt: r.updatedAt as Date,
    revisionCount: (r.revisionCount as number) ?? 0,
  }));
}

/** A project's logs, newest day first. */
export async function logsForProject(
  organizationId: string,
  projectId: string,
  limit = 60,
): Promise<DailyLogRow[]> {
  const L = schema.dailyLogs;
  const rows = await baseSelect()
    .where(and(eq(L.organizationId, organizationId), eq(L.projectId, projectId)))
    .orderBy(desc(L.logDate))
    .limit(limit);
  return normalize(rows);
}

/** One log, or null. */
export async function getDailyLog(
  organizationId: string,
  logId: string,
): Promise<DailyLogRow | null> {
  const L = schema.dailyLogs;
  const rows = await baseSelect().where(
    and(eq(L.organizationId, organizationId), eq(L.id, logId)),
  );
  return normalize(rows)[0] ?? null;
}

/** A project's log for one specific day, or null — drives "already logged today". */
export async function getLogForDay(
  organizationId: string,
  projectId: string,
  logDate: string,
): Promise<DailyLogRow | null> {
  const L = schema.dailyLogs;
  const rows = await baseSelect().where(
    and(
      eq(L.organizationId, organizationId),
      eq(L.projectId, projectId),
      eq(L.logDate, logDate),
    ),
  );
  return normalize(rows)[0] ?? null;
}

export interface LogListParams {
  organizationId: string;
  projectId?: string;
  /** Only logs on or after this day. */
  from?: string;
  /** Only logs that flag a delay, problem, or safety incident. */
  flaggedOnly?: boolean;
  limit?: number;
}

/** Org-wide log feed for the daily-logs screen. */
export async function listDailyLogs(params: LogListParams): Promise<DailyLogRow[]> {
  const L = schema.dailyLogs;
  const PR = schema.projects;

  const filters = [eq(L.organizationId, params.organizationId), sql`${PR.deletedAt} is null`];
  if (params.projectId) filters.push(eq(L.projectId, params.projectId));
  if (params.from) filters.push(sql`${L.logDate} >= ${params.from}`);
  if (params.flaggedOnly) {
    filters.push(
      sql`(coalesce(${L.delays}, '') <> ''
           or coalesce(${L.problems}, '') <> ''
           or coalesce(${L.safetyIncidents}, '') <> '')`,
    );
  }

  const rows = await baseSelect()
    .where(and(...filters))
    .orderBy(desc(L.logDate), desc(L.createdAt))
    .limit(params.limit ?? 100);
  return normalize(rows);
}

/** The days a project has logs for, so gaps can be worked out. */
export async function loggedDatesForProject(
  organizationId: string,
  projectId: string,
): Promise<string[]> {
  const L = schema.dailyLogs;
  const rows = await getDb()
    .select({ logDate: L.logDate })
    .from(L)
    .where(and(eq(L.organizationId, organizationId), eq(L.projectId, projectId)))
    .orderBy(asc(L.logDate));
  return rows.map((r) => r.logDate);
}

export interface RevisionRow {
  id: string;
  snapshot: unknown;
  editedBy: string | null;
  editorName: string | null;
  createdAt: Date;
}

/** A log's revision history, oldest first so changes read forward in time. */
export async function revisionsForLog(
  organizationId: string,
  logId: string,
): Promise<RevisionRow[]> {
  const R = schema.dailyLogRevisions;
  const U = schema.users;
  const rows = await getDb()
    .select({
      id: R.id,
      snapshot: R.snapshot,
      editedBy: R.editedBy,
      editorName: U.fullName,
      createdAt: R.createdAt,
    })
    .from(R)
    .leftJoin(U, eq(U.id, R.editedBy))
    .where(and(eq(R.organizationId, organizationId), eq(R.dailyLogId, logId)))
    .orderBy(asc(R.createdAt));
  return rows;
}

/** Projects with no log yet today — the nudge on the daily-logs screen. */
export async function projectsMissingTodaysLog(organizationId: string, day: string) {
  const PR = schema.projects;
  return getDb()
    .select({ id: PR.id, name: PR.name, number: PR.projectNumber })
    .from(PR)
    .where(
      and(
        eq(PR.organizationId, organizationId),
        sql`${PR.deletedAt} is null`,
        // Only jobs actually under way owe a log.
        sql`${PR.status} in ('in_progress','punch_list')`,
        sql`not exists (
          select 1 from daily_logs l
          where l.project_id = ${PR.id} and l.log_date = ${day}
        )`,
      ),
    )
    .orderBy(asc(PR.projectNumber));
}
