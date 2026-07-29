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
  canTransition,
  costChange,
  formatChangeOrderNumber,
  isEditable,
  isItemDirection,
  validateChangeOrder,
  type ChangeOrderItemInput,
  type ChangeOrderStatus,
  type ItemDirection,
} from './change-orders-core';

async function requireFinancialsWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string; userId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'financials:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage change orders.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

/** Start a draft change order against a contract's project. */
export async function createChangeOrder(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const contractId = uuidOrNull(formData.get('contractId'));
  if (!contractId) return;

  let changeOrderId: string | null = null;
  try {
    const db = getDb();
    changeOrderId = await db.transaction(async (tx) => {
      const [contract] = await tx
        .select({ id: schema.contracts.id, projectId: schema.contracts.projectId })
        .from(schema.contracts)
        .where(
          and(eq(schema.contracts.organizationId, orgId), eq(schema.contracts.id, contractId)),
        );
      if (!contract) throw new Error('contract not in org');

      const year = new Date().getUTCFullYear();
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.changeOrders)
        .where(eq(schema.changeOrders.organizationId, orgId))) as [{ count: number }];

      const [created] = await tx
        .insert(schema.changeOrders)
        .values({
          organizationId: orgId,
          projectId: contract.projectId,
          contractId: contract.id,
          changeOrderNumber: formatChangeOrderNumber(year, count + 1),
          status: 'draft',
          createdBy: userId,
        })
        .returning({ id: schema.changeOrders.id });
      if (!created) throw new Error('change order insert failed');
      return created.id;
    });
  } catch (error) {
    logger.error('change-orders: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (changeOrderId) {
    revalidatePath(`/contracts/${contractId}`);
    redirect(`/change-orders/${changeOrderId}`);
  }
}

/**
 * Save the change order's details and line items, recomputing the net cost
 * change from the items so the stored total can never drift from its lines.
 * Draft/internal-review only — the DB enforces this too.
 */
export async function saveChangeOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth.ctx;

  const changeOrderId = uuidOrNull(formData.get('changeOrderId'));
  if (!changeOrderId) return { error: 'Change order not found.' };

  const reason = String(formData.get('reason') ?? '').trim();
  const requestedBy = String(formData.get('requestedBy') ?? '').trim();
  const clientExplanation = String(formData.get('clientExplanation') ?? '').trim();
  const internalNotes = String(formData.get('internalNotes') ?? '').trim();
  const scheduleChangeDays = Number.parseInt(String(formData.get('scheduleChangeDays') ?? '0'), 10);
  const days = Number.isFinite(scheduleChangeDays) ? scheduleChangeDays : 0;

  const items = readItems(formData);
  const check = validateChangeOrder(items, days);
  if (!check.ok) return { error: check.error ?? 'Please check the change order.' };

  try {
    const db = getDb();
    const [existing] = await db
      .select({ id: schema.changeOrders.id, status: schema.changeOrders.status })
      .from(schema.changeOrders)
      .where(
        and(
          eq(schema.changeOrders.organizationId, orgId),
          eq(schema.changeOrders.id, changeOrderId),
        ),
      );
    if (!existing) return { error: 'Change order not found.' };
    if (!isEditable(existing.status as ChangeOrderStatus)) {
      return { error: 'This change order has left draft and can no longer be edited.' };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.changeOrders)
        .set({
          reason: reason || null,
          requestedBy: requestedBy || null,
          clientExplanation: clientExplanation || null,
          internalNotes: internalNotes || null,
          scheduleChangeDays: days,
          costChange: String(costChange(items)),
        })
        .where(eq(schema.changeOrders.id, changeOrderId));

      await tx
        .delete(schema.changeOrderItems)
        .where(eq(schema.changeOrderItems.changeOrderId, changeOrderId));

      await tx.insert(schema.changeOrderItems).values(
        items.map((item, i) => ({
          organizationId: orgId,
          changeOrderId,
          direction: item.direction,
          description: item.description.trim(),
          // Stored as a positive magnitude; direction carries the sign.
          amount: String(Math.abs(Number(item.amount ?? 0) || 0)),
          sortOrder: i,
        })),
      );
    });
  } catch (error) {
    logger.error('change-orders: save failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong saving the change order.' };
  }

  revalidatePath(`/change-orders/${changeOrderId}`);
  return { message: 'Change order saved.' };
}

/**
 * Advance the change order. Approving stamps the approval time; the contract's
 * signed value is deliberately left untouched — the revised sum is derived.
 */
export async function changeChangeOrderStatus(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId } = auth.ctx;

  const changeOrderId = uuidOrNull(formData.get('changeOrderId'));
  const next = String(formData.get('status') ?? '') as ChangeOrderStatus;
  if (!changeOrderId) return;

  try {
    const db = getDb();
    const [current] = await db
      .select({
        id: schema.changeOrders.id,
        status: schema.changeOrders.status,
        contractId: schema.changeOrders.contractId,
        costChange: schema.changeOrders.costChange,
      })
      .from(schema.changeOrders)
      .where(
        and(
          eq(schema.changeOrders.organizationId, orgId),
          eq(schema.changeOrders.id, changeOrderId),
        ),
      );
    if (!current) return;

    const from = current.status as ChangeOrderStatus;
    if (!canTransition(from, next)) return;

    const now = new Date();
    await db
      .update(schema.changeOrders)
      .set({
        status: next,
        ...(next === 'approved' ? { approvedAt: now } : {}),
        ...(next === 'incorporated' ? { lockedAt: now } : {}),
      })
      .where(eq(schema.changeOrders.id, changeOrderId));

    if (current.contractId) revalidatePath(`/contracts/${current.contractId}`);
  } catch (error) {
    logger.error('change-orders: status change failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  revalidatePath(`/change-orders/${changeOrderId}`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function readItems(formData: FormData): ChangeOrderItemInput[] {
  const directions = formData.getAll('itemDirection').map(String);
  const descriptions = formData.getAll('itemDescription').map(String);
  const amounts = formData.getAll('itemAmount').map(String);

  return descriptions
    .map((description, i) => ({
      direction: (isItemDirection(directions[i] ?? '') ? directions[i] : 'added') as ItemDirection,
      description,
      amount: amounts[i] ?? '',
    }))
    .filter((item) => item.description.trim().length > 0 || item.amount !== '');
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
