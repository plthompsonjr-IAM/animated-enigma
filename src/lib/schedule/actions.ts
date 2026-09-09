'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { mirrorLater } from '@/lib/calendar/after-write';
import {
  SCHEDULE_PHASES,
  addDays,
  isDay,
  isScheduleItemStatus,
  percentValue,
  today,
  validateScheduleItem,
  wouldCycle,
  type ScheduleItemStatus,
} from './schedule-core';

async function requireScheduleWrite(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const ctx: AuthContext = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'schedule:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to change the schedule.' };
  }
  return { ok: true, orgId: ctx.activeOrg.organizationId, userId: ctx.userId };
}

/** Confirms a project belongs to the caller's org before anything touches it. */
async function projectInOrg(orgId: string, projectId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
  return Boolean(row);
}

function revalidateSchedule(projectId?: string | null) {
  revalidatePath('/schedule');
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

/** Adds a work item to a project's schedule. */
export async function createScheduleItem(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return { error: 'Pick a project for this work item.' };
  if (!(await projectInOrg(orgId, projectId))) return { error: 'That project no longer exists.' };

  const input = {
    name: String(formData.get('name') ?? ''),
    phase: nullableText(formData.get('phase')),
    startDate: String(formData.get('startDate') ?? ''),
    endDate: String(formData.get('endDate') ?? ''),
    status: statusOrDefault(formData.get('status')),
    percentComplete: String(formData.get('percentComplete') ?? '0'),
    notes: nullableText(formData.get('notes')),
  };
  const invalid = validateScheduleItem(input);
  if (invalid.error) return { error: invalid.error };

  const dependsOnId = uuidOrNull(formData.get('dependsOnId'));
  const crew = uuidList(formData.getAll('crew'));
  let createdId: string | null = null;

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      // Append to the end of the project's list so manual ordering is stable.
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(sort_order), -1) + 1` })
        .from(schema.scheduleItems)
        .where(
          and(
            eq(schema.scheduleItems.organizationId, orgId),
            eq(schema.scheduleItems.projectId, projectId),
          ),
        )) as [{ next: number }];

      const [created] = await tx
        .insert(schema.scheduleItems)
        .values({
          organizationId: orgId,
          projectId,
          name: input.name.trim(),
          phase: input.phase,
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status,
          percentComplete: percentValue(input.percentComplete) ?? 0,
          dependsOnId,
          notes: input.notes,
          sortOrder: Number(next) || 0,
          createdBy: userId,
        })
        .returning({ id: schema.scheduleItems.id });
      if (!created) throw new Error('insert returned no row');

      await assignCrewWithin(tx, orgId, created.id, crew);
      createdId = created.id;
    });
  } catch (error) {
    logger.error('schedule.create_item_failed', { error: String(error), projectId });
    return { error: friendlyDbError(error) };
  }

  if (createdId) mirrorLater('schedule_item', orgId, userId, createdId);
  revalidateSchedule(projectId);
  return { message: 'Work item added.' };
}

/** Edits a work item: dates, status, progress, crew, dependency. */
export async function updateScheduleItem(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth;

  const itemId = uuidOrNull(formData.get('itemId'));
  if (!itemId) return { error: 'Could not tell which work item to update.' };

  const input = {
    name: String(formData.get('name') ?? ''),
    phase: nullableText(formData.get('phase')),
    startDate: String(formData.get('startDate') ?? ''),
    endDate: String(formData.get('endDate') ?? ''),
    status: statusOrDefault(formData.get('status')),
    percentComplete: String(formData.get('percentComplete') ?? '0'),
    notes: nullableText(formData.get('notes')),
  };
  const invalid = validateScheduleItem(input);
  if (invalid.error) return { error: invalid.error };

  const dependsOnId = uuidOrNull(formData.get('dependsOnId'));
  const crew = uuidList(formData.getAll('crew'));
  let projectId: string | null = null;

  try {
    const db = getDb();
    projectId = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: schema.scheduleItems.id, projectId: schema.scheduleItems.projectId })
        .from(schema.scheduleItems)
        .where(
          and(eq(schema.scheduleItems.organizationId, orgId), eq(schema.scheduleItems.id, itemId)),
        );
      if (!existing) throw new Error('item not in org');

      if (dependsOnId) {
        // The database rejects self- and cross-project dependencies; cycles need
        // the whole project's chain, so they are checked here where we have it.
        const siblings = await tx
          .select({ id: schema.scheduleItems.id, dependsOnId: schema.scheduleItems.dependsOnId })
          .from(schema.scheduleItems)
          .where(
            and(
              eq(schema.scheduleItems.organizationId, orgId),
              eq(schema.scheduleItems.projectId, existing.projectId),
            ),
          );
        if (wouldCycle(siblings, itemId, dependsOnId)) {
          throw new CycleError();
        }
      }

      await tx
        .update(schema.scheduleItems)
        .set({
          name: input.name.trim(),
          phase: input.phase,
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status,
          percentComplete: percentValue(input.percentComplete) ?? 0,
          dependsOnId,
          notes: input.notes,
        })
        .where(
          and(eq(schema.scheduleItems.organizationId, orgId), eq(schema.scheduleItems.id, itemId)),
        );

      await assignCrewWithin(tx, orgId, itemId, crew);
      return existing.projectId;
    });
  } catch (error) {
    if (error instanceof CycleError) {
      return { error: 'That would make the work items depend on each other in a loop.' };
    }
    logger.error('schedule.update_item_failed', { error: String(error), itemId });
    return { error: friendlyDbError(error) };
  }

  mirrorLater('schedule_item', orgId, auth.userId, itemId);
  revalidateSchedule(projectId);
  return { message: 'Work item saved.' };
}

/**
 * Status-only change — the one-tap buttons on a work item row, sized for a
 * phone on a jobsite rather than the full edit form.
 */
export async function setScheduleItemStatus(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const itemId = uuidOrNull(formData.get('itemId'));
  const status = formData.get('status');
  if (!itemId || typeof status !== 'string' || !isScheduleItemStatus(status)) return;

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [updated] = await db
      .update(schema.scheduleItems)
      .set({
        status,
        // Keep progress honest with the status the foreman just tapped.
        ...(status === 'complete' ? { percentComplete: 100 } : {}),
        ...(status === 'not_started' ? { percentComplete: 0 } : {}),
      })
      .where(
        and(eq(schema.scheduleItems.organizationId, orgId), eq(schema.scheduleItems.id, itemId)),
      )
      .returning({ projectId: schema.scheduleItems.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('schedule.set_status_failed', { error: String(error), itemId });
    return;
  }
  if (projectId) mirrorLater('schedule_item', orgId, auth.userId, itemId);
  revalidateSchedule(projectId);
}

/** Removes a work item. Anything depending on it simply loses its predecessor. */
export async function deleteScheduleItem(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const itemId = uuidOrNull(formData.get('itemId'));
  if (!itemId) return;

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [deleted] = await db
      .delete(schema.scheduleItems)
      .where(
        and(eq(schema.scheduleItems.organizationId, orgId), eq(schema.scheduleItems.id, itemId)),
      )
      .returning({ projectId: schema.scheduleItems.projectId });
    projectId = deleted?.projectId ?? null;
  } catch (error) {
    logger.error('schedule.delete_item_failed', { error: String(error), itemId });
    return;
  }
  // The row is gone; the mirror finds nothing and takes the event off the calendar.
  if (projectId) mirrorLater('schedule_item', orgId, auth.userId, itemId);
  revalidateSchedule(projectId);
}

/**
 * Nudges a work item's dates by whole days, keeping its duration. This is how a
 * rain day actually gets handled: push the phase, don't retype both dates.
 */
export async function shiftScheduleItem(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const { orgId } = auth;

  const itemId = uuidOrNull(formData.get('itemId'));
  const days = Number(formData.get('days'));
  if (!itemId || !Number.isInteger(days) || days === 0 || Math.abs(days) > 90) return;

  let projectId: string | null = null;
  try {
    const db = getDb();
    const [item] = await db
      .select({
        projectId: schema.scheduleItems.projectId,
        startDate: schema.scheduleItems.startDate,
        endDate: schema.scheduleItems.endDate,
      })
      .from(schema.scheduleItems)
      .where(
        and(eq(schema.scheduleItems.organizationId, orgId), eq(schema.scheduleItems.id, itemId)),
      );
    if (!item) return;

    const startDate = addDays(item.startDate, days);
    const endDate = addDays(item.endDate, days);
    if (!startDate || !endDate) return;

    await db
      .update(schema.scheduleItems)
      .set({ startDate, endDate })
      .where(
        and(eq(schema.scheduleItems.organizationId, orgId), eq(schema.scheduleItems.id, itemId)),
      );
    projectId = item.projectId;
  } catch (error) {
    logger.error('schedule.shift_item_failed', { error: String(error), itemId });
    return;
  }
  mirrorLater('schedule_item', orgId, auth.userId, itemId);
  revalidateSchedule(projectId);
}

/**
 * Lays down the standard trade sequence for a project that has no schedule yet,
 * one week per phase from the project's expected start (or today). It is a
 * starting point to drag into shape, not a plan — which is why it refuses to run
 * over an existing schedule.
 */
export async function seedProjectSchedule(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return;
  const seededIds: string[] = [];

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: schema.projects.id, expectedStart: schema.projects.expectedStart })
        .from(schema.projects)
        .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
      if (!project) throw new Error('project not in org');

      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.scheduleItems)
        .where(
          and(
            eq(schema.scheduleItems.organizationId, orgId),
            eq(schema.scheduleItems.projectId, projectId),
          ),
        )) as [{ count: number }];
      if (count > 0) throw new Error('project already has a schedule');

      const start =
        project.expectedStart && isDay(project.expectedStart) ? project.expectedStart : today();

      let cursor = start;
      let previousId: string | null = null;
      let order = 0;
      for (const phase of SCHEDULE_PHASES) {
        const end = addDays(cursor, 4); // Monday-to-Friday shape, one week a phase
        if (!end) break;
        // Annotated because dependsOnId feeds back from the previous insert, and
        // an inferred type here is self-referential.
        const created: { id: string }[] = await tx
          .insert(schema.scheduleItems)
          .values({
            organizationId: orgId,
            projectId,
            name: phase,
            phase,
            startDate: cursor,
            endDate: end,
            status: 'not_started',
            dependsOnId: previousId,
            sortOrder: order++,
            createdBy: userId,
          })
          .returning({ id: schema.scheduleItems.id });
        previousId = created[0]?.id ?? null;
        if (previousId) seededIds.push(previousId);
        const next = addDays(end, 3); // next phase starts the following Monday
        if (!next) break;
        cursor = next;
      }
    });
  } catch (error) {
    logger.error('schedule.seed_failed', { error: String(error), projectId });
    return;
  }
  for (const id of seededIds) mirrorLater('schedule_item', orgId, userId, id);
  revalidateSchedule(projectId);
}

// ── helpers ──────────────────────────────────────────────────────────────────

class CycleError extends Error {}

/**
 * Replaces a work item's crew with exactly `userIds`, verifying each is an
 * active member of the org — a hand-edited form must not be able to book a
 * stranger onto a job.
 */
async function assignCrewWithin(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  orgId: string,
  itemId: string,
  userIds: string[],
) {
  await tx
    .delete(schema.scheduleAssignments)
    .where(
      and(
        eq(schema.scheduleAssignments.organizationId, orgId),
        eq(schema.scheduleAssignments.scheduleItemId, itemId),
      ),
    );
  if (userIds.length === 0) return;

  const members = await tx
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, orgId),
        eq(schema.organizationMembers.isActive, true),
      ),
    );
  const allowed = new Set(members.map((m) => m.userId));
  const values = [...new Set(userIds)]
    .filter((id) => allowed.has(id))
    .map((userId) => ({ organizationId: orgId, scheduleItemId: itemId, userId }));
  if (values.length > 0) await tx.insert(schema.scheduleAssignments).values(values);
}

/** Turns a database constraint or trigger message into something readable. */
function friendlyDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('schedule_items_dates_ordered')) {
    return 'The end date can’t be before the start date.';
  }
  if (message.includes('schedule_items_percent_bounds')) {
    return 'Percent complete has to be between 0 and 100.';
  }
  if (message.includes('same project')) {
    return 'A work item can only depend on another item on the same project.';
  }
  if (message.includes('depend on itself')) {
    return 'A work item can’t depend on itself.';
  }
  return 'Something went wrong saving the schedule. Please try again.';
}

function statusOrDefault(value: FormDataEntryValue | null): ScheduleItemStatus {
  const s = typeof value === 'string' ? value : '';
  return isScheduleItemStatus(s) ? s : 'not_started';
}

function nullableText(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : null;
}

function uuidList(values: FormDataEntryValue[]): string[] {
  return values.map((v) => uuidOrNull(v)).filter((v): v is string => v !== null);
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
