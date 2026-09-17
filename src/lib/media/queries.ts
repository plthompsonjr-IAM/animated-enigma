import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { signedUrls } from '@/lib/storage/supabase-storage';
import type { DocumentCategory, PhotoCategory } from '@/lib/storage/storage-core';

export interface PhotoRow {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  category: PhotoCategory;
  caption: string | null;
  takenAt: Date | null;
  clientVisible: boolean;
  uploaderName: string | null;
  createdAt: Date;
  /** Short-lived signed URL, or null when storage isn't reachable. */
  url: string | null;
}

export interface DocumentRow {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  category: DocumentCategory;
  isGenerated: boolean;
  clientVisible: boolean;
  notes: string | null;
  uploaderName: string | null;
  createdAt: Date;
  url: string | null;
}

/**
 * Attaches signed URLs. Minted per request and short-lived, so a link copied out
 * of the page stops working in minutes. A failure here leaves `url` null — a
 * missing thumbnail, not a broken page.
 */
async function withUrls<T extends { storagePath: string }>(
  rows: T[],
  organizationId: string,
): Promise<(T & { url: string | null })[]> {
  if (rows.length === 0) return [];
  const urls = await signedUrls(
    rows.map((r) => r.storagePath),
    organizationId,
  );
  return rows.map((r) => ({ ...r, url: urls.get(r.storagePath) ?? null }));
}

function photoSelection() {
  const P = schema.photos;
  return {
    id: P.id,
    projectId: P.projectId,
    projectName: schema.projects.name,
    projectNumber: schema.projects.projectNumber,
    storagePath: P.storagePath,
    mimeType: P.mimeType,
    sizeBytes: P.sizeBytes,
    category: P.category,
    caption: P.caption,
    takenAt: P.takenAt,
    clientVisible: P.clientVisible,
    uploaderName: schema.users.fullName,
    createdAt: P.createdAt,
  };
}

function documentSelection() {
  const D = schema.documents;
  return {
    id: D.id,
    projectId: D.projectId,
    projectName: schema.projects.name,
    projectNumber: schema.projects.projectNumber,
    storagePath: D.storagePath,
    fileName: D.fileName,
    mimeType: D.mimeType,
    sizeBytes: D.sizeBytes,
    category: D.category,
    isGenerated: D.isGenerated,
    clientVisible: D.clientVisible,
    notes: D.notes,
    uploaderName: schema.users.fullName,
    createdAt: D.createdAt,
  };
}

/** A project's photos, newest first. */
export async function photosForProject(
  organizationId: string,
  projectId: string,
  limit = 200,
): Promise<PhotoRow[]> {
  const P = schema.photos;
  const rows = await getDb()
    .select(photoSelection())
    .from(P)
    .leftJoin(schema.projects, eq(schema.projects.id, P.projectId))
    .leftJoin(schema.users, eq(schema.users.id, P.uploadedBy))
    .where(
      and(
        eq(P.organizationId, organizationId),
        eq(P.projectId, projectId),
        sql`${P.deletedAt} is null`,
      ),
    )
    .orderBy(desc(P.createdAt))
    .limit(limit);
  return withUrls(rows as PhotoRow[], organizationId);
}

/** A project's documents, newest first. */
export async function documentsForProject(
  organizationId: string,
  projectId: string,
  limit = 200,
): Promise<DocumentRow[]> {
  const D = schema.documents;
  const rows = await getDb()
    .select(documentSelection())
    .from(D)
    .leftJoin(schema.projects, eq(schema.projects.id, D.projectId))
    .leftJoin(schema.users, eq(schema.users.id, D.uploadedBy))
    .where(
      and(
        eq(D.organizationId, organizationId),
        eq(D.projectId, projectId),
        sql`${D.deletedAt} is null`,
      ),
    )
    .orderBy(desc(D.createdAt))
    .limit(limit);
  return withUrls(rows as DocumentRow[], organizationId);
}

export interface MediaListParams {
  organizationId: string;
  projectId?: string;
  category?: string;
  clientVisibleOnly?: boolean;
  limit?: number;
}

/** Org-wide photo list for the documents screen. */
export async function listPhotos(params: MediaListParams): Promise<PhotoRow[]> {
  const P = schema.photos;
  const PR = schema.projects;
  const filters = [eq(P.organizationId, params.organizationId), sql`${P.deletedAt} is null`];
  if (params.projectId) filters.push(eq(P.projectId, params.projectId));
  if (params.category) filters.push(sql`${P.category}::text = ${params.category}`);
  if (params.clientVisibleOnly) filters.push(eq(P.clientVisible, true));

  const rows = await getDb()
    .select(photoSelection())
    .from(P)
    .leftJoin(PR, eq(PR.id, P.projectId))
    .leftJoin(schema.users, eq(schema.users.id, P.uploadedBy))
    .where(and(...filters))
    .orderBy(desc(P.createdAt))
    .limit(params.limit ?? 120);
  return withUrls(rows as PhotoRow[], params.organizationId);
}

/** Org-wide document list. */
export async function listDocuments(params: MediaListParams): Promise<DocumentRow[]> {
  const D = schema.documents;
  const PR = schema.projects;
  const filters = [eq(D.organizationId, params.organizationId), sql`${D.deletedAt} is null`];
  if (params.projectId) filters.push(eq(D.projectId, params.projectId));
  if (params.category) filters.push(sql`${D.category}::text = ${params.category}`);
  if (params.clientVisibleOnly) filters.push(eq(D.clientVisible, true));

  const rows = await getDb()
    .select(documentSelection())
    .from(D)
    .leftJoin(PR, eq(PR.id, D.projectId))
    .leftJoin(schema.users, eq(schema.users.id, D.uploadedBy))
    .where(and(...filters))
    .orderBy(desc(D.createdAt))
    .limit(params.limit ?? 200);
  return withUrls(rows as DocumentRow[], params.organizationId);
}

/** One document with a fresh signed URL — the download route. */
export async function getDocument(
  organizationId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  const D = schema.documents;
  const rows = await getDb()
    .select(documentSelection())
    .from(D)
    .leftJoin(schema.projects, eq(schema.projects.id, D.projectId))
    .leftJoin(schema.users, eq(schema.users.id, D.uploadedBy))
    .where(
      and(
        eq(D.organizationId, organizationId),
        eq(D.id, documentId),
        sql`${D.deletedAt} is null`,
      ),
    );
  const [doc] = await withUrls(rows as DocumentRow[], organizationId);
  return doc ?? null;
}

/** Photo and document counts per project — feeds the project list. */
export async function mediaCounts(
  organizationId: string,
): Promise<Map<string, { photos: number; documents: number }>> {
  const db = getDb();
  const [photoRows, docRows] = await Promise.all([
    db
      .select({ projectId: schema.photos.projectId, count: sql<number>`count(*)::int` })
      .from(schema.photos)
      .where(
        and(
          eq(schema.photos.organizationId, organizationId),
          sql`${schema.photos.deletedAt} is null`,
        ),
      )
      .groupBy(schema.photos.projectId),
    db
      .select({ projectId: schema.documents.projectId, count: sql<number>`count(*)::int` })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.organizationId, organizationId),
          sql`${schema.documents.deletedAt} is null`,
        ),
      )
      .groupBy(schema.documents.projectId),
  ]);

  const counts = new Map<string, { photos: number; documents: number }>();
  for (const row of photoRows) {
    if (!row.projectId) continue;
    counts.set(row.projectId, { photos: row.count, documents: 0 });
  }
  for (const row of docRows) {
    if (!row.projectId) continue;
    const entry = counts.get(row.projectId);
    if (entry) entry.documents = row.count;
    else counts.set(row.projectId, { photos: 0, documents: row.count });
  }
  return counts;
}
