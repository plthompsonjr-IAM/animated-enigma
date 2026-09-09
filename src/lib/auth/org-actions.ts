'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { publicEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getAuthContext, ACTIVE_ORG_COOKIE } from './session';
import { assertCan, can, ASSIGNABLE_ROLES, type Role } from './rbac';
import { slugify, wouldRemoveLastOwner } from './org-utils';
import {
  generateInviteToken,
  hashInviteToken,
  invitationExpiry,
  isInvitationExpired,
} from './invitations';
import type { FormState } from './actions';
import { inviteEmail } from '@/lib/email/email-core';
import { dispatchEmail } from '@/lib/email/dispatch';
import { NO_PROVIDER_MESSAGE } from '@/lib/email/provider';

export interface InviteState extends FormState {
  inviteUrl?: string;
}

const roleListSchema = z
  .array(z.enum(ASSIGNABLE_ROLES as [Role, ...Role[]]))
  .min(1, 'Select at least one role.');

async function requireUser() {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  return ctx;
}

// ── Organization creation & switching ────────────────────────────────────────

export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const name = z
    .string()
    .trim()
    .min(2, 'Enter a company name.')
    .max(120)
    .safeParse(formData.get('name'));
  if (!name.success) return { error: name.error.issues[0]?.message ?? 'Enter a company name.' };
  if (!ctx.dbAvailable) return { error: 'Database is not configured yet — see .env.example.' };

  const db = getDb();
  try {
    const orgId = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name: name.data, slug: slugify(name.data) })
        .returning({ id: schema.organizations.id });
      if (!org) throw new Error('insert returned no row');
      await tx.insert(schema.organizationMembers).values({
        organizationId: org.id,
        userId: ctx.userId!,
        roles: ['owner'],
      });
      return org.id;
    });

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, orgId, { path: '/', httpOnly: true, sameSite: 'lax' });
  } catch (error) {
    logger.error('org: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not create the organization. Try again.' };
  }

  redirect('/dashboard');
}

export async function switchOrganization(formData: FormData): Promise<void> {
  const ctx = await requireUser();
  const target = z.string().uuid().safeParse(formData.get('organizationId'));
  if (!target.success) return;

  // Only organizations the user actually belongs to are switchable.
  const membership = ctx.memberships.find((m) => m.organizationId === target.data);
  if (!membership) {
    logger.warn('org: switch rejected — not a member', { target: target.data });
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, membership.organizationId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
}

// ── Invitations ──────────────────────────────────────────────────────────────

export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await requireUser();
  if (!ctx.activeOrg) return { error: 'Create or select an organization first.' };
  if (!ctx.dbAvailable) return { error: 'Database is not configured yet.' };

  try {
    assertCan(ctx.activeOrg.roles, 'members:invite', ctx.activeOrg.extraPermissions);
  } catch {
    return { error: 'You do not have permission to invite team members.' };
  }

  const email = z.string().trim().toLowerCase().email().safeParse(formData.get('email'));
  if (!email.success) return { error: 'Enter a valid email address.' };
  const roles = roleListSchema.safeParse(formData.getAll('roles'));
  if (!roles.success)
    return { error: roles.error.issues[0]?.message ?? 'Select at least one role.' };
  // Only administrators may hand out the administrator role.
  if (roles.data.includes('owner') && !can(ctx.activeOrg.roles, 'members:manage_roles')) {
    return { error: 'Only an administrator can invite another administrator.' };
  }

  const { token, tokenHash } = generateInviteToken();
  const db = getDb();
  try {
    await db.insert(schema.invitations).values({
      organizationId: ctx.activeOrg.organizationId,
      email: email.data,
      roles: roles.data,
      tokenHash,
      invitedBy: ctx.userId,
      expiresAt: invitationExpiry(),
    });
  } catch (error) {
    logger.error('org: invitation insert failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not create the invitation. Try again.' };
  }

  const inviteUrl = `${publicEnv.appUrl}/invite/${token}`;

  // Delivery goes through the email seam — the inviter's Google account if
  // connected, the company sending address if configured, otherwise nothing.
  // The link is always returned so the inviter can share it directly whatever
  // happens here; a failed send is reported, never swallowed.
  const message = inviteEmail({
    orgName: ctx.activeOrg.organizationName,
    inviteUrl,
    expiresInDays: 7,
  });
  message.to = [email.data];
  const sent = await dispatchEmail({
    organizationId: ctx.activeOrg.organizationId,
    userId: ctx.userId!,
    senderName: ctx.activeOrg.organizationName,
    kind: 'invitation',
    relatedId: null,
    projectId: null,
    clientId: null,
    message,
  });

  revalidatePath('/settings/team');
  if (sent.ok) {
    return { message: `Invitation emailed to ${email.data}.`, inviteUrl };
  }
  if (sent.error === NO_PROVIDER_MESSAGE) {
    return { message: `Invitation created for ${email.data}. Share the link below.`, inviteUrl };
  }
  return {
    message: `Invitation created for ${email.data}, but the email didn’t send: ${sent.error} Share the link below instead.`,
    inviteUrl,
  };
}

export async function acceptInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = z.string().min(10).safeParse(formData.get('token'));
  if (!token.success) return { error: 'This invitation link is not valid.' };

  const ctx = await getAuthContext();
  if (!ctx.userId) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token.data}`)}`);
  }
  if (!ctx.dbAvailable) return { error: 'Database is not configured yet.' };

  const db = getDb();
  const [invitation] = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.tokenHash, hashInviteToken(token.data)));

  if (!invitation || invitation.status !== 'pending') {
    return { error: 'This invitation is no longer valid.' };
  }
  if (isInvitationExpired(invitation.expiresAt)) {
    await db
      .update(schema.invitations)
      .set({ status: 'expired' })
      .where(eq(schema.invitations.id, invitation.id));
    return { error: 'This invitation has expired. Ask for a new one.' };
  }
  if ((ctx.email ?? '').toLowerCase() !== invitation.email.toLowerCase()) {
    return {
      error: `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, invitation.organizationId),
            eq(schema.organizationMembers.userId, ctx.userId!),
          ),
        );

      if (existing) {
        const merged = Array.from(new Set([...existing.roles, ...invitation.roles])) as Role[];
        await tx
          .update(schema.organizationMembers)
          .set({ roles: merged, isActive: true })
          .where(eq(schema.organizationMembers.id, existing.id));
      } else {
        await tx.insert(schema.organizationMembers).values({
          organizationId: invitation.organizationId,
          userId: ctx.userId!,
          roles: invitation.roles as Role[],
          invitedBy: invitation.invitedBy,
        });
      }

      await tx
        .update(schema.invitations)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(schema.invitations.id, invitation.id));
    });
  } catch (error) {
    logger.error('org: invitation acceptance failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not accept the invitation. Try again.' };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, invitation.organizationId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });

  redirect('/dashboard');
}

// ── Role management ──────────────────────────────────────────────────────────

export async function updateMemberRoles(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser();
  if (!ctx.activeOrg || !ctx.dbAvailable) return { error: 'No active organization.' };

  try {
    assertCan(ctx.activeOrg.roles, 'members:manage_roles', ctx.activeOrg.extraPermissions);
  } catch {
    return { error: 'You do not have permission to change roles.' };
  }

  const memberId = z.string().uuid().safeParse(formData.get('memberId'));
  if (!memberId.success) return { error: 'Unknown member.' };
  const roles = roleListSchema.safeParse(formData.getAll('roles'));
  if (!roles.success)
    return { error: roles.error.issues[0]?.message ?? 'Select at least one role.' };

  const db = getDb();
  const members = await db
    .select({
      memberId: schema.organizationMembers.id,
      roles: schema.organizationMembers.roles,
      isActive: schema.organizationMembers.isActive,
    })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.organizationId, ctx.activeOrg.organizationId));

  // The target must belong to the caller's active organization.
  if (!members.some((m) => m.memberId === memberId.data)) {
    return { error: 'That member is not part of this organization.' };
  }
  if (
    wouldRemoveLastOwner(
      members.map((m) => ({ ...m, roles: m.roles as Role[] })),
      memberId.data,
      roles.data,
    )
  ) {
    return { error: 'An organization must keep at least one administrator.' };
  }

  await db
    .update(schema.organizationMembers)
    .set({ roles: roles.data })
    .where(
      and(
        eq(schema.organizationMembers.id, memberId.data),
        eq(schema.organizationMembers.organizationId, ctx.activeOrg.organizationId),
      ),
    );

  revalidatePath('/settings/team');
  return { message: 'Roles updated.' };
}

const orgSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Company name is required.').max(200),
  tagline: z.string().trim().max(200).optional(),
  timezone: z.string().trim().min(1).max(64),
  signatureDisclosure: z.string().trim().max(5000).optional(),
  contractTerms: z.string().trim().max(50000).optional(),
});

/**
 * Organization settings: branding, timezone, and the two legal texts the
 * client-facing documents depend on — the e-signature disclosure (Task 19) and
 * the contract terms & conditions (Task 20). Blank values fall back to the
 * built-in defaults rather than producing an empty clause.
 */
export async function updateOrganizationSettings(
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
    return { error: 'You do not have permission to change organization settings.' };
  }

  const parsed = orgSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form.' };
  }
  const { name, tagline, timezone, signatureDisclosure, contractTerms } = parsed.data;

  try {
    const db = getDb();
    await db
      .update(schema.organizations)
      .set({
        name,
        tagline: tagline && tagline.length > 0 ? tagline : null,
        timezone,
        signatureDisclosure:
          signatureDisclosure && signatureDisclosure.length > 0 ? signatureDisclosure : null,
        contractTerms: contractTerms && contractTerms.length > 0 ? contractTerms : null,
      })
      .where(eq(schema.organizations.id, ctx.activeOrg.organizationId));
  } catch (error) {
    logger.error('org: settings update failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong saving your settings.' };
  }

  revalidatePath('/settings');
  return { message: 'Settings saved.' };
}
