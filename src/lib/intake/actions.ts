'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import { publicIntakeSchema, quickIntakeSchema } from './schema';
import { screenForSpam, composeIntakeDescription } from './intake-core';

export interface IntakeFormState {
  ok?: boolean;
  error?: string;
}

// ── Public intake (no authentication) ────────────────────────────────────────

/**
 * Handles the shareable public form. Creates a lead in the organization the
 * slug resolves to. Spam-screened submissions are dropped silently — the bot
 * still sees "thanks", the pipeline stays clean.
 */
export async function submitPublicIntake(
  _prev: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const slug = String(formData.get('orgSlug') ?? '');
  if (!slug) return { error: 'This form link is incomplete.' };

  const parsed = publicIntakeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form and try again.' };
  }
  const input = parsed.data;

  // Spam screen: honeypot, instant submit, link stuffing.
  const startedAt = Number(input.startedAt);
  const elapsedSeconds = Number.isFinite(startedAt) ? (Date.now() - startedAt) / 1000 : null;
  const verdict = screenForSpam({
    honeypot: input.website,
    elapsedSeconds,
    text: [input.description, input.name].filter(Boolean).join(' '),
  });
  if (verdict.spam) {
    logger.warn('intake: submission dropped by spam screen', { reason: verdict.reason });
    return { ok: true }; // Indistinguishable from success on purpose.
  }

  try {
    const db = getDb();
    const [org] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, slug));
    if (!org) return { error: 'This form is no longer available.' };

    await db.transaction(async (tx) => {
      const [lead] = await tx
        .insert(schema.leads)
        .values({
          organizationId: org.id,
          leadName: `${input.name} — ${input.projectType ?? 'New inquiry'}`,
          clientName: input.name,
          phone: input.phone,
          email: input.email,
          propertyAddress: input.address ? { line1: input.address } : null,
          projectType: input.projectType,
          leadSource: 'Website form',
          description: composeIntakeDescription(input),
          status: 'new',
          priority: 'medium',
        })
        .returning({ id: schema.leads.id });
      if (!lead) throw new Error('insert returned no row');
      await tx.insert(schema.leadActivities).values({
        organizationId: org.id,
        leadId: lead.id,
        activityType: 'created',
        summary: 'Submitted through the public intake form',
        metadata: {
          source: 'public_intake',
          heardAbout: input.heardAbout ?? null,
          timeline: input.timeline ?? null,
          budgetRange: input.budgetRange ?? null,
        },
        createdBy: null,
      });
    });
  } catch (error) {
    logger.error('intake: public submission failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong sending your request. Please call us instead.' };
  }

  revalidatePath('/leads');
  return { ok: true };
}

// ── Internal quick intake (phone calls) ──────────────────────────────────────

export async function quickIntake(
  _prev: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'leads:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { error: 'You do not have permission to capture leads.' };
  }
  const orgId = ctx.activeOrg.organizationId;

  const parsed = quickIntakeSchema.safeParse(Object.fromEntries(formData));
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
          leadName: `${input.clientName} — ${input.projectType ?? 'New inquiry'}`,
          clientName: input.clientName,
          phone: input.phone,
          email: input.email,
          propertyAddress: input.propertyAddress ? { line1: input.propertyAddress } : null,
          projectType: input.projectType,
          leadSource: input.leadSource ?? 'Phone Call',
          description: input.description,
          status: 'new',
          priority: input.priority,
          nextFollowUpDate: input.nextFollowUpDate,
          createdBy: ctx.userId,
        })
        .returning({ id: schema.leads.id });
      if (!lead) throw new Error('insert returned no row');
      await tx.insert(schema.leadActivities).values({
        organizationId: orgId,
        leadId: lead.id,
        activityType: 'created',
        summary: 'Captured via quick intake',
        metadata: { source: 'quick_intake' },
        createdBy: ctx.userId,
      });
      return lead.id;
    });
  } catch (error) {
    logger.error('intake: quick intake failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save the lead. Try again.' };
  }

  revalidatePath('/leads');
  if (input.next === 'another') {
    redirect(`/leads/intake?saved=${encodeURIComponent(input.clientName)}`);
  }
  redirect(`/leads/${newId}`);
}
