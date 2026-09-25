import { and, eq, or, isNull, asc, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { summarizeTemplate, type TemplateSummary } from './templates-core';

export interface TemplateRow {
  id: string;
  name: string;
  projectType: string | null;
  isGlobal: boolean;
  isActive: boolean;
  createdByName: string | null;
  updatedAt: Date;
  summary: TemplateSummary;
}

/**
 * Active templates visible to the org: its own plus platform-global (null-org)
 * ones. Optionally rank templates whose project_type matches `projectType`
 * first (so the bathroom-remodel templates surface on a bathroom project).
 */
export async function listTemplates(
  organizationId: string,
  opts: { projectType?: string | null; includeInactive?: boolean } = {},
): Promise<TemplateRow[]> {
  const db = getDb();
  const T = schema.scopeTemplates;
  const creator = schema.users;

  const filters: SQL[] = [
    or(isNull(T.organizationId), eq(T.organizationId, organizationId)) as SQL,
  ];
  if (!opts.includeInactive) filters.push(eq(T.isActive, true));

  const rows = await db
    .select({
      id: T.id,
      name: T.name,
      projectType: T.projectType,
      organizationId: T.organizationId,
      isActive: T.isActive,
      body: T.body,
      updatedAt: T.updatedAt,
      createdByName: creator.fullName,
    })
    .from(T)
    .leftJoin(creator, eq(creator.id, T.createdBy))
    .where(and(...filters))
    .orderBy(asc(T.name));

  const wanted = opts.projectType?.trim().toLowerCase() ?? null;
  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    projectType: r.projectType,
    isGlobal: r.organizationId === null,
    isActive: r.isActive,
    createdByName: r.createdByName,
    updatedAt: r.updatedAt,
    summary: summarizeTemplate(r.body),
  }));

  if (!wanted) return mapped;
  // Matching project-type first, otherwise alphabetical (already sorted).
  return mapped.sort((a, b) => {
    const am = a.projectType?.toLowerCase() === wanted ? 0 : 1;
    const bm = b.projectType?.toLowerCase() === wanted ? 0 : 1;
    return am - bm;
  });
}

/** A single template, visible if it's the org's own or global. */
export async function getTemplate(organizationId: string, templateId: string) {
  const db = getDb();
  const T = schema.scopeTemplates;
  const [row] = await db
    .select()
    .from(T)
    .where(
      and(
        eq(T.id, templateId),
        or(isNull(T.organizationId), eq(T.organizationId, organizationId)) as SQL,
      ),
    );
  return row ?? null;
}

/** Whether the org has any templates available (own or global) — for UI gating. */
export async function hasAnyTemplate(organizationId: string): Promise<boolean> {
  const db = getDb();
  const T = schema.scopeTemplates;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(T)
    .where(
      and(
        eq(T.isActive, true),
        or(isNull(T.organizationId), eq(T.organizationId, organizationId)) as SQL,
      ),
    );
  return (row?.count ?? 0) > 0;
}
