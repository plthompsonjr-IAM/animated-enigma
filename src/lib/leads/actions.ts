'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import {
  leadInputSchema,
  statusChangeSchema,
  assignSchema,
  activitySchema,
  followUpSchema,
} from './schema';
import {
  LEAD_STATUS_LABELS,
  canTransition,
  formatProjectNumber,
  type LeadStatus,
} from './leads-core';

async function requireLeadsWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'leads:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage leads.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId } };
}

/** Build a lead-activity row (used inside the same transaction as the change). */
function activityValues(
  orgId: string,
  leadId: string,
  userId: string | null,
  activityType: string,
  summary: string,
  metadata?: Record<string, unknown>,
) {
  return {
    organizationId: orgId,
    leadId,
    activityType,
    summary,
    metadata: metadata ?? null,
    createdBy: userId,
  };
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createLead(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = leadInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  let newId: string;
  try {
    const db = getDb();
    newId = await db.transaction(async (tx) => {
      const [lead] = await tx
        .insert(schema.leads)
        .values({
          organizationId: orgId,
          leadName: input.leadName,
          clientName: input.clientName,
          phone: input.phone,
          email: input.email,
          propertyAddress: input.propertyAddress ? { line1: input.propertyAddress } : null,
          projectType: input.projectType,
          leadSource: input.leadSource,
          estimatedBudget: input.estimatedBudget?.toString(),
          desiredStartDate: input.desiredStartDate,
          description: input.description,
          assignedTo: input.assignedTo,
          status: input.status,
          priority: input.priority,
          nextFollowUpDate: input.nextFollowUpDate,
          notes: input.notes,
          createdBy: userId,
        })
        .returning({ id: schema.leads.id });
      if (!lead) throw new Error('insert returned no row');
      await tx
        .insert(schema.leadActivities)
        .values(activityValues(orgId, lead.id, userId, 'created', 'Lead created'));
      return lead.id;
    });
  } catch (error) {
    logger.error('leads: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not create the lead. Try again.' };
  }

  revalidatePath('/leads');
  redirect(`/leads/${newId}`);
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateLead(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const leadId = z_uuid(formData.get('leadId'));
  if (!leadId) return { error: 'Unknown lead.' };
  const parsed = leadInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  try {
    const db = getDb();
    const result = await db
      .update(schema.leads)
      .set({
        leadName: input.leadName,
        clientName: input.clientName ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        propertyAddress: input.propertyAddress ? { line1: input.propertyAddress } : null,
        projectType: input.projectType ?? null,
        leadSource: input.leadSource ?? null,
        estimatedBudget: input.estimatedBudget?.toString() ?? null,
        desiredStartDate: input.desiredStartDate ?? null,
        description: input.description ?? null,
        assignedTo: input.assignedTo ?? null,
        priority: input.priority,
        nextFollowUpDate: input.nextFollowUpDate ?? null,
        notes: input.notes ?? null,
      })
      .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, leadId)))
      .returning({ id: schema.leads.id });
    if (result.length === 0) return { error: 'Lead not found.' };
    await getDb()
      .insert(schema.leadActivities)
      .values(activityValues(orgId, leadId, userId, 'updated', 'Lead details updated'));
  } catch (error) {
    logger.error('leads: update failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save changes. Try again.' };
  }

  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}`);
}

// ── Status change ─────────────────────────────────────────────────────────────

export async function changeLeadStatus(formData: FormData): Promise<void> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = statusChangeSchema.safeParse({
    leadId: formData.get('leadId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return;

  const db = getDb();
  const [current] = await db
    .select({ status: schema.leads.status, converted: schema.leads.convertedProjectId })
    .from(schema.leads)
    .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, parsed.data.leadId)));
  if (!current) return;

  if (
    !canTransition(current.status as LeadStatus, parsed.data.status, {
      converted: Boolean(current.converted),
    })
  ) {
    logger.warn('leads: rejected status transition', {
      from: current.status,
      to: parsed.data.status,
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.leads)
      .set({ status: parsed.data.status })
      .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, parsed.data.leadId)));
    await tx
      .insert(schema.leadActivities)
      .values(
        activityValues(
          orgId,
          parsed.data.leadId,
          userId,
          'status_change',
          `Status changed to ${LEAD_STATUS_LABELS[parsed.data.status]}`,
          { from: current.status, to: parsed.data.status },
        ),
      );
  });

  revalidatePath(`/leads/${parsed.data.leadId}`);
  revalidatePath('/leads');
}

// ── Assignment ────────────────────────────────────────────────────────────────

export async function assignLead(formData: FormData): Promise<void> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = assignSchema.safeParse({
    leadId: formData.get('leadId'),
    assignedTo: formData.get('assignedTo'),
  });
  if (!parsed.success) return;

  // A lead can only be assigned to a member of the same organization.
  if (parsed.data.assignedTo) {
    const db = getDb();
    const [member] = await db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, orgId),
          eq(schema.organizationMembers.userId, parsed.data.assignedTo),
          eq(schema.organizationMembers.isActive, true),
        ),
      );
    if (!member) {
      logger.warn('leads: assignment to non-member rejected');
      return;
    }
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.leads)
      .set({ assignedTo: parsed.data.assignedTo })
      .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, parsed.data.leadId)));
    await tx
      .insert(schema.leadActivities)
      .values(
        activityValues(
          orgId,
          parsed.data.leadId,
          userId,
          'assignment',
          parsed.data.assignedTo ? 'Lead reassigned' : 'Lead unassigned',
        ),
      );
  });

  revalidatePath(`/leads/${parsed.data.leadId}`);
  revalidatePath('/leads');
}

// ── Follow-up date ────────────────────────────────────────────────────────────

export async function setFollowUp(formData: FormData): Promise<void> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = followUpSchema.safeParse({
    leadId: formData.get('leadId'),
    nextFollowUpDate: formData.get('nextFollowUpDate'),
  });
  if (!parsed.success) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.leads)
      .set({ nextFollowUpDate: parsed.data.nextFollowUpDate })
      .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, parsed.data.leadId)));
    await tx
      .insert(schema.leadActivities)
      .values(
        activityValues(
          orgId,
          parsed.data.leadId,
          userId,
          'follow_up',
          parsed.data.nextFollowUpDate
            ? `Follow-up set for ${parsed.data.nextFollowUpDate}`
            : 'Follow-up cleared',
        ),
      );
  });

  revalidatePath(`/leads/${parsed.data.leadId}`);
  revalidatePath('/leads');
}

// ── Add note / activity ───────────────────────────────────────────────────────

export async function addLeadActivity(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = activitySchema.safeParse({
    leadId: formData.get('leadId'),
    activityType: formData.get('activityType') ?? 'note',
    summary: formData.get('summary'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Add a note.' };
  }

  try {
    await getDb()
      .insert(schema.leadActivities)
      .values(
        activityValues(
          orgId,
          parsed.data.leadId,
          userId,
          parsed.data.activityType,
          parsed.data.summary,
        ),
      );
  } catch (error) {
    logger.error('leads: add activity failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not add the note. Try again.' };
  }

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { message: 'Note added.' };
}

// ── Archive / restore ─────────────────────────────────────────────────────────

export async function archiveLead(formData: FormData): Promise<void> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };
  const leadId = z_uuid(formData.get('leadId'));
  if (!leadId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.leads)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, leadId)));
    await tx
      .insert(schema.leadActivities)
      .values(activityValues(orgId, leadId, userId, 'archived', 'Lead archived'));
  });

  revalidatePath('/leads');
  redirect('/leads');
}

export async function restoreLead(formData: FormData): Promise<void> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };
  const leadId = z_uuid(formData.get('leadId'));
  if (!leadId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.leads)
      .set({ deletedAt: null })
      .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, leadId)));
    await tx
      .insert(schema.leadActivities)
      .values(activityValues(orgId, leadId, userId, 'restored', 'Lead restored'));
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
}

// ── Convert to client + project ───────────────────────────────────────────────

export async function convertLead(formData: FormData): Promise<void> {
  const auth = await requireLeadsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };
  const leadId = z_uuid(formData.get('leadId'));
  if (!leadId) return;

  const db = getDb();
  let projectId: string | null = null;

  await db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.organizationId, orgId), eq(schema.leads.id, leadId)));
    if (!lead || lead.convertedProjectId) return; // already converted → no-op

    // 1. Client from the lead's contact details.
    const [client] = await tx
      .insert(schema.clients)
      .values({
        organizationId: orgId,
        displayName: lead.clientName || lead.leadName,
        primaryPhone: lead.phone,
        primaryEmail: lead.email,
        createdBy: userId,
      })
      .returning({ id: schema.clients.id });
    if (!client) throw new Error('client insert returned no row');

    // 2. Property from the lead's address, if present.
    let propertyId: string | null = null;
    if (lead.propertyAddress) {
      const [property] = await tx
        .insert(schema.properties)
        .values({
          organizationId: orgId,
          clientId: client.id,
          address: lead.propertyAddress,
        })
        .returning({ id: schema.properties.id });
      propertyId = property?.id ?? null;
    }

    // 3. Project with a per-org sequential number.
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
        name: lead.leadName,
        clientId: client.id,
        propertyId,
        sourceLeadId: lead.id,
        salespersonId: lead.assignedTo,
        projectType: lead.projectType,
        description: lead.description,
        createdBy: userId,
      })
      .returning({ id: schema.projects.id });
    if (!project) throw new Error('project insert returned no row');
    projectId = project.id;

    // 4. Mark the lead Won + link the project, and log the conversion on both
    // the lead timeline and the new project's timeline.
    await tx
      .update(schema.leads)
      .set({ status: 'won', convertedProjectId: project.id, clientId: client.id, propertyId })
      .where(eq(schema.leads.id, lead.id));
    await tx.insert(schema.leadActivities).values(
      activityValues(orgId, lead.id, userId, 'converted', `Converted to project ${projectNumber}`, {
        clientId: client.id,
        projectId: project.id,
      }),
    );
    await tx.insert(schema.projectActivities).values({
      organizationId: orgId,
      projectId: project.id,
      activityType: 'created',
      summary: `Created from lead “${lead.leadName}”`,
      metadata: { sourceLeadId: lead.id, clientId: client.id },
      createdBy: userId,
    });
  });

  if (projectId) {
    revalidatePath('/leads');
    revalidatePath('/projects');
    redirect(`/projects/${projectId}`);
  }
  revalidatePath(`/leads/${leadId}`);
}

/** Local uuid guard to avoid importing zod for a single field. */
function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
