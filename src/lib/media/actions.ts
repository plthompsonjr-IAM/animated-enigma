'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import {
  guessDocumentCategory,
  isDocumentCategory,
  isPhotoCategory,
  storagePath,
  validateUpload,
  type DocumentCategory,
  type PhotoCategory,
} from '@/lib/storage/storage-core';
import { removeObjects, uploadObject } from '@/lib/storage/supabase-storage';

/**
 * Uploading is field work — the person on site takes the photo — so this is
 * gated on `documents:write`, which technicians hold.
 */
async function requireUpload(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const ctx: AuthContext = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'documents:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to upload files.' };
  }
  return { ok: true, orgId: ctx.activeOrg.organizationId, userId: ctx.userId };
}

function revalidateMedia(projectId?: string | null) {
  revalidatePath('/documents');
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

/**
 * Uploads one or more jobsite photos. Each file is validated, written to the
 * private bucket, then recorded — in that order, so a row never points at bytes
 * that aren't there.
 *
 * A partial failure is reported rather than rolled back: on a jobsite, four of
 * five photos landing is a better outcome than none, and the message says
 * exactly which one didn't.
 */
export async function uploadPhotos(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireUpload();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return { error: 'Pick a project for these photos.' };

  const files = formData.getAll('files').filter(isFile);
  if (files.length === 0) return { error: 'Choose at least one photo.' };
  if (files.length > 20) return { error: 'Upload up to 20 photos at a time.' };

  const categoryRaw = String(formData.get('category') ?? '');
  const category: PhotoCategory = isPhotoCategory(categoryRaw) ? categoryRaw : 'progress';
  const caption = nullableText(formData.get('caption'));
  const clientVisible = formData.get('clientVisible') === 'on';

  for (const file of files) {
    const invalid = validateUpload({ name: file.name, type: file.type, size: file.size }, 'photo');
    if (invalid.error) return { error: invalid.error };
  }

  const db = getDb();
  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
  if (!project) return { error: 'That project no longer exists.' };

  let saved = 0;
  const failures: string[] = [];

  for (const file of files) {
    const path = storagePath({
      organizationId: orgId,
      projectId,
      kind: 'photos',
      fileName: file.name,
      uniqueId: randomUUID(),
    });

    const upload = await uploadObject({
      path,
      body: await file.arrayBuffer(),
      contentType: file.type,
      organizationId: orgId,
    });
    if (!upload.ok) {
      // A configuration problem will hit every file the same way — say it once.
      if (saved === 0 && failures.length === 0) return { error: upload.error };
      failures.push(file.name);
      continue;
    }

    try {
      await db.insert(schema.photos).values({
        organizationId: orgId,
        projectId,
        storagePath: path,
        mimeType: file.type,
        sizeBytes: file.size,
        category,
        caption: files.length === 1 ? caption : null,
        clientVisible,
        uploadedBy: userId,
      });
      saved++;
    } catch (error) {
      logger.error('media.photo_row_failed', { error: String(error), path });
      // The bytes are orphaned otherwise — take them back out.
      await removeObjects([path], orgId);
      failures.push(file.name);
    }
  }

  revalidateMedia(projectId);
  if (saved === 0) return { error: 'None of those photos could be saved. Please try again.' };
  if (failures.length > 0) {
    return {
      message: `Saved ${saved} of ${files.length}. These didn’t upload: ${failures.join(', ')}.`,
    };
  }
  return { message: `Saved ${saved} ${saved === 1 ? 'photo' : 'photos'}.` };
}

/** Uploads a document — receipt, permit, plan, spec. */
export async function uploadDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireUpload();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth;

  const projectId = uuidOrNull(formData.get('projectId'));
  if (!projectId) return { error: 'Pick a project for this document.' };

  const [file] = formData.getAll('file').filter(isFile);
  if (!file) return { error: 'Choose a file.' };

  const invalid = validateUpload({ name: file.name, type: file.type, size: file.size }, 'document');
  if (invalid.error) return { error: invalid.error };

  const categoryRaw = String(formData.get('category') ?? '');
  const category: DocumentCategory = isDocumentCategory(categoryRaw)
    ? categoryRaw
    : guessDocumentCategory(file.name, file.type);
  const notes = nullableText(formData.get('notes'));
  const clientVisible = formData.get('clientVisible') === 'on';

  const db = getDb();
  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
  if (!project) return { error: 'That project no longer exists.' };

  const path = storagePath({
    organizationId: orgId,
    projectId,
    kind: 'documents',
    fileName: file.name,
    uniqueId: randomUUID(),
  });

  const upload = await uploadObject({
    path,
    body: await file.arrayBuffer(),
    contentType: file.type,
    organizationId: orgId,
  });
  if (!upload.ok) return { error: upload.error };

  try {
    await db.insert(schema.documents).values({
      organizationId: orgId,
      projectId,
      storagePath: path,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      category,
      clientVisible,
      notes,
      uploadedBy: userId,
    });
  } catch (error) {
    logger.error('media.document_row_failed', { error: String(error), path });
    await removeObjects([path], orgId);
    return { error: 'Something went wrong saving that document. Please try again.' };
  }

  revalidateMedia(projectId);
  return { message: `Saved ${file.name}.` };
}

/** Edits a photo's caption, category, or client visibility. */
export async function updatePhoto(formData: FormData): Promise<void> {
  const auth = await requireUpload();
  if (!auth.ok) return;
  const { orgId } = auth;

  const photoId = uuidOrNull(formData.get('photoId'));
  if (!photoId) return;

  const categoryRaw = String(formData.get('category') ?? '');
  const patch: Record<string, unknown> = {};
  if (isPhotoCategory(categoryRaw)) patch.category = categoryRaw;
  if (formData.has('caption')) patch.caption = nullableText(formData.get('caption'));
  if (formData.has('clientVisible')) {
    patch.clientVisible = formData.get('clientVisible') === 'on';
  }
  if (Object.keys(patch).length === 0) return;

  let projectId: string | null = null;
  try {
    const [updated] = await getDb()
      .update(schema.photos)
      .set(patch)
      .where(and(eq(schema.photos.organizationId, orgId), eq(schema.photos.id, photoId)))
      .returning({ projectId: schema.photos.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('media.update_photo_failed', { error: String(error), photoId });
    return;
  }
  revalidateMedia(projectId);
}

/** Toggles whether a photo is visible to the client. */
export async function togglePhotoVisibility(formData: FormData): Promise<void> {
  const auth = await requireUpload();
  if (!auth.ok) return;
  const { orgId } = auth;

  const photoId = uuidOrNull(formData.get('photoId'));
  const visible = formData.get('visible') === 'true';
  if (!photoId) return;

  let projectId: string | null = null;
  try {
    const [updated] = await getDb()
      .update(schema.photos)
      .set({ clientVisible: visible })
      .where(and(eq(schema.photos.organizationId, orgId), eq(schema.photos.id, photoId)))
      .returning({ projectId: schema.photos.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('media.toggle_photo_failed', { error: String(error), photoId });
    return;
  }
  revalidateMedia(projectId);
}

/** Toggles whether a document is visible to the client. */
export async function toggleDocumentVisibility(formData: FormData): Promise<void> {
  const auth = await requireUpload();
  if (!auth.ok) return;
  const { orgId } = auth;

  const documentId = uuidOrNull(formData.get('documentId'));
  const visible = formData.get('visible') === 'true';
  if (!documentId) return;

  let projectId: string | null = null;
  try {
    const [updated] = await getDb()
      .update(schema.documents)
      .set({ clientVisible: visible })
      .where(and(eq(schema.documents.organizationId, orgId), eq(schema.documents.id, documentId)))
      .returning({ projectId: schema.documents.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('media.toggle_document_failed', { error: String(error), documentId });
    return;
  }
  revalidateMedia(projectId);
}

/** Re-files a document under a different category. */
export async function recategorizeDocument(formData: FormData): Promise<void> {
  const auth = await requireUpload();
  if (!auth.ok) return;
  const { orgId } = auth;

  const documentId = uuidOrNull(formData.get('documentId'));
  const categoryRaw = String(formData.get('category') ?? '');
  if (!documentId || !isDocumentCategory(categoryRaw)) return;

  let projectId: string | null = null;
  try {
    const [updated] = await getDb()
      .update(schema.documents)
      .set({ category: categoryRaw })
      .where(and(eq(schema.documents.organizationId, orgId), eq(schema.documents.id, documentId)))
      .returning({ projectId: schema.documents.projectId });
    projectId = updated?.projectId ?? null;
  } catch (error) {
    logger.error('media.recategorize_failed', { error: String(error), documentId });
    return;
  }
  revalidateMedia(projectId);
}

/**
 * Soft-deletes a photo. The bytes stay in the bucket: a photo removed by mistake
 * is recoverable, and a jobsite photo may be the only evidence of a condition
 * that later turns into a dispute.
 */
export async function deletePhoto(formData: FormData): Promise<void> {
  const auth = await requireUpload();
  if (!auth.ok) return;
  const { orgId } = auth;

  const photoId = uuidOrNull(formData.get('photoId'));
  if (!photoId) return;

  let projectId: string | null = null;
  try {
    const [deleted] = await getDb()
      .update(schema.photos)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.photos.organizationId, orgId), eq(schema.photos.id, photoId)))
      .returning({ projectId: schema.photos.projectId });
    projectId = deleted?.projectId ?? null;
  } catch (error) {
    logger.error('media.delete_photo_failed', { error: String(error), photoId });
    return;
  }
  revalidateMedia(projectId);
}

/** Soft-deletes a document, for the same reason photos are soft-deleted. */
export async function deleteDocument(formData: FormData): Promise<void> {
  const auth = await requireUpload();
  if (!auth.ok) return;
  const { orgId } = auth;

  const documentId = uuidOrNull(formData.get('documentId'));
  if (!documentId) return;

  let projectId: string | null = null;
  try {
    const [deleted] = await getDb()
      .update(schema.documents)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.documents.organizationId, orgId), eq(schema.documents.id, documentId)))
      .returning({ projectId: schema.documents.projectId });
    projectId = deleted?.projectId ?? null;
  } catch (error) {
    logger.error('media.delete_document_failed', { error: String(error), documentId });
    return;
  }
  revalidateMedia(projectId);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isFile(value: FormDataEntryValue): value is File {
  return typeof value === 'object' && value !== null && 'arrayBuffer' in value;
}

function nullableText(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : null;
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
