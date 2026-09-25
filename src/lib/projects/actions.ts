'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { formatProjectNumber } from '@/lib/leads/leads-core';
import {
  projectInputSchema,
  statusChangeSchema,
  teamMemberSchema,
  projectNoteSchema,
} from './schema';
import { canTransition, PROJECT_STATUS_LABELS, type ProjectStatus } from './projects-core';

async function requireProjectsWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'projects:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage projects.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId } };
}

function activityValues(
  orgId: string,
  projectId: string,
  userId: string | null,
  activityType: string,
  summary: string,
  metadata?: Record<string, unknown>,
) {
  return {
    organizationId: orgId,
    projectId,
    activityType,
    summary,
    metadata: metadata ?? null,
    createdBy: userId,
  };
}

/** Verify a user id is an active member of this org (for assignment fields). */
async function isOrgMember(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  orgId: string,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return true; // clearing an assignment is always allowed
  const [m] = await tx
    .select({ id: schema.organizationMembers.id })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, orgId),
        eq(schema.organizationMembers.userId, userId),
        eq(schema.organizationMembers.isActive, true),
      ),
    );
  return Boolean(m);
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createProject(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = projectInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  let newId: string;
  try {
    const db = getDb();
    newId = await db.transaction(async (tx) => {
      // Client must belong to the org.
      const [client] = await tx
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(
          and(eq(schema.clients.organizationId, orgId), eq(schema.clients.id, input.clientId)),
        );
      if (!client) throw new Error('client not in org');

      // Property (if given) must belong to that client.
      if (input.propertyId) {
        const [property] = await tx
          .select({ id: schema.properties.id })
          .from(schema.properties)
          .where(
            and(
              eq(schema.properties.organizationId, orgId),
              eq(schema.properties.id, input.propertyId),
              eq(schema.properties.clientId, input.clientId),
            ),
          );
        if (!property) throw new Error('property not on client');
      }

      // Assignees must be org members.
      for (const uid of [input.projectManagerId, input.foremanId, input.salespersonId]) {
        if (!(await isOrgMember(tx, orgId, uid))) throw new Error('assignee not in org');
      }

      // Per-org sequential project number (same scheme as lead conversion).
      const year = new Date().getUTCFullYear();
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.projects)
        .where(eq(schema.projects.organizationId, orgId))) as [{ count: number }];
      const projectNumber = formatProjectNumber(year, count + 1);

      const [project] = await tx
        .insert(schema.projects)
        .values({
          organizationId: orgId,
          projectNumber,
          name: input.name,
          clientId: input.clientId,
          propertyId: input.propertyId,
          projectType: input.projectType,
          status: input.status,
          projectManagerId: input.projectManagerId,
          foremanId: input.foremanId,
          salespersonId: input.salespersonId,
          contractValue: input.contractValue?.toString(),
          budget: input.budget?.toString(),
          expectedStart: input.expectedStart,
          expectedCompletion: input.expectedCompletion,
          actualStart: input.actualStart,
          actualCompletion: input.actualCompletion,
          permitStatus: input.permitStatus,
          paymentState: input.paymentState,
          description: input.description,
          internalNotes: input.internalNotes,
          createdBy: userId,
        })
        .returning({ id: schema.projects.id });
      if (!project) throw new Error('insert returned no row');
      await tx
        .insert(schema.projectActivities)
        .values(
          activityValues(orgId, project.id, userId, 'created', `Project ${projectNumber} created`),
        );
      return project.id;
    });
  } catch (error) {
    logger.error('projects: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      error: 'Could not create the project. Check the client and assignees, then try again.',
    };
  }

  revalidatePath('/projects');
  redirect(`/projects/${newId}`);
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateProject(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const projectId = z_uuid(formData.get('projectId'));
  if (!projectId) return { error: 'Unknown project.' };
  const parsed = projectInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const uid of [input.projectManagerId, input.foremanId, input.salespersonId]) {
        if (!(await isOrgMember(tx, orgId, uid))) throw new Error('assignee not in org');
      }
      const result = await tx
        .update(schema.projects)
        .set({
          name: input.name,
          projectType: input.projectType ?? null,
          projectManagerId: input.projectManagerId ?? null,
          foremanId: input.foremanId ?? null,
          salespersonId: input.salespersonId ?? null,
          contractValue: input.contractValue?.toString() ?? null,
          budget: input.budget?.toString() ?? null,
          expectedStart: input.expectedStart ?? null,
          expectedCompletion: input.expectedCompletion ?? null,
          actualStart: input.actualStart ?? null,
          actualCompletion: input.actualCompletion ?? null,
          permitStatus: input.permitStatus,
          paymentState: input.paymentState,
          description: input.description ?? null,
          internalNotes: input.internalNotes ?? null,
        })
        .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)))
        .returning({ id: schema.projects.id });
      if (result.length === 0) throw new Error('not found');
      await tx
        .insert(schema.projectActivities)
        .values(activityValues(orgId, projectId, userId, 'updated', 'Project details updated'));
    });
  } catch (error) {
    logger.error('projects: update failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save changes. Try again.' };
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

// ── Status change ─────────────────────────────────────────────────────────────

export async function changeProjectStatus(formData: FormData): Promise<void> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = statusChangeSchema.safeParse({
    projectId: formData.get('projectId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return;

  const db = getDb();
  const [current] = await db
    .select({ status: schema.projects.status, actualStart: schema.projects.actualStart })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, parsed.data.projectId)),
    );
  if (!current) return;

  const from = current.status as ProjectStatus;
  const to = parsed.data.status;
  if (!canTransition(from, to)) {
    logger.warn('projects: rejected status transition', { from, to });
    return;
  }

  // Convenience: stamp actual dates as the job crosses key milestones, without
  // overwriting a date already recorded.
  const datePatch: { actualStart?: string; actualCompletion?: string } = {};
  const todayIso = new Date().toISOString().slice(0, 10);
  if (to === 'in_progress' && !current.actualStart) datePatch.actualStart = todayIso;
  if (to === 'completed') datePatch.actualCompletion = todayIso;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.projects)
      .set({ status: to, ...datePatch })
      .where(
        and(
          eq(schema.projects.organizationId, orgId),
          eq(schema.projects.id, parsed.data.projectId),
        ),
      );
    await tx
      .insert(schema.projectActivities)
      .values(
        activityValues(
          orgId,
          parsed.data.projectId,
          userId,
          'status_change',
          `Status changed to ${PROJECT_STATUS_LABELS[to]}`,
          { from, to },
        ),
      );
  });

  revalidatePath(`/projects/${parsed.data.projectId}`);
  revalidatePath('/projects');
}

// ── Team members ──────────────────────────────────────────────────────────────

export async function addTeamMember(formData: FormData): Promise<void> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = teamMemberSchema.safeParse({
    projectId: formData.get('projectId'),
    userId: formData.get('userId'),
  });
  if (!parsed.success) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    if (!(await isOrgMember(tx, orgId, parsed.data.userId))) return;
    // Project must be in the org.
    const [project] = await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, orgId),
          eq(schema.projects.id, parsed.data.projectId),
        ),
      );
    if (!project) return;

    const [member] = await tx
      .select({ roles: schema.organizationMembers.roles })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, orgId),
          eq(schema.organizationMembers.userId, parsed.data.userId),
        ),
      );

    await tx
      .insert(schema.projectTeamMembers)
      .values({
        organizationId: orgId,
        projectId: parsed.data.projectId,
        userId: parsed.data.userId,
        roleOnProject: member?.roles?.[0] ?? null,
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.projectActivities)
      .values(activityValues(orgId, parsed.data.projectId, userId, 'team', 'Team member added'));
  });

  revalidatePath(`/projects/${parsed.data.projectId}`);
}

export async function removeTeamMember(formData: FormData): Promise<void> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const memberId = z_uuid(formData.get('memberId'));
  const projectId = z_uuid(formData.get('projectId'));
  if (!memberId || !projectId) return;

  await getDb()
    .delete(schema.projectTeamMembers)
    .where(
      and(
        eq(schema.projectTeamMembers.organizationId, orgId),
        eq(schema.projectTeamMembers.id, memberId),
      ),
    );

  revalidatePath(`/projects/${projectId}`);
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export async function addProjectNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = projectNoteSchema.safeParse({
    projectId: formData.get('projectId'),
    summary: formData.get('summary'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Add a note.' };
  }

  try {
    // Confirm the project is in this org before logging against it.
    const [project] = await getDb()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, orgId),
          eq(schema.projects.id, parsed.data.projectId),
        ),
      );
    if (!project) return { error: 'Project not found.' };

    await getDb()
      .insert(schema.projectActivities)
      .values(activityValues(orgId, parsed.data.projectId, userId, 'note', parsed.data.summary));
  } catch (error) {
    logger.error('projects: add note failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not add the note. Try again.' };
  }

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { message: 'Note added.' };
}

// ── Archive / restore ─────────────────────────────────────────────────────────

export async function archiveProject(formData: FormData): Promise<void> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };
  const projectId = z_uuid(formData.get('projectId'));
  if (!projectId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.projects)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
    await tx
      .insert(schema.projectActivities)
      .values(activityValues(orgId, projectId, userId, 'archived', 'Project archived'));
  });

  revalidatePath('/projects');
  redirect('/projects');
}

export async function restoreProject(formData: FormData): Promise<void> {
  const auth = await requireProjectsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };
  const projectId = z_uuid(formData.get('projectId'));
  if (!projectId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.projects)
      .set({ deletedAt: null })
      .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
    await tx
      .insert(schema.projectActivities)
      .values(activityValues(orgId, projectId, userId, 'restored', 'Project restored'));
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
}

/** Local uuid guard to avoid importing zod for a single field. */
function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
