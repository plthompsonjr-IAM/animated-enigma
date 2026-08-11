'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan, can } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import {
  guessExpenseCategory,
  isExpenseCategory,
  isTimeEntryStatus,
  parseAmount,
  validateExpense,
  validateTimeEntry,
  type ExpenseCategory,
} from './costing-core';

/**
 * Logging your own time is field work, so it rides on `tasks:write` — the same
 * permission technicians already hold to update the work they're doing.
 */
async function requireTimeWrite(): Promise<
  { ok: true; ctx: AuthContext; orgId: string; userId: string } | { ok: false; error: string }
> {
  const ctx: AuthContext = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'tasks:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to log time.' };
  }
  return { ok: true, ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId };
}

/** Recording spend against a job is a cost decision, so it needs `costs:write`. */
async function requireCostWrite(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const ctx: AuthContext = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'costs:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to record job costs.' };
  }
  return { ok: true, orgId: ctx.activeOrg.organizationId, userId: ctx.userId };
}

function revalidateCosting(projectId?: string | null) {
  revalidatePath('/financials');
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

/** Starts a shift on a job. */
export async function clockIn(formData: FormData): Promise<void> {
  const auth = await requireTimeWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  const taskId = uuidOrNull(formData.get('taskId'));
  if (!projectId) return;

  try {
    // The database's exclusion constraint is the real guard against a second
    // open shift; this just turns it into a no-op rather than an error page.
    await getDb()
      .insert(schema.timeEntries)
      .values({
        organizationId: orgId,
        userId,
        projectId,
        taskId,
        clockIn: new Date(),
        status: 'open',
      });
  } catch (error) {
    logger.error('costing.clock_in_failed', { error: String(error), projectId });
    return;
  }
  revalidateCosting(projectId);
}

/** Closes the caller's open shift. */
export async function clockOut(formData: FormData): Promise<void> {
  const auth = await requireTimeWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth;

  const entryId = uuidOrNull(formData.get('entryId'));
  const breakMinutes = Math.max(0, Math.round(Number(formData.get('breakMinutes') ?? 0)) || 0);
  if (!entryId) return;

  let projectId: string | null = null;
  try {
    const [updated] = await getDb()
      .update(schema.timeEntries)
      .set({ clockOut: new Date(), breakMinutes, status: 'submitted' })
      .where(
        and(
          eq(schema.timeEntries.organizationId, orgId),
          eq(schema.timeEntries.id, entryId),
          // Only ever your own shift, whatever the form says.
          eq(schema.timeEntries.userId, userId),
          sql`${schema.timeEntries.clockOut} is null`,
        ),
      )
      .returning({ projectId: schema.timeEntries.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('costing.clock_out_failed', { error: String(error), entryId });
    return;
  }
  revalidateCosting(projectId);
}

/**
 * Records a shift after the fact. Common and legitimate — a phone dies, or
 * someone forgets — so it's supported, but flagged `is_manual` so approval can
 * treat it differently from a clocked one.
 */
export async function logTimeManually(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireTimeWrite();
  if (!auth.ok) return { error: auth.error };
  const { ctx, orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return { error: 'Pick a project for this time.' };

  const clockIn = String(formData.get('clockIn') ?? '');
  const clockOut = String(formData.get('clockOut') ?? '');
  const breakMinutes = Number(formData.get('breakMinutes') ?? 0) || 0;

  const invalid = validateTimeEntry({ clockIn, clockOut, breakMinutes });
  if (invalid.error) return { error: invalid.error };

  // Logging time for somebody else is a supervisor action; the RLS policy
  // enforces it too, but a readable message beats a permission error.
  const requestedUser = uuidOrNull(formData.get('userId'));
  const maySupervise =
    ctx.activeOrg !== null &&
    can(ctx.activeOrg.roles, 'costs:write', ctx.activeOrg.extraPermissions);
  const targetUser = requestedUser && maySupervise ? requestedUser : userId;

  try {
    await getDb()
      .insert(schema.timeEntries)
      .values({
        organizationId: orgId,
        userId: targetUser,
        projectId,
        taskId: uuidOrNull(formData.get('taskId')),
        clockIn: new Date(clockIn),
        clockOut: new Date(clockOut),
        breakMinutes: Math.max(0, Math.round(breakMinutes)),
        isManual: true,
        status: 'submitted',
        notes: nullableText(formData.get('notes')),
      });
  } catch (error) {
    logger.error('costing.log_time_failed', { error: String(error), projectId });
    return { error: friendlyDbError(error) };
  }

  revalidateCosting(projectId);
  return { message: 'Time recorded.' };
}

/** Approves or rejects submitted time. */
export async function setTimeEntryStatus(formData: FormData): Promise<void> {
  const auth = await requireCostWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth;

  const entryId = uuidOrNull(formData.get('entryId'));
  const status = formData.get('status');
  if (!entryId || typeof status !== 'string' || !isTimeEntryStatus(status)) return;

  let projectId: string | null = null;
  try {
    const [updated] = await getDb()
      .update(schema.timeEntries)
      .set({ status, approvedBy: status === 'approved' ? userId : null })
      .where(
        and(eq(schema.timeEntries.organizationId, orgId), eq(schema.timeEntries.id, entryId)),
      )
      .returning({ projectId: schema.timeEntries.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('costing.set_time_status_failed', { error: String(error), entryId });
    return;
  }
  revalidateCosting(projectId);
}

/** Deletes a time entry. Hard delete: an unapproved mistake is just noise. */
export async function deleteTimeEntry(formData: FormData): Promise<void> {
  const auth = await requireTimeWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth;

  const entryId = uuidOrNull(formData.get('entryId'));
  if (!entryId) return;

  let projectId: string | null = null;
  try {
    const [deleted] = await getDb()
      .delete(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.organizationId, orgId),
          eq(schema.timeEntries.id, entryId),
          eq(schema.timeEntries.userId, userId),
          // Approved time has been counted and possibly paid; it doesn't just
          // vanish. Rejecting it is the way to take it out of a job's cost.
          sql`${schema.timeEntries.status} <> 'approved'`,
        ),
      )
      .returning({ projectId: schema.timeEntries.projectId });
    projectId = deleted?.projectId ?? null;
  } catch (error) {
    logger.error('costing.delete_time_failed', { error: String(error), entryId });
    return;
  }
  revalidateCosting(projectId);
}

/** Records money spent on a job. */
export async function recordExpense(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireCostWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return { error: 'Pick a project for this expense.' };

  const description = String(formData.get('description') ?? '');
  const vendor = nullableText(formData.get('vendor'));
  const rawAmount = String(formData.get('amount') ?? '');
  const expenseDate = String(formData.get('expenseDate') ?? '');

  const invalid = validateExpense({ description, amount: rawAmount, expenseDate });
  if (invalid.error) return { error: invalid.error };

  const amount = parseAmount(rawAmount);
  if (amount === null) return { error: 'The amount has to be a number.' };

  const categoryRaw = String(formData.get('category') ?? '');
  const category: ExpenseCategory = isExpenseCategory(categoryRaw)
    ? categoryRaw
    : guessExpenseCategory(`${vendor ?? ''} ${description}`);

  try {
    const db = getDb();
    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
    if (!project) return { error: 'That project no longer exists.' };

    await db.insert(schema.expenses).values({
      organizationId: orgId,
      projectId,
      taskId: uuidOrNull(formData.get('taskId')),
      category,
      vendor,
      description: description.trim(),
      amount: String(amount),
      expenseDate,
      documentId: uuidOrNull(formData.get('documentId')),
      isBillable: formData.get('isBillable') === 'on',
      notes: nullableText(formData.get('notes')),
      createdBy: userId,
    });
  } catch (error) {
    logger.error('costing.record_expense_failed', { error: String(error), projectId });
    return { error: friendlyDbError(error) };
  }

  revalidateCosting(projectId);
  return { message: 'Expense recorded.' };
}

/** Soft-deletes an expense — a cost record is worth being able to look back at. */
export async function deleteExpense(formData: FormData): Promise<void> {
  const auth = await requireCostWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const expenseId = uuidOrNull(formData.get('expenseId'));
  if (!expenseId) return;

  let projectId: string | null = null;
  try {
    const [deleted] = await getDb()
      .update(schema.expenses)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.expenses.organizationId, orgId), eq(schema.expenses.id, expenseId)))
      .returning({ projectId: schema.expenses.projectId });
    projectId = deleted?.projectId ?? null;
  } catch (error) {
    logger.error('costing.delete_expense_failed', { error: String(error), expenseId });
    return;
  }
  revalidateCosting(projectId);
}

/**
 * Sets what an hour of someone's time costs the business. Owner-level: this
 * number silently drives every margin in the system.
 */
export async function setMemberCostRate(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'org:manage', ctx.activeOrg.extraPermissions);
  } catch {
    return { error: 'Only an owner or administrator can set cost rates.' };
  }

  const memberId = uuidOrNull(formData.get('memberId'));
  if (!memberId) return { error: 'Could not tell which team member.' };

  const raw = String(formData.get('hourlyCostRate') ?? '').trim();
  // Blank clears the rate, which means their labour stops being costed — better
  // than leaving a stale number quietly inflating or deflating every job.
  const rate = raw.length === 0 ? null : parseAmount(raw);
  if (raw.length > 0 && rate === null) return { error: 'The rate has to be a number.' };
  if (rate !== null && (rate < 0 || rate > 10_000)) {
    return { error: 'That rate looks wrong — check it.' };
  }

  try {
    await getDb()
      .update(schema.organizationMembers)
      .set({ hourlyCostRate: rate === null ? null : String(rate) })
      .where(
        and(
          eq(schema.organizationMembers.organizationId, ctx.activeOrg.organizationId),
          eq(schema.organizationMembers.id, memberId),
        ),
      );
  } catch (error) {
    logger.error('costing.set_rate_failed', { error: String(error), memberId });
    return { error: 'Something went wrong saving that rate.' };
  }

  revalidatePath('/settings/team');
  revalidatePath('/financials');
  return { message: rate === null ? 'Cost rate cleared.' : 'Cost rate saved.' };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function friendlyDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('time_entries_no_overlap')) {
    return 'That overlaps time already logged for this person. Check the existing entries.';
  }
  if (message.includes('time_entries_shift_length')) {
    return 'That shift is longer than 16 hours — check the times, or split it in two.';
  }
  if (message.includes('time_entries_clock_order')) {
    return 'The end time has to be after the start time.';
  }
  if (message.includes('expenses_not_future')) {
    return 'An expense records money already spent — it can’t be dated ahead.';
  }
  if (message.includes('expenses_amount_nonzero')) {
    return 'An expense of zero isn’t worth recording.';
  }
  return 'Something went wrong. Please try again.';
}

function nullableText(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : null;
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
