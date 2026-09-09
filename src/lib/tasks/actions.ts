'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { addDays, isDay, today } from '@/lib/schedule/schedule-core';
import {
  PUNCH_LIST_STARTERS,
  hoursValue,
  isPriority,
  isTaskStatus,
  parseChecklist,
  validateTask,
  wouldCycle,
  type Priority,
  type TaskStatus,
} from './tasks-core';

/**
 * Tasks are the one part of the system a technician can change: the whole point
 * is that the person doing the work updates it from a phone. `tasks:write` is
 * granted to technicians, unlike `projects:write`.
 */
async function requireTasksWrite(): Promise<
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
    return { ok: false, error: 'You do not have permission to change tasks.' };
  }
  return { ok: true, orgId: ctx.activeOrg.organizationId, userId: ctx.userId };
}

function revalidateTasks(projectId?: string | null) {
  revalidatePath('/tasks');
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

/** Adds a task to a project, optionally with a pasted checklist. */
export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return { error: 'Pick a project for this task.' };

  const input = readTaskInput(formData);
  const invalid = validateTask(input);
  if (invalid.error) return { error: invalid.error };

  const checklist = parseChecklist(String(formData.get('checklist') ?? ''));
  const scheduleItemId = uuidOrNull(formData.get('scheduleItemId'));
  const assigneeId = uuidOrNull(formData.get('assigneeId'));
  const isPunchList = formData.get('isPunchList') === 'on';

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
      if (!project) throw new Error('project not in org');

      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(sort_order), -1) + 1` })
        .from(schema.projectTasks)
        .where(
          and(
            eq(schema.projectTasks.organizationId, orgId),
            eq(schema.projectTasks.projectId, projectId),
          ),
        )) as [{ next: number }];

      const created: { id: string }[] = await tx
        .insert(schema.projectTasks)
        .values({
          organizationId: orgId,
          projectId,
          scheduleItemId: await verifiedScheduleItem(tx, orgId, projectId, scheduleItemId),
          title: input.title.trim(),
          description: input.description,
          assigneeId: await verifiedMember(tx, orgId, assigneeId),
          priority: input.priority,
          status: input.status,
          isPunchList,
          startDate: input.startDate,
          dueDate: input.dueDate,
          estimatedHours: numericOrNull(input.estimatedHours),
          actualHours: numericOrNull(input.actualHours),
          sortOrder: Number(next) || 0,
          createdBy: userId,
        })
        .returning({ id: schema.projectTasks.id });

      const taskId = created[0]?.id;
      if (!taskId) throw new Error('insert returned no row');
      if (checklist.length > 0) {
        await tx.insert(schema.taskChecklistItems).values(
          checklist.map((label, i) => ({
            organizationId: orgId,
            taskId,
            label,
            sortOrder: i,
          })),
        );
      }
    });
  } catch (error) {
    logger.error('tasks.create_failed', { error: String(error), projectId });
    return { error: friendlyDbError(error) };
  }

  revalidateTasks(projectId);
  return { message: 'Task added.' };
}

/** Edits a task. The checklist is managed separately so a typo can't wipe it. */
export async function updateTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  if (!taskId) return { error: 'Could not tell which task to update.' };

  const input = readTaskInput(formData);
  const invalid = validateTask(input);
  if (invalid.error) return { error: invalid.error };

  const scheduleItemId = uuidOrNull(formData.get('scheduleItemId'));
  const assigneeId = uuidOrNull(formData.get('assigneeId'));
  const isPunchList = formData.get('isPunchList') === 'on';
  let projectId: string | null = null;

  try {
    const db = getDb();
    projectId = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ projectId: schema.projectTasks.projectId })
        .from(schema.projectTasks)
        .where(
          and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)),
        );
      if (!existing) throw new Error('task not in org');

      await tx
        .update(schema.projectTasks)
        .set({
          scheduleItemId: await verifiedScheduleItem(
            tx,
            orgId,
            existing.projectId,
            scheduleItemId,
          ),
          title: input.title.trim(),
          description: input.description,
          assigneeId: await verifiedMember(tx, orgId, assigneeId),
          priority: input.priority,
          status: input.status,
          isPunchList,
          startDate: input.startDate,
          dueDate: input.dueDate,
          estimatedHours: numericOrNull(input.estimatedHours),
          actualHours: numericOrNull(input.actualHours),
        })
        .where(
          and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)),
        );
      return existing.projectId;
    });
  } catch (error) {
    logger.error('tasks.update_failed', { error: String(error), taskId });
    return { error: friendlyDbError(error) };
  }

  revalidateTasks(projectId);
  return { message: 'Task saved.' };
}

/**
 * Status-only change — the one-tap buttons. `completed_at` is maintained by a
 * database trigger, so this never has to remember to set or clear it.
 */
export async function setTaskStatus(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  const status = formData.get('status');
  if (!taskId || typeof status !== 'string' || !isTaskStatus(status)) return;

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [updated] = await db
      .update(schema.projectTasks)
      .set({
        status,
        // Record who called it done; clear it if the task reopens.
        completionVerifiedBy: status === 'completed' ? userId : null,
      })
      .where(and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)))
      .returning({ projectId: schema.projectTasks.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('tasks.set_status_failed', { error: String(error), taskId });
    return;
  }
  revalidateTasks(projectId);
}

/** Reassigns a task, or clears the assignee when given nothing. */
export async function assignTask(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  if (!taskId) return;
  const assigneeId = uuidOrNull(formData.get('assigneeId'));

  let projectId: string | null = null;
  try {
    const db = getDb();
    const verified = await verifiedMember(db, orgId, assigneeId);
    const [updated] = await db
      .update(schema.projectTasks)
      .set({ assigneeId: verified })
      .where(and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)))
      .returning({ projectId: schema.projectTasks.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('tasks.assign_failed', { error: String(error), taskId });
    return;
  }
  revalidateTasks(projectId);
}

/** Nudges a task's due date by whole days — "not today, tomorrow". */
export async function pushTaskDueDate(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  const days = Number(formData.get('days'));
  if (!taskId || !Number.isInteger(days) || days === 0 || Math.abs(days) > 90) return;

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [task] = await db
      .select({
        projectId: schema.projectTasks.projectId,
        dueDate: schema.projectTasks.dueDate,
        startDate: schema.projectTasks.startDate,
      })
      .from(schema.projectTasks)
      .where(and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)));
    if (!task) return;

    // An undated task gets its first due date relative to today, which is what
    // "push it out two days" means for something with no date yet.
    const base = task.dueDate && isDay(task.dueDate) ? task.dueDate : today();
    const dueDate = addDays(base, days);
    if (!dueDate) return;
    // Keep the range valid rather than letting the CHECK reject the update.
    const startDate =
      task.startDate && isDay(task.startDate) && task.startDate > dueDate ? dueDate : task.startDate;

    await db
      .update(schema.projectTasks)
      .set({ dueDate, startDate })
      .where(and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)));
    projectId = task.projectId;
  } catch (error) {
    logger.error('tasks.push_due_date_failed', { error: String(error), taskId });
    return;
  }
  revalidateTasks(projectId);
}

/** Ticks or unticks a checklist item. */
export async function toggleChecklistItem(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const itemId = uuidOrNull(formData.get('itemId'));
  if (!itemId) return;
  const isDone = formData.get('isDone') === 'true';

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [item] = await db
      .update(schema.taskChecklistItems)
      .set({ isDone })
      .where(
        and(
          eq(schema.taskChecklistItems.organizationId, orgId),
          eq(schema.taskChecklistItems.id, itemId),
        ),
      )
      .returning({ taskId: schema.taskChecklistItems.taskId });
    if (item) {
      const [task] = await db
        .select({ projectId: schema.projectTasks.projectId })
        .from(schema.projectTasks)
        .where(eq(schema.projectTasks.id, item.taskId));
      projectId = task?.projectId ?? null;
    }
  } catch (error) {
    logger.error('tasks.toggle_checklist_failed', { error: String(error), itemId });
    return;
  }
  revalidateTasks(projectId);
}

/** Appends checklist items to an existing task from a pasted block. */
export async function addChecklistItems(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  if (!taskId) return { error: 'Could not tell which task to add to.' };
  const labels = parseChecklist(String(formData.get('checklist') ?? ''));
  if (labels.length === 0) return { error: 'Nothing to add — put one step on each line.' };

  let projectId: string | null = null;
  try {
    const db = getDb();
    projectId = await db.transaction(async (tx) => {
      const [task] = await tx
        .select({ projectId: schema.projectTasks.projectId })
        .from(schema.projectTasks)
        .where(
          and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)),
        );
      if (!task) throw new Error('task not in org');

      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(sort_order), -1) + 1` })
        .from(schema.taskChecklistItems)
        .where(
          and(
            eq(schema.taskChecklistItems.organizationId, orgId),
            eq(schema.taskChecklistItems.taskId, taskId),
          ),
        )) as [{ next: number }];

      await tx.insert(schema.taskChecklistItems).values(
        labels.map((label, i) => ({
          organizationId: orgId,
          taskId,
          label,
          sortOrder: (Number(next) || 0) + i,
        })),
      );
      return task.projectId;
    });
  } catch (error) {
    logger.error('tasks.add_checklist_failed', { error: String(error), taskId });
    return { error: 'Something went wrong adding those steps. Please try again.' };
  }

  revalidateTasks(projectId);
  return { message: `Added ${labels.length} ${labels.length === 1 ? 'step' : 'steps'}.` };
}

/** Removes a checklist item. */
export async function deleteChecklistItem(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const itemId = uuidOrNull(formData.get('itemId'));
  if (!itemId) return;

  try {
    const db = getDb();
    await db
      .delete(schema.taskChecklistItems)
      .where(
        and(
          eq(schema.taskChecklistItems.organizationId, orgId),
          eq(schema.taskChecklistItems.id, itemId),
        ),
      );
  } catch (error) {
    logger.error('tasks.delete_checklist_failed', { error: String(error), itemId });
    return;
  }
  revalidateTasks(null);
}

/** Records that one task waits on another. */
export async function addTaskDependency(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  const dependsOnTaskId = uuidOrNull(formData.get('dependsOnTaskId'));
  if (!taskId || !dependsOnTaskId) return { error: 'Pick the task this one waits on.' };
  if (taskId === dependsOnTaskId) return { error: 'A task can’t wait on itself.' };

  let projectId: string | null = null;
  try {
    const db = getDb();
    projectId = await db.transaction(async (tx) => {
      const [task] = await tx
        .select({ projectId: schema.projectTasks.projectId })
        .from(schema.projectTasks)
        .where(
          and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)),
        );
      if (!task) throw new Error('task not in org');

      // The database rejects self- and cross-project edges; cycles need the whole
      // graph, so they're checked here where we have it.
      const existing = await tx
        .select({
          taskId: schema.taskDependencies.taskId,
          dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
        })
        .from(schema.taskDependencies)
        .where(eq(schema.taskDependencies.organizationId, orgId));
      if (wouldCycle(existing, taskId, dependsOnTaskId)) throw new CycleError();

      await tx
        .insert(schema.taskDependencies)
        .values({ organizationId: orgId, taskId, dependsOnTaskId })
        .onConflictDoNothing();
      return task.projectId;
    });
  } catch (error) {
    if (error instanceof CycleError) {
      return { error: 'That would leave the tasks waiting on each other in a loop.' };
    }
    logger.error('tasks.add_dependency_failed', { error: String(error), taskId });
    return { error: friendlyDbError(error) };
  }

  revalidateTasks(projectId);
  return { message: 'Dependency added.' };
}

/** Removes a dependency. */
export async function removeTaskDependency(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  const dependsOnTaskId = uuidOrNull(formData.get('dependsOnTaskId'));
  if (!taskId || !dependsOnTaskId) return;

  try {
    const db = getDb();
    await db
      .delete(schema.taskDependencies)
      .where(
        and(
          eq(schema.taskDependencies.organizationId, orgId),
          eq(schema.taskDependencies.taskId, taskId),
          eq(schema.taskDependencies.dependsOnTaskId, dependsOnTaskId),
        ),
      );
  } catch (error) {
    logger.error('tasks.remove_dependency_failed', { error: String(error), taskId });
    return;
  }
  revalidateTasks(null);
}

/**
 * Soft-deletes a task. Soft because a task carries hours and a completion
 * record — the sort of thing worth being able to answer questions about later.
 */
export async function deleteTask(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const taskId = uuidOrNull(formData.get('taskId'));
  if (!taskId) return;

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [deleted] = await db
      .update(schema.projectTasks)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.projectTasks.organizationId, orgId), eq(schema.projectTasks.id, taskId)))
      .returning({ projectId: schema.projectTasks.projectId });
    projectId = deleted?.projectId ?? null;
  } catch (error) {
    logger.error('tasks.delete_failed', { error: String(error), taskId });
    return;
  }
  revalidateTasks(projectId);
}

/**
 * Lays down the standard punch list on a project that has none yet. A starting
 * point to prune, not a plan — which is why it refuses to run twice.
 */
export async function seedPunchList(formData: FormData): Promise<void> {
  const auth = await requireTasksWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return;

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
      if (!project) throw new Error('project not in org');

      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.projectTasks)
        .where(
          and(
            eq(schema.projectTasks.organizationId, orgId),
            eq(schema.projectTasks.projectId, projectId),
            eq(schema.projectTasks.isPunchList, true),
            sql`${schema.projectTasks.deletedAt} is null`,
          ),
        )) as [{ count: number }];
      if (count > 0) throw new Error('project already has a punch list');

      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(sort_order), -1) + 1` })
        .from(schema.projectTasks)
        .where(
          and(
            eq(schema.projectTasks.organizationId, orgId),
            eq(schema.projectTasks.projectId, projectId),
          ),
        )) as [{ next: number }];

      await tx.insert(schema.projectTasks).values(
        PUNCH_LIST_STARTERS.map((title, i) => ({
          organizationId: orgId,
          projectId,
          title,
          isPunchList: true,
          priority: 'medium' as const,
          status: 'not_started' as const,
          sortOrder: (Number(next) || 0) + i,
          createdBy: userId,
        })),
      );
    });
  } catch (error) {
    logger.error('tasks.seed_punch_list_failed', { error: String(error), projectId });
    return;
  }
  revalidateTasks(projectId);
}

// ── helpers ──────────────────────────────────────────────────────────────────

class CycleError extends Error {}

type Executor = ReturnType<typeof getDb> | Parameters<
  Parameters<ReturnType<typeof getDb>['transaction']>[0]
>[0];

function readTaskInput(formData: FormData) {
  const priority = String(formData.get('priority') ?? '');
  const status = String(formData.get('status') ?? '');
  return {
    title: String(formData.get('title') ?? ''),
    description: nullableText(formData.get('description')),
    priority: (isPriority(priority) ? priority : 'medium') as Priority,
    status: (isTaskStatus(status) ? status : 'not_started') as TaskStatus,
    startDate: nullableDay(formData.get('startDate')),
    dueDate: nullableDay(formData.get('dueDate')),
    estimatedHours: String(formData.get('estimatedHours') ?? ''),
    actualHours: String(formData.get('actualHours') ?? ''),
  };
}

/**
 * Only an active member of the org can be assigned work — a hand-edited form
 * must not be able to put a stranger's name on a task.
 */
async function verifiedMember(
  db: Executor,
  orgId: string,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  const [member] = await db
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, orgId),
        eq(schema.organizationMembers.userId, userId),
        eq(schema.organizationMembers.isActive, true),
      ),
    );
  return member?.userId ?? null;
}

/** A task can only hang off a schedule phase on its own project. */
async function verifiedScheduleItem(
  db: Executor,
  orgId: string,
  projectId: string,
  scheduleItemId: string | null,
): Promise<string | null> {
  if (!scheduleItemId) return null;
  const [item] = await db
    .select({ id: schema.scheduleItems.id })
    .from(schema.scheduleItems)
    .where(
      and(
        eq(schema.scheduleItems.organizationId, orgId),
        eq(schema.scheduleItems.id, scheduleItemId),
        eq(schema.scheduleItems.projectId, projectId),
      ),
    );
  return item?.id ?? null;
}

function friendlyDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('project_tasks_dates_ordered')) {
    return 'The due date can’t be before the start date.';
  }
  if (message.includes('project_tasks_hours_nonnegative')) {
    return 'Hours can’t be negative.';
  }
  if (message.includes('same project')) {
    return 'A task can only wait on another task on the same project.';
  }
  if (message.includes('task_dependencies_not_self')) {
    return 'A task can’t wait on itself.';
  }
  return 'Something went wrong saving the task. Please try again.';
}

function numericOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const hours = hoursValue(value);
  return hours === null ? null : String(hours);
}

function nullableText(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : null;
}

function nullableDay(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return isDay(s) ? s : null;
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
