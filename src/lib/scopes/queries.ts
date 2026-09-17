import { and, eq, asc, desc } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { VersionStatus, SectionType } from './scopes-core';

export interface ScopeVersionRow {
  id: string;
  versionNumber: number;
  status: VersionStatus;
  notes: string | null;
  source: string | null;
  lockedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  approvedByName: string | null;
}

export interface ScopeSectionWithItems {
  id: string;
  sectionType: SectionType;
  title: string;
  sortOrder: number;
  items: { id: string; description: string; sortOrder: number }[];
}

/** The scope container for a project (one per project), or null if none yet. */
export async function getScopeForProject(organizationId: string, projectId: string) {
  const db = getDb();
  const S = schema.scopes;
  const [row] = await db
    .select()
    .from(S)
    .where(and(eq(S.organizationId, organizationId), eq(S.projectId, projectId)));
  return row ?? null;
}

/** All versions of a scope, newest first, with actor names. */
export async function getScopeVersions(
  organizationId: string,
  scopeId: string,
): Promise<ScopeVersionRow[]> {
  const db = getDb();
  const V = schema.scopeVersions;
  const creator = schema.users;
  const approver = schema.users;
  const rows = await db
    .select({
      id: V.id,
      versionNumber: V.versionNumber,
      status: V.status,
      notes: V.notes,
      source: V.source,
      lockedAt: V.lockedAt,
      createdAt: V.createdAt,
      createdByName: creator.fullName,
      approvedByName: approver.fullName,
    })
    .from(V)
    .leftJoin(creator, eq(creator.id, V.createdBy))
    .leftJoin(approver, eq(approver.id, V.approvedBy))
    .where(and(eq(V.organizationId, organizationId), eq(V.scopeId, scopeId)))
    .orderBy(desc(V.versionNumber));
  return rows as ScopeVersionRow[];
}

/** A single version row (for status/ownership checks). */
export async function getVersion(organizationId: string, versionId: string) {
  const db = getDb();
  const V = schema.scopeVersions;
  const [row] = await db
    .select()
    .from(V)
    .where(and(eq(V.organizationId, organizationId), eq(V.id, versionId)));
  return row ?? null;
}

/** Sections (ordered) with their items (ordered) for a version. */
export async function getVersionContent(
  organizationId: string,
  versionId: string,
): Promise<ScopeSectionWithItems[]> {
  const db = getDb();
  const sections = await db
    .select()
    .from(schema.scopeSections)
    .where(
      and(
        eq(schema.scopeSections.organizationId, organizationId),
        eq(schema.scopeSections.scopeVersionId, versionId),
      ),
    )
    .orderBy(asc(schema.scopeSections.sortOrder), asc(schema.scopeSections.createdAt));

  if (sections.length === 0) return [];

  const items = await db
    .select()
    .from(schema.scopeItems)
    .where(eq(schema.scopeItems.organizationId, organizationId))
    .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.createdAt));

  const bySection = new Map<string, { id: string; description: string; sortOrder: number }[]>();
  for (const it of items) {
    const list = bySection.get(it.scopeSectionId);
    const row = { id: it.id, description: it.description, sortOrder: it.sortOrder };
    if (list) list.push(row);
    else bySection.set(it.scopeSectionId, [row]);
  }

  return sections.map((s) => ({
    id: s.id,
    sectionType: s.sectionType as SectionType,
    title: s.title,
    sortOrder: s.sortOrder,
    items: bySection.get(s.id) ?? [],
  }));
}

/** Resolve the version to display for a scope: current pointer, else latest. */
export async function resolveDisplayVersionId(
  organizationId: string,
  scopeId: string,
  currentVersionId: string | null,
): Promise<string | null> {
  if (currentVersionId) return currentVersionId;
  const db = getDb();
  const V = schema.scopeVersions;
  const [row] = await db
    .select({ id: V.id })
    .from(V)
    .where(and(eq(V.organizationId, organizationId), eq(V.scopeId, scopeId)))
    .orderBy(desc(V.versionNumber))
    .limit(1);
  return row?.id ?? null;
}
