import { and, eq, or, isNull, ilike, asc, desc, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { computeUnitCost, type Unit, type Tier, type CatalogSort } from './catalog-core';

export interface CatalogItemRow {
  id: string;
  name: string;
  trade: string | null;
  unit: Unit;
  tier: Tier;
  defaultMaterialCost: string | null;
  defaultLaborHours: string | null;
  defaultLaborRate: string | null;
  equipmentCost: string | null;
  wastePct: string | null;
  vendor: string | null;
  isGlobal: boolean;
  isActive: boolean;
  unitCost: number;
  updatedAt: Date;
}

export interface CatalogListParams {
  organizationId: string;
  search?: string;
  trade?: string;
  tier?: Tier | 'all';
  sort?: CatalogSort;
  includeInactive?: boolean;
}

/**
 * Catalog items visible to the org: its own plus platform-global (null-org)
 * ones. Unit cost is computed in JS (not SQL) so it stays identical to what the
 * estimate builder uses.
 */
export async function listCatalogItems(params: CatalogListParams): Promise<CatalogItemRow[]> {
  const db = getDb();
  const C = schema.costCatalogItems;

  const filters: SQL[] = [
    or(isNull(C.organizationId), eq(C.organizationId, params.organizationId)) as SQL,
  ];
  if (!params.includeInactive) filters.push(eq(C.isActive, true));
  if (params.trade) filters.push(eq(C.trade, params.trade));
  if (params.tier && params.tier !== 'all') filters.push(eq(C.tier, params.tier));
  if (params.search) {
    const term = `%${params.search}%`;
    const match = or(ilike(C.name, term), ilike(C.trade, term), ilike(C.vendor, term));
    if (match) filters.push(match);
  }

  const orderBy =
    params.sort === 'trade'
      ? [asc(C.trade), asc(C.name)]
      : params.sort === 'recent'
        ? [desc(C.updatedAt)]
        : [asc(C.name)];

  const rows = await db
    .select()
    .from(C)
    .where(and(...filters))
    .orderBy(...orderBy);

  const mapped: CatalogItemRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    trade: r.trade,
    unit: r.unit as Unit,
    tier: (r.tier ?? 'standard') as Tier,
    defaultMaterialCost: r.defaultMaterialCost,
    defaultLaborHours: r.defaultLaborHours,
    defaultLaborRate: r.defaultLaborRate,
    equipmentCost: r.equipmentCost,
    wastePct: r.wastePct,
    vendor: r.vendor,
    isGlobal: r.organizationId === null,
    isActive: r.isActive,
    unitCost: computeUnitCost({
      defaultMaterialCost: r.defaultMaterialCost,
      defaultLaborHours: r.defaultLaborHours,
      defaultLaborRate: r.defaultLaborRate,
      equipmentCost: r.equipmentCost,
      wastePct: r.wastePct,
    }).total,
    updatedAt: r.updatedAt,
  }));

  // Cost sorts depend on the computed unit cost, so apply them after mapping.
  if (params.sort === 'cost_high') mapped.sort((a, b) => b.unitCost - a.unitCost);
  if (params.sort === 'cost_low') mapped.sort((a, b) => a.unitCost - b.unitCost);
  return mapped;
}

/** A single catalog item (own or global). */
export async function getCatalogItem(organizationId: string, itemId: string) {
  const db = getDb();
  const C = schema.costCatalogItems;
  const [row] = await db
    .select()
    .from(C)
    .where(
      and(
        eq(C.id, itemId),
        or(isNull(C.organizationId), eq(C.organizationId, organizationId)) as SQL,
      ),
    );
  return row ?? null;
}

/** Price-history snapshots for an item, newest first. */
export async function getPriceHistory(organizationId: string, itemId: string) {
  const db = getDb();
  const H = schema.catalogPriceHistory;
  return db
    .select()
    .from(H)
    .where(
      and(
        eq(H.catalogItemId, itemId),
        or(isNull(H.organizationId), eq(H.organizationId, organizationId)) as SQL,
      ),
    )
    .orderBy(desc(H.effectiveDate), desc(H.createdAt));
}

/** Distinct trades in use (own + global), for the filter dropdown. */
export async function catalogTrades(organizationId: string): Promise<string[]> {
  const db = getDb();
  const C = schema.costCatalogItems;
  const rows = await db
    .selectDistinct({ trade: C.trade })
    .from(C)
    .where(
      and(
        or(isNull(C.organizationId), eq(C.organizationId, organizationId)) as SQL,
        sql`${C.trade} is not null`,
      ),
    );
  return rows
    .map((r) => r.trade)
    .filter((t): t is string => Boolean(t))
    .sort();
}
