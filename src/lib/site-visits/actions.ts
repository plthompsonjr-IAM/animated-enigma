'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { VISIT_TYPE_LABELS } from './site-visits-core';
import {
  scheduleVisitSchema,
  rescheduleVisitSchema,
  assignVisitSchema,
  completeVisitSchema,
} from './schema';

async function requireScheduleWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'schedule:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage the schedule.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId } };
}

/** Confirm a user id is an active member of the org (for assignment). */
async function isOrgMember(orgId: string, userId: string | undefined | null): Promise<boolean> {
  if (!userId) return true;
  const [m] = await getDb()
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

/** Log a lead/project activity for a scheduling event, best-effort. */
async function logActivity(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  orgId: string,
  userId: string | null,
  target: { leadId?: string | null; projectId?: string | null },
  summary: string,
) {
  if (target.leadId) {
    await tx.insert(schema.leadActivities).values({
      organizationId: orgId,
      leadId: target.leadId,
      activityType: 'site_visit',
      summary,
      createdBy: userId,
    });
  }
  if (target.projectId) {
    await tx.insert(schema.projectActivities).values({
      organizationId: orgId,
      projectId: target.projectId,
      activityType: 'site_visit',
      summary,
      createdBy: userId,
    });
  }
}

// ── Schedule ──────────────────────────────────────────────────────────────────

export async function scheduleVisit(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = scheduleVisitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;
  const scheduledAt = new Date(input.scheduledAt);

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      if (!(await isOrgMember(orgId, input.assignedTo))) throw new Error('assignee not in org');

      // Verify the parent lead/project belongs to this org.
      if (input.leadId) {
        const [lead] = await tx
          .select({ id: schema.leads.id, status: schema.leads.status })
          .from(schema.leads)
          .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, input.leadId)));
        if (!lead) throw new Error('lead not in org');
        // Advance an early-stage lead to "site visit scheduled".
        if (['new', 'contacted', 'qualified'].includes(lead.status)) {
          await tx
            .update(schema.leads)
            .set({ status: 'site_visit_scheduled' })
            .where(eq(schema.leads.id, input.leadId));
        }
      }
      if (input.projectId) {
        const [project] = await tx
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(
            and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, input.projectId)),
          );
        if (!project) throw new Error('project not in org');
      }

      await tx.insert(schema.siteVisits).values({
        organizationId: orgId,
        leadId: input.leadId,
        projectId: input.projectId,
        visitType: input.visitType,
        scheduledAt,
        durationMinutes: input.durationMinutes,
        assignedTo: input.assignedTo,
        notes: input.notes,
        createdBy: userId,
      });

      await logActivity(
        tx,
        orgId,
        userId,
        input,
        `${VISIT_TYPE_LABELS[input.visitType]} scheduled`,
      );
    });
  } catch (error) {
    logger.error('site-visits: schedule failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not schedule the visit. Try again.' };
  }

  revalidatePath('/schedule');
  if (input.leadId) revalidatePath(`/leads/${input.leadId}`);
  if (input.projectId) revalidatePath(`/projects/${input.projectId}`);
  return { message: 'Site visit scheduled.' };
}

// ── Reschedule / assign ───────────────────────────────────────────────────────

export async function rescheduleVisit(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = rescheduleVisitSchema.safeParse({
    visitId: formData.get('visitId'),
    scheduledAt: formData.get('scheduledAt'),
    durationMinutes: formData.get('durationMinutes'),
  });
  if (!parsed.success) return;

  await getDb()
    .update(schema.siteVisits)
    .set({
      scheduledAt: new Date(parsed.data.scheduledAt),
      durationMinutes: parsed.data.durationMinutes,
    })
    .where(
      and(
        eq(schema.siteVisits.organizationId, orgId),
        eq(schema.siteVisits.id, parsed.data.visitId),
      ),
    );

  revalidatePath('/schedule');
}

export async function assignVisit(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = assignVisitSchema.safeParse({
    visitId: formData.get('visitId'),
    assignedTo: formData.get('assignedTo'),
  });
  if (!parsed.success) return;
  if (parsed.data.assignedTo && !(await isOrgMember(orgId, parsed.data.assignedTo))) return;

  await getDb()
    .update(schema.siteVisits)
    .set({ assignedTo: parsed.data.assignedTo })
    .where(
      and(
        eq(schema.siteVisits.organizationId, orgId),
        eq(schema.siteVisits.id, parsed.data.visitId),
      ),
    );

  revalidatePath('/schedule');
}

// ── Complete / cancel ─────────────────────────────────────────────────────────

export async function completeVisit(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = completeVisitSchema.safeParse({
    visitId: formData.get('visitId'),
    notes: formData.get('notes'),
    measurements: formData.get('measurements'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const [visit] = await tx
        .update(schema.siteVisits)
        .set({
          status: 'completed',
          completedAt: sql`now()`,
          notes: parsed.data.notes ?? null,
          measurements: parsed.data.measurements ? { summary: parsed.data.measurements } : null,
        })
        .where(
          and(
            eq(schema.siteVisits.organizationId, orgId),
            eq(schema.siteVisits.id, parsed.data.visitId),
          ),
        )
        .returning({ leadId: schema.siteVisits.leadId, projectId: schema.siteVisits.projectId });
      if (!visit) throw new Error('not found');
      await logActivity(tx, orgId, userId, visit, 'Site visit completed');
    });
  } catch (error) {
    logger.error('site-visits: complete failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save the visit. Try again.' };
  }

  revalidatePath('/schedule');
  return { message: 'Visit marked complete.' };
}

export async function cancelVisit(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };
  const visitId = z_uuid(formData.get('visitId'));
  if (!visitId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const [visit] = await tx
      .update(schema.siteVisits)
      .set({ status: 'cancelled' })
      .where(and(eq(schema.siteVisits.organizationId, orgId), eq(schema.siteVisits.id, visitId)))
      .returning({ leadId: schema.siteVisits.leadId, projectId: schema.siteVisits.projectId });
    if (visit) await logActivity(tx, orgId, userId, visit, 'Site visit cancelled');
  });

  revalidatePath('/schedule');
}

export async function reopenVisit(formData: FormData): Promise<void> {
  const auth = await requireScheduleWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const visitId = z_uuid(formData.get('visitId'));
  if (!visitId) return;

  await getDb()
    .update(schema.siteVisits)
    .set({ status: 'scheduled', completedAt: null })
    .where(and(eq(schema.siteVisits.organizationId, orgId), eq(schema.siteVisits.id, visitId)));

  revalidatePath('/schedule');
}

/** Local uuid guard to avoid importing zod for a single field. */
function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
