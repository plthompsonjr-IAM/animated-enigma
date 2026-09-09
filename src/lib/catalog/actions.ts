'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { toNum } from './catalog-core';
import { catalogItemSchema, itemIdSchema } from './schema';

async function requireCatalogWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string; userId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'estimates:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage the cost catalog.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createCatalogItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireCatalogWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth.ctx;

  const parsed = catalogItemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  let newId: string;
  try {
    const db = getDb();
    newId = await db.transaction(async (tx) => {
      const [item] = await tx
        .insert(schema.costCatalogItems)
        .values({
          organizationId: orgId,
          name: input.name,
          trade: input.trade,
          description: input.description,
          unit: input.unit,
          defaultMaterialCost: input.defaultMaterialCost.toString(),
          defaultLaborHours: input.defaultLaborHours.toString(),
          defaultLaborRate: input.defaultLaborRate.toString(),
          equipmentCost: input.equipmentCost.toString(),
          wastePct: input.wastePct.toString(),
          vendor: input.vendor,
          vendorItemNumber: input.vendorItemNumber,
          region: input.region,
          tier: input.tier,
          lastVerifiedDate: input.lastVerifiedDate,
          notes: input.notes,
          createdBy: userId,
        })
        .returning({ id: schema.costCatalogItems.id });
      if (!item) throw new Error('insert returned no row');

      // Seed an initial price-history point if there's a cost to track.
      if (input.defaultMaterialCost > 0 || input.defaultLaborRate > 0) {
        await tx.insert(schema.catalogPriceHistory).values({
          organizationId: orgId,
          catalogItemId: item.id,
          materialCost: input.defaultMaterialCost.toString(),
          laborRate: input.defaultLaborRate.toString(),
          source: 'initial',
        });
      }
      return item.id;
    });
  } catch (error) {
    logger.error('catalog: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save the item. Try again.' };
  }

  revalidatePath('/cost-catalog');
  redirect(`/cost-catalog/${newId}/edit`);
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateCatalogItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireCatalogWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth.ctx;

  const itemId = z_uuid(formData.get('itemId'));
  if (!itemId) return { error: 'Unknown item.' };
  const parsed = catalogItemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const input = parsed.data;

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      // Load current costs to detect a price change (own org only — never global).
      const [current] = await tx
        .select({
          material: schema.costCatalogItems.defaultMaterialCost,
          rate: schema.costCatalogItems.defaultLaborRate,
        })
        .from(schema.costCatalogItems)
        .where(
          and(
            eq(schema.costCatalogItems.id, itemId),
            eq(schema.costCatalogItems.organizationId, orgId),
          ),
        );
      if (!current) throw new Error('not found in org');

      const result = await tx
        .update(schema.costCatalogItems)
        .set({
          name: input.name,
          trade: input.trade ?? null,
          description: input.description ?? null,
          unit: input.unit,
          defaultMaterialCost: input.defaultMaterialCost.toString(),
          defaultLaborHours: input.defaultLaborHours.toString(),
          defaultLaborRate: input.defaultLaborRate.toString(),
          equipmentCost: input.equipmentCost.toString(),
          wastePct: input.wastePct.toString(),
          vendor: input.vendor ?? null,
          vendorItemNumber: input.vendorItemNumber ?? null,
          region: input.region ?? null,
          tier: input.tier,
          lastVerifiedDate: input.lastVerifiedDate ?? null,
          notes: input.notes ?? null,
        })
        .where(
          and(
            eq(schema.costCatalogItems.id, itemId),
            eq(schema.costCatalogItems.organizationId, orgId),
          ),
        )
        .returning({ id: schema.costCatalogItems.id });
      if (result.length === 0) throw new Error('update touched no rows');

      const materialChanged = toNum(current.material) !== input.defaultMaterialCost;
      const rateChanged = toNum(current.rate) !== input.defaultLaborRate;
      if (materialChanged || rateChanged) {
        await tx.insert(schema.catalogPriceHistory).values({
          organizationId: orgId,
          catalogItemId: itemId,
          materialCost: input.defaultMaterialCost.toString(),
          laborRate: input.defaultLaborRate.toString(),
          source: 'edit',
        });
      }
    });
  } catch (error) {
    logger.error('catalog: update failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save changes. Try again.' };
  }

  revalidatePath('/cost-catalog');
  redirect(`/cost-catalog/${itemId}/edit`);
}

// ── Activate / delete ─────────────────────────────────────────────────────────

export async function setCatalogItemActive(formData: FormData): Promise<void> {
  const auth = await requireCatalogWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const parsed = itemIdSchema.safeParse({ itemId: formData.get('itemId') });
  if (!parsed.success) return;
  const active = formData.get('active') === 'true';

  await getDb()
    .update(schema.costCatalogItems)
    .set({ isActive: active })
    .where(
      and(
        eq(schema.costCatalogItems.id, parsed.data.itemId),
        eq(schema.costCatalogItems.organizationId, orgId),
      ),
    );

  revalidatePath('/cost-catalog');
}

export async function deleteCatalogItem(formData: FormData): Promise<void> {
  const auth = await requireCatalogWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const parsed = itemIdSchema.safeParse({ itemId: formData.get('itemId') });
  if (!parsed.success) return;

  try {
    await getDb()
      .delete(schema.costCatalogItems)
      .where(
        and(
          eq(schema.costCatalogItems.id, parsed.data.itemId),
          eq(schema.costCatalogItems.organizationId, orgId),
        ),
      );
  } catch (error) {
    // Likely referenced by an estimate line (Task 16) — deactivate instead.
    logger.warn('catalog: delete blocked', {
      message: error instanceof Error ? error.message : String(error),
    });
    await getDb()
      .update(schema.costCatalogItems)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.costCatalogItems.id, parsed.data.itemId),
          eq(schema.costCatalogItems.organizationId, orgId),
        ),
      );
  }

  revalidatePath('/cost-catalog');
  redirect('/cost-catalog');
}

function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
