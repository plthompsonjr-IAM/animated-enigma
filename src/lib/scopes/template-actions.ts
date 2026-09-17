'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, asc, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { buildTemplateBody, parseTemplateBody, isNonEmptyBody } from './templates-core';
import {
  saveTemplateSchema,
  startScopeFromTemplateSchema,
  templateIdSchema,
} from './template-schema';

function mayEditScope(ctx: AuthContext): boolean {
  if (!ctx.activeOrg) return false;
  const { roles, extraPermissions } = ctx.activeOrg;
  return (
    can(roles, 'estimates:write', extraPermissions) ||
    can(roles, 'projects:write', extraPermissions)
  );
}

async function requireScopeWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string; userId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  if (!mayEditScope(ctx)) {
    return { ok: false, error: 'You do not have permission to manage scope templates.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Load a version's sections + their items (ordered), scoped to the org. */
async function loadVersionContent(tx: Tx, orgId: string, versionId: string) {
  const sections = await tx
    .select()
    .from(schema.scopeSections)
    .where(
      and(
        eq(schema.scopeSections.organizationId, orgId),
        eq(schema.scopeSections.scopeVersionId, versionId),
      ),
    )
    .orderBy(asc(schema.scopeSections.sortOrder));

  const result: { sectionType: string; title: string; items: { description: string }[] }[] = [];
  for (const s of sections) {
    const items = await tx
      .select({ description: schema.scopeItems.description })
      .from(schema.scopeItems)
      .where(
        and(
          eq(schema.scopeItems.organizationId, orgId),
          eq(schema.scopeItems.scopeSectionId, s.id),
        ),
      )
      .orderBy(asc(schema.scopeItems.sortOrder));
    result.push({ sectionType: s.sectionType, title: s.title, items });
  }
  return result;
}

/** Write a parsed template body into a fresh draft version's sections/items. */
async function populateVersionFromBody(
  tx: Tx,
  orgId: string,
  versionId: string,
  body: ReturnType<typeof parseTemplateBody>,
): Promise<void> {
  let sectionOrder = 0;
  for (const s of body.sections) {
    const [section] = await tx
      .insert(schema.scopeSections)
      .values({
        organizationId: orgId,
        scopeVersionId: versionId,
        sectionType: s.sectionType,
        title: s.title,
        sortOrder: sectionOrder++,
      })
      .returning({ id: schema.scopeSections.id });
    if (!section) continue;
    if (s.items.length > 0) {
      await tx.insert(schema.scopeItems).values(
        s.items.map((description, i) => ({
          organizationId: orgId,
          scopeSectionId: section.id,
          description,
          sortOrder: i,
        })),
      );
    }
  }
}

// ── Save a version as a template ──────────────────────────────────────────────

export async function saveVersionAsTemplate(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth.ctx;

  const parsed = saveTemplateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const projectId = formDataUuid(formData, 'projectId');

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      // Confirm the version is in this org.
      const [version] = await tx
        .select({ id: schema.scopeVersions.id })
        .from(schema.scopeVersions)
        .where(
          and(
            eq(schema.scopeVersions.organizationId, orgId),
            eq(schema.scopeVersions.id, parsed.data.versionId),
          ),
        );
      if (!version) throw new Error('version not in org');

      const content = await loadVersionContent(tx, orgId, parsed.data.versionId);
      const body = buildTemplateBody(content);
      if (!isNonEmptyBody(body)) throw new Error('empty scope');

      await tx.insert(schema.scopeTemplates).values({
        organizationId: orgId,
        name: parsed.data.name,
        projectType: parsed.data.projectType,
        body,
        createdBy: userId,
      });
    });
  } catch (error) {
    logger.error('scope-templates: save failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Could not save the template. Add at least one section first.' };
  }

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
  return { message: 'Saved as a template.' };
}

// ── Apply a template → new draft version on the project's scope ────────────────

export async function startScopeFromTemplate(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const parsed = startScopeFromTemplateSchema.safeParse({
    projectId: formData.get('projectId'),
    templateId: formData.get('templateId'),
  });
  if (!parsed.success) return;
  const { projectId, templateId } = parsed.data;

  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      // Project must be in the org.
      const [project] = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
      if (!project) throw new Error('project not in org');

      // Template must be the org's own or global.
      const [template] = await tx
        .select({
          body: schema.scopeTemplates.body,
          organizationId: schema.scopeTemplates.organizationId,
        })
        .from(schema.scopeTemplates)
        .where(eq(schema.scopeTemplates.id, templateId));
      if (!template || (template.organizationId !== null && template.organizationId !== orgId)) {
        throw new Error('template not visible');
      }
      const body = parseTemplateBody(template.body);

      // Get-or-create the scope container.
      let [scope] = await tx
        .select({ id: schema.scopes.id, currentVersionId: schema.scopes.currentVersionId })
        .from(schema.scopes)
        .where(
          and(eq(schema.scopes.organizationId, orgId), eq(schema.scopes.projectId, projectId)),
        );

      if (!scope) {
        const [created] = await tx
          .insert(schema.scopes)
          .values({ organizationId: orgId, projectId, title: 'Scope of Work', createdBy: userId })
          .returning({ id: schema.scopes.id });
        if (!created) throw new Error('scope insert failed');
        scope = { id: created.id, currentVersionId: null };
      }

      // Next version number.
      const [maxRow] = (await tx
        .select({ max: sql<number>`coalesce(max(${schema.scopeVersions.versionNumber}), 0)::int` })
        .from(schema.scopeVersions)
        .where(
          and(
            eq(schema.scopeVersions.organizationId, orgId),
            eq(schema.scopeVersions.scopeId, scope.id),
          ),
        )) as [{ max: number }];
      const nextNumber = (maxRow?.max ?? 0) + 1;

      const [version] = await tx
        .insert(schema.scopeVersions)
        .values({
          organizationId: orgId,
          scopeId: scope.id,
          versionNumber: nextNumber,
          status: 'draft',
          source: 'template',
          createdBy: userId,
        })
        .returning({ id: schema.scopeVersions.id });
      if (!version) throw new Error('version insert failed');

      await populateVersionFromBody(tx, orgId, version.id, body);

      // Supersede an unapproved previous head, then point current at the new draft.
      if (scope.currentVersionId && scope.currentVersionId !== version.id) {
        const [prev] = await tx
          .select({ status: schema.scopeVersions.status })
          .from(schema.scopeVersions)
          .where(eq(schema.scopeVersions.id, scope.currentVersionId));
        if (prev && (prev.status === 'draft' || prev.status === 'in_review')) {
          await tx
            .update(schema.scopeVersions)
            .set({ status: 'superseded' })
            .where(eq(schema.scopeVersions.id, scope.currentVersionId));
        }
      }
      await tx
        .update(schema.scopes)
        .set({ currentVersionId: version.id })
        .where(eq(schema.scopes.id, scope.id));
    });
  } catch (error) {
    logger.error('scope-templates: apply failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  revalidatePath(`/projects/${projectId}/scope`);
  redirect(`/projects/${projectId}/scope`);
}

// ── Manage templates ──────────────────────────────────────────────────────────

export async function deleteTemplate(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const parsed = templateIdSchema.safeParse({ templateId: formData.get('templateId') });
  if (!parsed.success) return;

  // Only the org's own templates (global rows have a null org and never match).
  await getDb()
    .delete(schema.scopeTemplates)
    .where(
      and(
        eq(schema.scopeTemplates.id, parsed.data.templateId),
        eq(schema.scopeTemplates.organizationId, orgId),
      ),
    );

  revalidatePath('/scope-templates');
}

export async function setTemplateActive(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const parsed = templateIdSchema.safeParse({ templateId: formData.get('templateId') });
  if (!parsed.success) return;
  const active = formData.get('active') === 'true';

  await getDb()
    .update(schema.scopeTemplates)
    .set({ isActive: active })
    .where(
      and(
        eq(schema.scopeTemplates.id, parsed.data.templateId),
        eq(schema.scopeTemplates.organizationId, orgId),
      ),
    );

  revalidatePath('/scope-templates');
}

function formDataUuid(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
