'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import {
  clientInputSchema,
  contactInputSchema,
  propertyInputSchema,
  addressFromInput,
} from './schema';
import { duplicateCandidates } from './queries';
import { findDuplicates, type DuplicateMatch } from './clients-core';

/** Form state for client actions; extends the shared shape with duplicate hits. */
export interface ClientFormState {
  error?: string;
  message?: string;
  duplicates?: DuplicateMatch[];
}

async function requireClientsWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'clients:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage clients.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId } };
}

// ── Client create / update ───────────────────────────────────────────────────

export async function createClient(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = { orgId: auth.ctx.orgId, userId: auth.ctx.userId };

  const parsed = clientInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  // Duplicate check — a warning, not a wall. "Create anyway" re-submits with
  // confirmDuplicate set after the office reviewed the matches.
  if (!input.confirmDuplicate) {
    try {
      const candidates = await duplicateCandidates(orgId, {
        displayName: input.displayName,
        phone: input.primaryPhone,
        email: input.primaryEmail,
      });
      const duplicates = findDuplicates(candidates, {
        displayName: input.displayName,
        phone: input.primaryPhone,
        email: input.primaryEmail,
      });
      if (duplicates.length > 0) {
        return {
          error: 'This looks like an existing client. Review the matches below.',
          duplicates,
        };
      }
    } catch (error) {
      logger.error('clients: duplicate check failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      // Fail open: a broken duplicate check must not block intake.
    }
  }

  let newId: string;
  try {
    const db = getDb();
    const [client] = await db
      .insert(schema.clients)
      .values({
        organizationId: orgId,
        clientType: input.clientType,
        displayName: input.displayName,
        companyName: input.companyName,
        primaryPhone: input.primaryPhone,
        primaryEmail: input.primaryEmail,
        billingAddress: addressFromInput(input),
        preferredContactMethod: input.preferredContactMethod,
        tags: input.tags,
        notes: input.notes,
        createdBy: userId,
      })
      .returning({ id: schema.clients.id });
    if (!client) throw new Error('insert returned no row');
    newId = client.id;
  } catch (error) {
    logger.error('clients: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not create the client. Try again.' };
  }

  revalidatePath('/clients');
  redirect(`/clients/${newId}`);
}

export async function updateClient(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return { error: auth.error };
  const orgId = auth.ctx.orgId;

  const clientId = z_uuid(formData.get('clientId'));
  if (!clientId) return { error: 'Unknown client.' };
  const parsed = clientInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  try {
    const db = getDb();
    const result = await db
      .update(schema.clients)
      .set({
        clientType: input.clientType,
        displayName: input.displayName,
        companyName: input.companyName ?? null,
        primaryPhone: input.primaryPhone ?? null,
        primaryEmail: input.primaryEmail ?? null,
        billingAddress: addressFromInput(input),
        preferredContactMethod: input.preferredContactMethod ?? null,
        tags: input.tags,
        notes: input.notes ?? null,
      })
      .where(and(eq(schema.clients.organizationId, orgId), eq(schema.clients.id, clientId)))
      .returning({ id: schema.clients.id });
    if (result.length === 0) return { error: 'Client not found.' };
  } catch (error) {
    logger.error('clients: update failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save changes. Try again.' };
  }

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

// ── Archive / restore ────────────────────────────────────────────────────────

export async function archiveClient(formData: FormData): Promise<void> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const clientId = z_uuid(formData.get('clientId'));
  if (!clientId) return;

  await getDb()
    .update(schema.clients)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(schema.clients.organizationId, orgId), eq(schema.clients.id, clientId)));

  revalidatePath('/clients');
  redirect('/clients');
}

export async function restoreClient(formData: FormData): Promise<void> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const clientId = z_uuid(formData.get('clientId'));
  if (!clientId) return;

  await getDb()
    .update(schema.clients)
    .set({ deletedAt: null })
    .where(and(eq(schema.clients.organizationId, orgId), eq(schema.clients.id, clientId)));

  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
}

// ── Contacts ─────────────────────────────────────────────────────────────────

export async function addContact(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return { error: auth.error };
  const orgId = auth.ctx.orgId;

  const parsed = contactInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the contact and try again.' };
  }
  const input = parsed.data;

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      // The client row is the tenancy anchor — verify it belongs to this org.
      const [client] = await tx
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(
          and(eq(schema.clients.organizationId, orgId), eq(schema.clients.id, input.clientId)),
        );
      if (!client) throw new Error('client not found in org');

      if (input.isPrimary) {
        await tx
          .update(schema.clientContacts)
          .set({ isPrimary: false })
          .where(
            and(
              eq(schema.clientContacts.organizationId, orgId),
              eq(schema.clientContacts.clientId, input.clientId),
            ),
          );
      }
      await tx.insert(schema.clientContacts).values({
        organizationId: orgId,
        clientId: input.clientId,
        name: input.name,
        role: input.role,
        phone: input.phone,
        email: input.email,
        isPrimary: input.isPrimary,
      });
    });
  } catch (error) {
    logger.error('clients: add contact failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not add the contact. Try again.' };
  }

  revalidatePath(`/clients/${input.clientId}`);
  return { message: 'Contact added.' };
}

export async function deleteContact(formData: FormData): Promise<void> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const contactId = z_uuid(formData.get('contactId'));
  const clientId = z_uuid(formData.get('clientId'));
  if (!contactId) return;

  await getDb()
    .delete(schema.clientContacts)
    .where(
      and(eq(schema.clientContacts.organizationId, orgId), eq(schema.clientContacts.id, contactId)),
    );

  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function makePrimaryContact(formData: FormData): Promise<void> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const contactId = z_uuid(formData.get('contactId'));
  const clientId = z_uuid(formData.get('clientId'));
  if (!contactId || !clientId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.clientContacts)
      .set({ isPrimary: false })
      .where(
        and(
          eq(schema.clientContacts.organizationId, orgId),
          eq(schema.clientContacts.clientId, clientId),
        ),
      );
    await tx
      .update(schema.clientContacts)
      .set({ isPrimary: true })
      .where(
        and(
          eq(schema.clientContacts.organizationId, orgId),
          eq(schema.clientContacts.id, contactId),
        ),
      );
  });

  revalidatePath(`/clients/${clientId}`);
}

// ── Properties ───────────────────────────────────────────────────────────────

export async function createProperty(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return { error: auth.error };
  const orgId = auth.ctx.orgId;

  const parsed = propertyInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the property and try again.' };
  }
  const input = parsed.data;
  const address = addressFromInput(input);
  if (!address) return { error: 'Enter the street address.' };

  try {
    const db = getDb();
    // Verify the client belongs to this org before attaching a property.
    const [client] = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.organizationId, orgId), eq(schema.clients.id, input.clientId)));
    if (!client) return { error: 'Client not found.' };

    await db.insert(schema.properties).values({
      organizationId: orgId,
      clientId: input.clientId,
      address,
      propertyType: input.propertyType,
      squareFootage: input.squareFootage,
      yearBuilt: input.yearBuilt,
      occupancyStatus: input.occupancyStatus,
      accessInstructions: input.accessInstructions,
      utilityInfo: input.utilities ? { summary: input.utilities } : null,
      permitJurisdiction: input.permitJurisdiction,
      notes: input.notes,
    });
  } catch (error) {
    logger.error('clients: create property failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not add the property. Try again.' };
  }

  revalidatePath(`/clients/${input.clientId}`);
  redirect(`/clients/${input.clientId}`);
}

export async function updateProperty(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return { error: auth.error };
  const orgId = auth.ctx.orgId;

  const propertyId = z_uuid(formData.get('propertyId'));
  if (!propertyId) return { error: 'Unknown property.' };
  const parsed = propertyInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the property and try again.' };
  }
  const input = parsed.data;
  const address = addressFromInput(input);
  if (!address) return { error: 'Enter the street address.' };

  try {
    const result = await getDb()
      .update(schema.properties)
      .set({
        address,
        propertyType: input.propertyType ?? null,
        squareFootage: input.squareFootage ?? null,
        yearBuilt: input.yearBuilt ?? null,
        occupancyStatus: input.occupancyStatus ?? null,
        accessInstructions: input.accessInstructions ?? null,
        utilityInfo: input.utilities ? { summary: input.utilities } : null,
        permitJurisdiction: input.permitJurisdiction ?? null,
        notes: input.notes ?? null,
      })
      .where(and(eq(schema.properties.organizationId, orgId), eq(schema.properties.id, propertyId)))
      .returning({ id: schema.properties.id });
    if (result.length === 0) return { error: 'Property not found.' };
  } catch (error) {
    logger.error('clients: update property failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save the property. Try again.' };
  }

  revalidatePath(`/clients/${input.clientId}`);
  redirect(`/clients/${input.clientId}`);
}

export async function deleteProperty(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const auth = await requireClientsWrite();
  if (!auth.ok) return { error: auth.error };
  const orgId = auth.ctx.orgId;

  const propertyId = z_uuid(formData.get('propertyId'));
  const clientId = z_uuid(formData.get('clientId'));
  if (!propertyId) return { error: 'Unknown property.' };

  try {
    await getDb()
      .delete(schema.properties)
      .where(
        and(eq(schema.properties.organizationId, orgId), eq(schema.properties.id, propertyId)),
      );
  } catch (error) {
    // Most likely a FK restriction: the property is referenced by a lead/project.
    logger.warn('clients: delete property blocked', {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      error: 'This property is linked to a lead or project and can’t be deleted.',
    };
  }

  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}`);
  }
  return { message: 'Property deleted.' };
}

/** Local uuid guard to avoid importing zod for a single field. */
function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
