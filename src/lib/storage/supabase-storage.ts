import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { SIGNED_URL_TTL_SECONDS, STORAGE_BUCKET, pathBelongsToOrg } from './storage-core';

/**
 * Supabase Storage access (Task 26). Everything here runs server-side with the
 * service-role key and is never exposed to the browser.
 *
 * Two deliberate choices:
 *
 * 1. **The bucket is private.** Reads go through short-lived signed URLs minted
 *    per request, so a link copied out of the page stops working in minutes and
 *    a leaked storage path is not a leaked file.
 *
 * 2. **Every path is re-checked against the caller's organisation** before a URL
 *    is signed or an object deleted. The database already scopes the rows by
 *    RLS; this is the second lock, so a bug that returns the wrong row still
 *    cannot hand over another tenant's file.
 */

let cached: SupabaseClient | null = null;

/** True when the storage credentials are actually present. */
export function isStorageConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && serverEnv().SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * The service-role client. Returns null rather than throwing when storage isn't
 * configured, so the app runs — and says so — before the bucket exists.
 */
function storageClient(): SupabaseClient | null {
  if (cached) return cached;
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!publicEnv.supabaseUrl || !key) return null;
  cached = createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const STORAGE_NOT_CONFIGURED =
  'File storage isn’t set up yet. Add SUPABASE_SERVICE_ROLE_KEY and create the ' +
  '“project-files” bucket (private) in Supabase.';

export type StorageResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Uploads bytes to the private bucket. `path` must already be org-scoped. */
export async function uploadObject(args: {
  path: string;
  body: ArrayBuffer | Uint8Array;
  contentType: string;
  organizationId: string;
}): Promise<StorageResult<{ path: string }>> {
  if (!pathBelongsToOrg(args.path, args.organizationId)) {
    logger.error('storage.path_org_mismatch', { path: args.path });
    return { ok: false, error: 'That upload path is not valid for your organization.' };
  }

  const client = storageClient();
  if (!client) return { ok: false, error: STORAGE_NOT_CONFIGURED };

  const { error } = await client.storage.from(STORAGE_BUCKET).upload(args.path, args.body, {
    contentType: args.contentType,
    // Never overwrite: every path already carries a unique id, so a collision
    // means something is wrong and should surface rather than destroy a file.
    upsert: false,
  });

  if (error) {
    logger.error('storage.upload_failed', { error: error.message, path: args.path });
    if (error.message.toLowerCase().includes('bucket not found')) {
      return {
        ok: false,
        error: `The “${STORAGE_BUCKET}” storage bucket doesn’t exist yet. Create it in Supabase as a private bucket.`,
      };
    }
    return { ok: false, error: 'The upload failed. Please try again.' };
  }
  return { ok: true, data: { path: args.path } };
}

/**
 * A short-lived signed URL for one object. Returns null on any failure — a
 * missing image is a broken thumbnail, not a broken page.
 */
export async function signedUrl(path: string, organizationId: string): Promise<string | null> {
  if (!pathBelongsToOrg(path, organizationId)) {
    logger.error('storage.sign_org_mismatch', { path });
    return null;
  }
  const client = storageClient();
  if (!client) return null;

  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    logger.error('storage.sign_failed', { error: error?.message, path });
    return null;
  }
  return data.signedUrl;
}

/**
 * Signs many objects in one call. Paths outside the organisation are dropped
 * rather than signed, and anything that fails simply comes back absent.
 */
export async function signedUrls(
  paths: string[],
  organizationId: string,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const allowed = paths.filter((p) => pathBelongsToOrg(p, organizationId));
  if (allowed.length === 0) return urls;

  const client = storageClient();
  if (!client) return urls;

  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .createSignedUrls(allowed, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    logger.error('storage.sign_many_failed', { error: error?.message, count: allowed.length });
    return urls;
  }
  for (const entry of data) {
    if (entry.signedUrl && entry.path) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

/**
 * Removes objects from the bucket. Used only when a row is being hard-deleted;
 * a soft-deleted photo keeps its bytes so it can be restored.
 */
export async function removeObjects(
  paths: string[],
  organizationId: string,
): Promise<StorageResult<{ removed: number }>> {
  const allowed = paths.filter((p) => pathBelongsToOrg(p, organizationId));
  if (allowed.length === 0) return { ok: true, data: { removed: 0 } };

  const client = storageClient();
  if (!client) return { ok: false, error: STORAGE_NOT_CONFIGURED };

  const { error } = await client.storage.from(STORAGE_BUCKET).remove(allowed);
  if (error) {
    logger.error('storage.remove_failed', { error: error.message, count: allowed.length });
    return { ok: false, error: 'Could not remove those files.' };
  }
  return { ok: true, data: { removed: allowed.length } };
}
