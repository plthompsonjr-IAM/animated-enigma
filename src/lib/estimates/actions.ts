'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, asc, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { toNum } from '@/lib/catalog/catalog-core';
import {
  isEditable,
  canTransition,
  computeEstimate,
  computeLineCost,
  type VersionStatus,
} from './estimate-core';
import {
  createEstimateSchema,
  addCatalogLineSchema,
  lineSchema,
  updateLineSchema,
  ratesSchema,
  statusChangeSchema,
} from './schema';

async function requireEstimateWrite(): Promise<
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
    return { ok: false, error: 'You do not have permission to edit estimates.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function versionStatus(
  tx: Tx,
  orgId: string,
  versionId: string,
): Promise<VersionStatus | null> {
  const [row] = await tx
    .select({ status: schema.estimateVersions.status })
    .from(schema.estimateVersions)
    .where(
      and(
        eq(schema.estimateVersions.organizationId, orgId),
        eq(schema.estimateVersions.id, versionId),
      ),
    );
  return row ? (row.status as VersionStatus) : null;
}

async function versionIdForLine(tx: Tx, orgId: string, lineId: string): Promise<string | null> {
  const [row] = await tx
    .select({ versionId: schema.estimateLineItems.estimateVersionId })
    .from(schema.estimateLineItems)
    .where(
      and(
        eq(schema.estimateLineItems.organizationId, orgId),
        eq(schema.estimateLineItems.id, lineId),
      ),
    );
  return row?.versionId ?? null;
}

/** Recompute the version's stored roll-up from its lines + rates. */
async function recompute(tx: Tx, orgId: string, versionId: string): Promise<void> {
  const [version] = await tx
    .select({
      overheadPct: schema.estimateVersions.overheadPct,
      profitPct: schema.estimateVersions.profitPct,
      taxRate: schema.estimateVersions.taxRate,
    })
    .from(schema.estimateVersions)
    .where(
      and(
        eq(schema.estimateVersions.organizationId, orgId),
        eq(schema.estimateVersions.id, versionId),
      ),
    );
  if (!version) return;

  const lines = await tx
    .select({
      lineType: schema.estimateLineItems.lineType,
      quantity: schema.estimateLineItems.quantity,
      unitCost: schema.estimateLineItems.unitCost,
      wasteFactorPct: schema.estimateLineItems.wasteFactorPct,
      taxable: schema.estimateLineItems.taxable,
    })
    .from(schema.estimateLineItems)
    .where(
      and(
        eq(schema.estimateLineItems.organizationId, orgId),
        eq(schema.estimateLineItems.estimateVersionId, versionId),
      ),
    );

  const totals = computeEstimate(
    lines.map((l) => ({
      lineType: l.lineType,
      quantity: l.quantity,
      unitCost: l.unitCost,
      wasteFactorPct: l.wasteFactorPct,
      taxable: l.taxable,
    })),
    { overheadPct: version.overheadPct, profitPct: version.profitPct, taxRate: version.taxRate },
  );

  await tx
    .update(schema.estimateVersions)
    .set({
      materialSubtotal: totals.materialSubtotal.toString(),
      laborSubtotal: totals.laborSubtotal.toString(),
      equipmentSubtotal: totals.equipmentSubtotal.toString(),
      subcontractorSubtotal: totals.subcontractorSubtotal.toString(),
      directCost: totals.directCost.toString(),
      overheadAmount: totals.overheadAmount.toString(),
      profitAmount: totals.profitAmount.toString(),
      taxAmount: totals.taxAmount.toString(),
      finalPrice: totals.finalPrice.toString(),
      grossMarginPct: totals.grossMarginPct.toString(),
      markupPct: totals.markupPct.toString(),
    })
    .where(eq(schema.estimateVersions.id, versionId));
}

// ── Create estimate ───────────────────────────────────────────────────────────

export async function createEstimate(formData: FormData): Promise<void> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const parsed = createEstimateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { projectId, name, scopeVersionId } = parsed.data;

  let newId: string | null = null;
  try {
    const db = getDb();
    newId = await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
      if (!project) throw new Error('project not in org');

      const [maxRow] = (await tx
        .select({
          max: sql<number>`coalesce(max(${schema.estimateVersions.versionNumber}), 0)::int`,
        })
        .from(schema.estimateVersions)
        .where(
          and(
            eq(schema.estimateVersions.organizationId, orgId),
            eq(schema.estimateVersions.projectId, projectId),
          ),
        )) as [{ max: number }];
      const [version] = await tx
        .insert(schema.estimateVersions)
        .values({
          organizationId: orgId,
          projectId,
          scopeVersionId: scopeVersionId ?? null,
          versionNumber: (maxRow?.max ?? 0) + 1,
          name: name ?? null,
          status: 'draft',
          createdBy: userId,
        })
        .returning({ id: schema.estimateVersions.id });
      return version?.id ?? null;
    });
  } catch (error) {
    logger.error('estimates: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (newId) {
    revalidatePath(`/projects/${projectId}/estimate`);
    redirect(`/projects/${projectId}/estimate?v=${newId}`);
  }
}

// ── Lines ─────────────────────────────────────────────────────────────────────

export async function addCatalogLine(formData: FormData): Promise<void> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const projectId = pathProjectId(formData);

  const parsed = addCatalogLineSchema.safeParse({
    estimateVersionId: formData.get('estimateVersionId'),
    catalogItemId: formData.get('catalogItemId'),
    quantity: formData.get('quantity'),
  });
  if (!parsed.success) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const status = await versionStatus(tx, orgId, parsed.data.estimateVersionId);
    if (!status || !isEditable(status)) return;

    // Catalog item must be visible (own or global).
    const [item] = await tx
      .select()
      .from(schema.costCatalogItems)
      .where(eq(schema.costCatalogItems.id, parsed.data.catalogItemId));
    if (!item || (item.organizationId !== null && item.organizationId !== orgId)) return;

    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${schema.estimateLineItems.sortOrder}), -1)::int` })
      .from(schema.estimateLineItems)
      .where(
        and(
          eq(schema.estimateLineItems.organizationId, orgId),
          eq(schema.estimateLineItems.estimateVersionId, parsed.data.estimateVersionId),
        ),
      )) as [{ max: number }];
    let order = (max ?? -1) + 1;

    const materialUnit = toNum(item.defaultMaterialCost) * (1 + toNum(item.wastePct));
    const laborUnit = toNum(item.defaultLaborHours) * toNum(item.defaultLaborRate);
    const equipUnit = toNum(item.equipmentCost);

    // One line per non-zero cost component so subtotals stay accurate.
    const components: {
      type: 'material' | 'labor' | 'equipment';
      unit: number;
      taxable: boolean;
      note: string;
    }[] = [];
    if (materialUnit > 0)
      components.push({ type: 'material', unit: materialUnit, taxable: true, note: 'material' });
    if (laborUnit > 0)
      components.push({ type: 'labor', unit: laborUnit, taxable: false, note: 'labor' });
    if (equipUnit > 0)
      components.push({ type: 'equipment', unit: equipUnit, taxable: true, note: 'equipment' });
    // A zero-cost item still gets one placeholder material line.
    if (components.length === 0)
      components.push({ type: 'material', unit: 0, taxable: true, note: 'material' });

    for (const c of components) {
      const lineCost = computeLineCost({
        lineType: c.type,
        quantity: parsed.data.quantity,
        unitCost: c.unit,
        wasteFactorPct: 0,
      });
      await tx.insert(schema.estimateLineItems).values({
        organizationId: orgId,
        estimateVersionId: parsed.data.estimateVersionId,
        catalogItemId: item.id,
        category: item.trade,
        description: components.length > 1 ? `${item.name} — ${c.note}` : item.name,
        lineType: c.type,
        quantity: parsed.data.quantity.toString(),
        unit: item.unit,
        unitCost: c.unit.toString(),
        wasteFactorPct: '0',
        taxable: c.taxable,
        lineCost: lineCost.toString(),
        sortOrder: order++,
      });
    }

    await recompute(tx, orgId, parsed.data.estimateVersionId);
  });

  if (projectId) revalidatePath(`/projects/${projectId}/estimate`);
}

export async function addLine(formData: FormData): Promise<void> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const projectId = pathProjectId(formData);

  const parsed = lineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const input = parsed.data;

  const db = getDb();
  await db.transaction(async (tx) => {
    const status = await versionStatus(tx, orgId, input.estimateVersionId);
    if (!status || !isEditable(status)) return;

    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${schema.estimateLineItems.sortOrder}), -1)::int` })
      .from(schema.estimateLineItems)
      .where(
        and(
          eq(schema.estimateLineItems.organizationId, orgId),
          eq(schema.estimateLineItems.estimateVersionId, input.estimateVersionId),
        ),
      )) as [{ max: number }];

    const lineCost = computeLineCost(input);
    await tx.insert(schema.estimateLineItems).values({
      organizationId: orgId,
      estimateVersionId: input.estimateVersionId,
      description: input.description,
      lineType: input.lineType,
      quantity: input.quantity.toString(),
      unit: input.unit,
      unitCost: input.unitCost.toString(),
      wasteFactorPct: input.wasteFactorPct.toString(),
      taxable: input.taxable,
      lineCost: lineCost.toString(),
      sortOrder: (max ?? -1) + 1,
    });
    await recompute(tx, orgId, input.estimateVersionId);
  });

  if (projectId) revalidatePath(`/projects/${projectId}/estimate`);
}

export async function updateLine(formData: FormData): Promise<void> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const projectId = pathProjectId(formData);

  const parsed = updateLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const input = parsed.data;

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForLine(tx, orgId, input.lineId);
    if (!versionId) return;
    const status = await versionStatus(tx, orgId, versionId);
    if (!status || !isEditable(status)) return;

    const lineCost = computeLineCost(input);
    await tx
      .update(schema.estimateLineItems)
      .set({
        description: input.description,
        lineType: input.lineType,
        quantity: input.quantity.toString(),
        unit: input.unit,
        unitCost: input.unitCost.toString(),
        wasteFactorPct: input.wasteFactorPct.toString(),
        taxable: input.taxable,
        lineCost: lineCost.toString(),
      })
      .where(
        and(
          eq(schema.estimateLineItems.organizationId, orgId),
          eq(schema.estimateLineItems.id, input.lineId),
        ),
      );
    await recompute(tx, orgId, versionId);
  });

  if (projectId) revalidatePath(`/projects/${projectId}/estimate`);
}

export async function deleteLine(formData: FormData): Promise<void> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const projectId = pathProjectId(formData);
  const lineId = z_uuid(formData.get('lineId'));
  if (!lineId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForLine(tx, orgId, lineId);
    if (!versionId) return;
    const status = await versionStatus(tx, orgId, versionId);
    if (!status || !isEditable(status)) return;
    await tx
      .delete(schema.estimateLineItems)
      .where(
        and(
          eq(schema.estimateLineItems.organizationId, orgId),
          eq(schema.estimateLineItems.id, lineId),
        ),
      );
    await recompute(tx, orgId, versionId);
  });

  if (projectId) revalidatePath(`/projects/${projectId}/estimate`);
}

// ── Rates / naming ──────────────────────────────────────────────────────────

export async function updateRates(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return { error: auth.error };
  const orgId = auth.ctx.orgId;
  const projectId = pathProjectId(formData);

  const parsed = ratesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the rates and try again.' };
  }
  const input = parsed.data;

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const status = await versionStatus(tx, orgId, input.estimateVersionId);
      if (!status || !isEditable(status)) throw new Error('not editable');
      await tx
        .update(schema.estimateVersions)
        .set({
          overheadPct: input.overheadPct.toString(),
          profitPct: input.profitPct.toString(),
          taxRate: input.taxRate.toString(),
          name: input.name ?? null,
        })
        .where(
          and(
            eq(schema.estimateVersions.organizationId, orgId),
            eq(schema.estimateVersions.id, input.estimateVersionId),
          ),
        );
      await recompute(tx, orgId, input.estimateVersionId);
    });
  } catch (error) {
    logger.error('estimates: rates update failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save. The estimate may be locked.' };
  }

  if (projectId) revalidatePath(`/projects/${projectId}/estimate`);
  return { message: 'Saved.' };
}

// ── Version lifecycle ─────────────────────────────────────────────────────────

export async function changeEstimateStatus(formData: FormData): Promise<void> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;
  const projectId = pathProjectId(formData);

  const parsed = statusChangeSchema.safeParse({
    versionId: formData.get('versionId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const from = await versionStatus(tx, orgId, parsed.data.versionId);
    if (!from || !canTransition(from, parsed.data.status)) return;
    const patch: Record<string, unknown> = { status: parsed.data.status };
    if (parsed.data.status === 'approved') patch.approvedBy = userId;
    if (parsed.data.status === 'locked') patch.lockedAt = sql`now()`;
    await tx
      .update(schema.estimateVersions)
      .set(patch)
      .where(
        and(
          eq(schema.estimateVersions.organizationId, orgId),
          eq(schema.estimateVersions.id, parsed.data.versionId),
        ),
      );
  });

  if (projectId) revalidatePath(`/projects/${projectId}/estimate`);
}

export async function createNewEstimateVersion(formData: FormData): Promise<void> {
  const auth = await requireEstimateWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;
  const projectId = pathProjectId(formData);
  const fromVersionId = z_uuid(formData.get('fromVersionId'));
  if (!fromVersionId || !projectId) return;

  let newId: string | null = null;
  const db = getDb();
  await db.transaction(async (tx) => {
    const [from] = await tx
      .select()
      .from(schema.estimateVersions)
      .where(
        and(
          eq(schema.estimateVersions.organizationId, orgId),
          eq(schema.estimateVersions.id, fromVersionId),
        ),
      );
    if (!from) return;

    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${schema.estimateVersions.versionNumber}), 0)::int` })
      .from(schema.estimateVersions)
      .where(
        and(
          eq(schema.estimateVersions.organizationId, orgId),
          eq(schema.estimateVersions.projectId, from.projectId),
        ),
      )) as [{ max: number }];

    const [created] = await tx
      .insert(schema.estimateVersions)
      .values({
        organizationId: orgId,
        projectId: from.projectId,
        scopeVersionId: from.scopeVersionId,
        versionNumber: (max ?? 0) + 1,
        name: from.name,
        status: 'draft',
        overheadPct: from.overheadPct,
        profitPct: from.profitPct,
        taxRate: from.taxRate,
        createdBy: userId,
      })
      .returning({ id: schema.estimateVersions.id });
    if (!created) return;
    newId = created.id;

    const lines = await tx
      .select()
      .from(schema.estimateLineItems)
      .where(
        and(
          eq(schema.estimateLineItems.organizationId, orgId),
          eq(schema.estimateLineItems.estimateVersionId, fromVersionId),
        ),
      )
      .orderBy(asc(schema.estimateLineItems.sortOrder));
    if (lines.length > 0) {
      await tx.insert(schema.estimateLineItems).values(
        lines.map((l) => ({
          organizationId: orgId,
          estimateVersionId: created.id,
          catalogItemId: l.catalogItemId,
          category: l.category,
          description: l.description,
          lineType: l.lineType,
          quantity: l.quantity,
          unit: l.unit,
          unitCost: l.unitCost,
          wasteFactorPct: l.wasteFactorPct,
          taxable: l.taxable,
          lineCost: l.lineCost,
          sortOrder: l.sortOrder,
        })),
      );
    }
    await recompute(tx, orgId, created.id);
  });

  revalidatePath(`/projects/${projectId}/estimate`);
  if (newId) redirect(`/projects/${projectId}/estimate?v=${newId}`);
}

function pathProjectId(formData: FormData): string | null {
  return z_uuid(formData.get('projectId'));
}

function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
