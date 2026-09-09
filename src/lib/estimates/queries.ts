import { and, eq, asc, desc } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { LineType, VersionStatus } from './estimate-core';
import type { Unit } from '@/lib/catalog/catalog-core';

export interface EstimateVersionRow {
  id: string;
  versionNumber: number;
  name: string | null;
  status: VersionStatus;
  finalPrice: string | null;
  directCost: string | null;
  grossMarginPct: string | null;
  overheadPct: string | null;
  profitPct: string | null;
  taxRate: string | null;
  lockedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
}

export interface EstimateLineRow {
  id: string;
  description: string;
  category: string | null;
  lineType: LineType;
  quantity: string;
  unit: Unit;
  unitCost: string;
  wasteFactorPct: string | null;
  taxable: boolean;
  lineCost: string | null;
  sortOrder: number;
  catalogItemId: string | null;
}

/** All estimate versions for a project, newest first, with actor names. */
export async function listEstimateVersions(
  organizationId: string,
  projectId: string,
): Promise<EstimateVersionRow[]> {
  const db = getDb();
  const E = schema.estimateVersions;
  const creator = schema.users;
  const rows = await db
    .select({
      id: E.id,
      versionNumber: E.versionNumber,
      name: E.name,
      status: E.status,
      finalPrice: E.finalPrice,
      directCost: E.directCost,
      grossMarginPct: E.grossMarginPct,
      overheadPct: E.overheadPct,
      profitPct: E.profitPct,
      taxRate: E.taxRate,
      lockedAt: E.lockedAt,
      createdAt: E.createdAt,
      createdByName: creator.fullName,
    })
    .from(E)
    .leftJoin(creator, eq(creator.id, E.createdBy))
    .where(and(eq(E.organizationId, organizationId), eq(E.projectId, projectId)))
    .orderBy(desc(E.versionNumber));
  return rows as EstimateVersionRow[];
}

/** One estimate version (full row). */
export async function getEstimateVersion(organizationId: string, versionId: string) {
  const db = getDb();
  const E = schema.estimateVersions;
  const [row] = await db
    .select()
    .from(E)
    .where(and(eq(E.organizationId, organizationId), eq(E.id, versionId)));
  return row ?? null;
}

/** The version plus its project (for the estimate page header + guards). */
export async function getEstimateWithProject(organizationId: string, versionId: string) {
  const db = getDb();
  const E = schema.estimateVersions;
  const P = schema.projects;
  const [row] = await db
    .select({
      estimate: E,
      projectId: P.id,
      projectNumber: P.projectNumber,
      projectName: P.name,
    })
    .from(E)
    .innerJoin(P, eq(P.id, E.projectId))
    .where(and(eq(E.organizationId, organizationId), eq(E.id, versionId)));
  return row ?? null;
}

/** Lines for a version, in order. */
export async function getEstimateLines(
  organizationId: string,
  versionId: string,
): Promise<EstimateLineRow[]> {
  const db = getDb();
  const L = schema.estimateLineItems;
  const rows = await db
    .select()
    .from(L)
    .where(and(eq(L.organizationId, organizationId), eq(L.estimateVersionId, versionId)))
    .orderBy(asc(L.sortOrder), asc(L.createdAt));
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    category: r.category,
    lineType: r.lineType as LineType,
    quantity: r.quantity,
    unit: r.unit as Unit,
    unitCost: r.unitCost,
    wasteFactorPct: r.wasteFactorPct,
    taxable: r.taxable,
    lineCost: r.lineCost,
    sortOrder: r.sortOrder,
    catalogItemId: r.catalogItemId,
  }));
}
