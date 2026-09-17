'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql, asc } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import {
  canTransition,
  isEditable,
  nextSortOrder,
  moveInList,
  type VersionStatus,
} from './scopes-core';
import {
  createScopeSchema,
  sectionSchema,
  updateSectionSchema,
  itemSchema,
  updateItemSchema,
  statusChangeSchema,
  versionNotesSchema,
} from './schema';

/** Scope editing is done by estimators (estimates:write) or PMs (projects:write). */
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
    return { ok: false, error: 'You do not have permission to edit the scope of work.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Resolve a section's version id (scoped to org) or null. */
async function versionIdForSection(
  tx: Tx,
  orgId: string,
  sectionId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ versionId: schema.scopeSections.scopeVersionId })
    .from(schema.scopeSections)
    .where(
      and(eq(schema.scopeSections.organizationId, orgId), eq(schema.scopeSections.id, sectionId)),
    );
  return row?.versionId ?? null;
}

/** Confirm a version exists in the org and is an editable draft. */
async function assertDraft(tx: Tx, orgId: string, versionId: string): Promise<boolean> {
  const [row] = await tx
    .select({ status: schema.scopeVersions.status })
    .from(schema.scopeVersions)
    .where(
      and(eq(schema.scopeVersions.organizationId, orgId), eq(schema.scopeVersions.id, versionId)),
    );
  return row ? isEditable(row.status as VersionStatus) : false;
}

// ── Create scope (get-or-create) ──────────────────────────────────────────────

export async function createScope(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const parsed = createScopeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const input = parsed.data;

  const projectId = input.projectId;
  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(
          and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, input.projectId)),
        );
      if (!project) throw new Error('project not in org');

      // One scope per project — no-op if it already exists.
      const [existing] = await tx
        .select({ id: schema.scopes.id })
        .from(schema.scopes)
        .where(
          and(
            eq(schema.scopes.organizationId, orgId),
            eq(schema.scopes.projectId, input.projectId),
          ),
        );
      if (existing) return;

      const [scope] = await tx
        .insert(schema.scopes)
        .values({
          organizationId: orgId,
          projectId: input.projectId,
          title: input.title,
          createdBy: userId,
        })
        .returning({ id: schema.scopes.id });
      if (!scope) throw new Error('scope insert returned no row');

      const [version] = await tx
        .insert(schema.scopeVersions)
        .values({
          organizationId: orgId,
          scopeId: scope.id,
          versionNumber: 1,
          status: 'draft',
          source: 'scratch',
          createdBy: userId,
        })
        .returning({ id: schema.scopeVersions.id });
      if (!version) throw new Error('version insert returned no row');

      await tx
        .update(schema.scopes)
        .set({ currentVersionId: version.id })
        .where(eq(schema.scopes.id, scope.id));
    });
  } catch (error) {
    logger.error('scopes: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  revalidatePath(`/projects/${projectId}/scope`);
  redirect(`/projects/${projectId}/scope`);
}

// ── Sections ──────────────────────────────────────────────────────────────────

export async function addSection(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = sectionSchema.safeParse({
    scopeVersionId: formData.get('scopeVersionId'),
    sectionType: formData.get('sectionType'),
    title: formData.get('title'),
  });
  if (!parsed.success) return;
  const projectId = pathProjectId(formData);

  const db = getDb();
  await db.transaction(async (tx) => {
    if (!(await assertDraft(tx, orgId, parsed.data.scopeVersionId))) return;
    const existing = await tx
      .select({ id: schema.scopeSections.id, sortOrder: schema.scopeSections.sortOrder })
      .from(schema.scopeSections)
      .where(
        and(
          eq(schema.scopeSections.organizationId, orgId),
          eq(schema.scopeSections.scopeVersionId, parsed.data.scopeVersionId),
        ),
      );
    await tx.insert(schema.scopeSections).values({
      organizationId: orgId,
      scopeVersionId: parsed.data.scopeVersionId,
      sectionType: parsed.data.sectionType,
      title: parsed.data.title,
      sortOrder: nextSortOrder(existing),
    });
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

export async function updateSection(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = updateSectionSchema.safeParse({
    sectionId: formData.get('sectionId'),
    title: formData.get('title'),
  });
  if (!parsed.success) return;
  const projectId = pathProjectId(formData);

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForSection(tx, orgId, parsed.data.sectionId);
    if (!versionId || !(await assertDraft(tx, orgId, versionId))) return;
    await tx
      .update(schema.scopeSections)
      .set({ title: parsed.data.title })
      .where(
        and(
          eq(schema.scopeSections.organizationId, orgId),
          eq(schema.scopeSections.id, parsed.data.sectionId),
        ),
      );
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

export async function deleteSection(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const sectionId = z_uuid(formData.get('sectionId'));
  const projectId = pathProjectId(formData);
  if (!sectionId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForSection(tx, orgId, sectionId);
    if (!versionId || !(await assertDraft(tx, orgId, versionId))) return;
    await tx
      .delete(schema.scopeSections)
      .where(
        and(eq(schema.scopeSections.organizationId, orgId), eq(schema.scopeSections.id, sectionId)),
      );
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

export async function moveSection(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const sectionId = z_uuid(formData.get('sectionId'));
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';
  const projectId = pathProjectId(formData);
  if (!sectionId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForSection(tx, orgId, sectionId);
    if (!versionId || !(await assertDraft(tx, orgId, versionId))) return;
    const sections = await tx
      .select({ id: schema.scopeSections.id, sortOrder: schema.scopeSections.sortOrder })
      .from(schema.scopeSections)
      .where(
        and(
          eq(schema.scopeSections.organizationId, orgId),
          eq(schema.scopeSections.scopeVersionId, versionId),
        ),
      )
      .orderBy(asc(schema.scopeSections.sortOrder));
    const order = moveInList(sections, sectionId, direction);
    await applyOrder(tx, schema.scopeSections, orgId, order);
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

// ── Items ─────────────────────────────────────────────────────────────────────

export async function addItem(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = itemSchema.safeParse({
    sectionId: formData.get('sectionId'),
    description: formData.get('description'),
  });
  if (!parsed.success) return;
  const projectId = pathProjectId(formData);

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForSection(tx, orgId, parsed.data.sectionId);
    if (!versionId || !(await assertDraft(tx, orgId, versionId))) return;
    const existing = await tx
      .select({ id: schema.scopeItems.id, sortOrder: schema.scopeItems.sortOrder })
      .from(schema.scopeItems)
      .where(
        and(
          eq(schema.scopeItems.organizationId, orgId),
          eq(schema.scopeItems.scopeSectionId, parsed.data.sectionId),
        ),
      );
    await tx.insert(schema.scopeItems).values({
      organizationId: orgId,
      scopeSectionId: parsed.data.sectionId,
      description: parsed.data.description,
      sortOrder: nextSortOrder(existing),
    });
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

export async function updateItem(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = updateItemSchema.safeParse({
    itemId: formData.get('itemId'),
    description: formData.get('description'),
  });
  if (!parsed.success) return;
  const projectId = pathProjectId(formData);

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForItem(tx, orgId, parsed.data.itemId);
    if (!versionId || !(await assertDraft(tx, orgId, versionId))) return;
    await tx
      .update(schema.scopeItems)
      .set({ description: parsed.data.description })
      .where(
        and(
          eq(schema.scopeItems.organizationId, orgId),
          eq(schema.scopeItems.id, parsed.data.itemId),
        ),
      );
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

export async function deleteItem(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const itemId = z_uuid(formData.get('itemId'));
  const projectId = pathProjectId(formData);
  if (!itemId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForItem(tx, orgId, itemId);
    if (!versionId || !(await assertDraft(tx, orgId, versionId))) return;
    await tx
      .delete(schema.scopeItems)
      .where(and(eq(schema.scopeItems.organizationId, orgId), eq(schema.scopeItems.id, itemId)));
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

export async function moveItem(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;
  const itemId = z_uuid(formData.get('itemId'));
  const sectionId = z_uuid(formData.get('sectionId'));
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';
  const projectId = pathProjectId(formData);
  if (!itemId || !sectionId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const versionId = await versionIdForSection(tx, orgId, sectionId);
    if (!versionId || !(await assertDraft(tx, orgId, versionId))) return;
    const items = await tx
      .select({ id: schema.scopeItems.id, sortOrder: schema.scopeItems.sortOrder })
      .from(schema.scopeItems)
      .where(
        and(
          eq(schema.scopeItems.organizationId, orgId),
          eq(schema.scopeItems.scopeSectionId, sectionId),
        ),
      )
      .orderBy(asc(schema.scopeItems.sortOrder));
    const order = moveInList(items, itemId, direction);
    await applyOrder(tx, schema.scopeItems, orgId, order);
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

// ── Version lifecycle ─────────────────────────────────────────────────────────

export async function changeVersionStatus(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const parsed = statusChangeSchema.safeParse({
    versionId: formData.get('versionId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return;
  const projectId = pathProjectId(formData);

  const db = getDb();
  await db.transaction(async (tx) => {
    const [version] = await tx
      .select({ status: schema.scopeVersions.status, scopeId: schema.scopeVersions.scopeId })
      .from(schema.scopeVersions)
      .where(
        and(
          eq(schema.scopeVersions.organizationId, orgId),
          eq(schema.scopeVersions.id, parsed.data.versionId),
        ),
      );
    if (!version) return;
    const from = version.status as VersionStatus;
    const to = parsed.data.status;
    if (!canTransition(from, to)) {
      logger.warn('scopes: rejected version transition', { from, to });
      return;
    }

    const patch: Record<string, unknown> = { status: to };
    if (to === 'approved') patch.approvedBy = userId;
    if (to === 'locked') patch.lockedAt = sql`now()`;
    await tx
      .update(schema.scopeVersions)
      .set(patch)
      .where(eq(schema.scopeVersions.id, parsed.data.versionId));

    // Keep the scope's approved pointer in sync.
    if (to === 'approved' || to === 'locked') {
      await tx
        .update(schema.scopes)
        .set({ approvedVersionId: parsed.data.versionId })
        .where(and(eq(schema.scopes.organizationId, orgId), eq(schema.scopes.id, version.scopeId)));
    }
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

export async function updateVersionNotes(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = versionNotesSchema.safeParse({
    versionId: formData.get('versionId'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return;
  const projectId = pathProjectId(formData);

  await getDb()
    .update(schema.scopeVersions)
    .set({ notes: parsed.data.notes ?? null })
    .where(
      and(
        eq(schema.scopeVersions.organizationId, orgId),
        eq(schema.scopeVersions.id, parsed.data.versionId),
      ),
    );

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

/** Clone the given version's sections + items into a fresh draft (number+1). */
export async function createNewVersion(formData: FormData): Promise<void> {
  const auth = await requireScopeWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;
  const scopeId = z_uuid(formData.get('scopeId'));
  const fromVersionId = z_uuid(formData.get('fromVersionId'));
  const projectId = pathProjectId(formData);
  if (!scopeId || !fromVersionId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const [scope] = await tx
      .select({ id: schema.scopes.id, currentVersionId: schema.scopes.currentVersionId })
      .from(schema.scopes)
      .where(and(eq(schema.scopes.organizationId, orgId), eq(schema.scopes.id, scopeId)));
    if (!scope) return;

    const [maxRow] = (await tx
      .select({ max: sql<number>`coalesce(max(${schema.scopeVersions.versionNumber}), 0)::int` })
      .from(schema.scopeVersions)
      .where(
        and(
          eq(schema.scopeVersions.organizationId, orgId),
          eq(schema.scopeVersions.scopeId, scopeId),
        ),
      )) as [{ max: number }];
    const nextNumber = (maxRow?.max ?? 0) + 1;

    const [newVersion] = await tx
      .insert(schema.scopeVersions)
      .values({
        organizationId: orgId,
        scopeId,
        versionNumber: nextNumber,
        status: 'draft',
        source: 'copied',
        createdBy: userId,
      })
      .returning({ id: schema.scopeVersions.id });
    if (!newVersion) throw new Error('version insert returned no row');

    // Copy sections and their items, preserving order.
    const sections = await tx
      .select()
      .from(schema.scopeSections)
      .where(
        and(
          eq(schema.scopeSections.organizationId, orgId),
          eq(schema.scopeSections.scopeVersionId, fromVersionId),
        ),
      )
      .orderBy(asc(schema.scopeSections.sortOrder));

    for (const s of sections) {
      const [newSection] = await tx
        .insert(schema.scopeSections)
        .values({
          organizationId: orgId,
          scopeVersionId: newVersion.id,
          sectionType: s.sectionType,
          title: s.title,
          sortOrder: s.sortOrder,
        })
        .returning({ id: schema.scopeSections.id });
      if (!newSection) continue;
      const items = await tx
        .select()
        .from(schema.scopeItems)
        .where(
          and(
            eq(schema.scopeItems.organizationId, orgId),
            eq(schema.scopeItems.scopeSectionId, s.id),
          ),
        )
        .orderBy(asc(schema.scopeItems.sortOrder));
      if (items.length > 0) {
        await tx.insert(schema.scopeItems).values(
          items.map((it) => ({
            organizationId: orgId,
            scopeSectionId: newSection.id,
            description: it.description,
            sortOrder: it.sortOrder,
          })),
        );
      }
    }

    // The new draft becomes the working head. An unapproved previous head is
    // superseded; an approved/locked one keeps its status (and approved pointer).
    if (scope.currentVersionId && scope.currentVersionId !== newVersion.id) {
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
      .set({ currentVersionId: newVersion.id })
      .where(eq(schema.scopes.id, scopeId));
  });

  if (projectId) revalidatePath(`/projects/${projectId}/scope`);
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function versionIdForItem(tx: Tx, orgId: string, itemId: string): Promise<string | null> {
  const [row] = await tx
    .select({ versionId: schema.scopeSections.scopeVersionId })
    .from(schema.scopeItems)
    .innerJoin(schema.scopeSections, eq(schema.scopeSections.id, schema.scopeItems.scopeSectionId))
    .where(and(eq(schema.scopeItems.organizationId, orgId), eq(schema.scopeItems.id, itemId)));
  return row?.versionId ?? null;
}

/** Write the given id order back as sequential sort_order values. */
async function applyOrder(
  tx: Tx,
  table: typeof schema.scopeSections | typeof schema.scopeItems,
  orgId: string,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await tx
      .update(table)
      .set({ sortOrder: i })
      .where(and(eq(table.organizationId, orgId), eq(table.id, ids[i]!)));
  }
}

/** A hidden `projectId` field carried by forms so we can revalidate the path. */
function pathProjectId(formData: FormData): string | null {
  return z_uuid(formData.get('projectId'));
}

function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
