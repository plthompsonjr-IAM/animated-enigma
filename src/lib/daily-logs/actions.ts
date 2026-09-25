'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import {
  DAILY_LOG_FIELD_KEYS,
  validateDailyLog,
  type DailyLogContent,
  type DailyLogField,
} from './daily-logs-core';

/**
 * Writing the daily log is field work — the foreman or lead on site does it, so
 * this is gated on `tasks:write` rather than `projects:write`.
 */
async function requireLogWrite(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const ctx: AuthContext = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'tasks:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to write daily logs.' };
  }
  return { ok: true, orgId: ctx.activeOrg.organizationId, userId: ctx.userId };
}

function revalidateLogs(projectId?: string | null) {
  revalidatePath('/daily-logs');
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

/** Writes today's (or a recent day's) log for a project. */
export async function createDailyLog(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireLogWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return { error: 'Pick a project for this log.' };

  const logDate = String(formData.get('logDate') ?? '');
  const content = readContent(formData);
  const invalid = validateDailyLog({ logDate, ...content });
  if (invalid.error) return { error: invalid.error };

  try {
    const db = getDb();
    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
    if (!project) return { error: 'That project no longer exists.' };

    // editable_until is set by a database trigger, deliberately not by us.
    await db.insert(schema.dailyLogs).values({
      organizationId: orgId,
      projectId,
      logDate,
      ...content,
      createdBy: userId,
    });
  } catch (error) {
    logger.error('daily_logs.create_failed', { error: String(error), projectId, logDate });
    return { error: friendlyDbError(error) };
  }

  revalidateLogs(projectId);
  return { message: 'Log saved.' };
}

/**
 * Edits a log inside its window. The window and the revision snapshot are both
 * enforced by database triggers, so this doesn't have to be trusted to get it
 * right — a locked log rejects the write and the error is surfaced as-is.
 */
export async function updateDailyLog(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireLogWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth;

  const logId = uuidOrNull(formData.get('logId'));
  if (!logId) return { error: 'Could not tell which log to update.' };

  const content = readContent(formData);
  let projectId: string | null = null;

  try {
    const db = getDb();
    const [existing] = await db
      .select({ projectId: schema.dailyLogs.projectId, logDate: schema.dailyLogs.logDate })
      .from(schema.dailyLogs)
      .where(and(eq(schema.dailyLogs.organizationId, orgId), eq(schema.dailyLogs.id, logId)));
    if (!existing) return { error: 'That log no longer exists.' };

    const invalid = validateDailyLog({ logDate: existing.logDate, ...content });
    if (invalid.error) return { error: invalid.error };

    await db
      .update(schema.dailyLogs)
      .set(content)
      .where(and(eq(schema.dailyLogs.organizationId, orgId), eq(schema.dailyLogs.id, logId)));
    projectId = existing.projectId;
  } catch (error) {
    logger.error('daily_logs.update_failed', { error: String(error), logId });
    return { error: friendlyDbError(error) };
  }

  revalidateLogs(projectId);
  return { message: 'Log updated. The previous version is kept in the history.' };
}

/**
 * Deletes a log — only possible inside the edit window, and only for a genuine
 * mistake (wrong project, wrong day). The database refuses once the log is part
 * of the record.
 */
export async function deleteDailyLog(formData: FormData): Promise<void> {
  const auth = await requireLogWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const logId = uuidOrNull(formData.get('logId'));
  if (!logId) return;

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [deleted] = await db
      .delete(schema.dailyLogs)
      .where(and(eq(schema.dailyLogs.organizationId, orgId), eq(schema.dailyLogs.id, logId)))
      .returning({ projectId: schema.dailyLogs.projectId });
    projectId = deleted?.projectId ?? null;
  } catch (error) {
    // A locked log raises restrict_violation; nothing to do but log it.
    logger.error('daily_logs.delete_failed', { error: String(error), logId });
    return;
  }
  revalidateLogs(projectId);
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Reads only the recognised content fields, trimming and nulling the empties. */
function readContent(formData: FormData): DailyLogContent {
  const content: DailyLogContent = {};
  for (const key of DAILY_LOG_FIELD_KEYS) {
    const raw = formData.get(key);
    const value = typeof raw === 'string' ? raw.trim() : '';
    content[key as DailyLogField] = value.length > 0 ? value : null;
  }
  return content;
}

/**
 * Turns a trigger or constraint message into something readable. The locked-log
 * message is the one that matters — it tells the foreman what to do instead.
 */
function friendlyDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('is locked')) {
    return 'This log is locked. Record the correction in a later log — the record isn’t rewritten.';
  }
  if (message.includes('cannot be deleted')) {
    return 'This log is part of the project record and can’t be deleted.';
  }
  if (message.includes('daily_logs_not_future')) {
    return 'A daily log records work that has happened — it can’t be dated ahead.';
  }
  if (message.includes('daily_logs_project_date_idx')) {
    return 'There’s already a log for that day on this project. Edit that one instead.';
  }
  return 'Something went wrong saving the log. Please try again.';
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
