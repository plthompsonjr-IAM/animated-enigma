'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getAuthContext } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { revokeConnection } from './tokens';

/**
 * Disconnect the caller's own Google account. One tap, no arguments — there is
 * nothing to validate: the only row this can act on is the caller's own, and the
 * database enforces that even if this code didn't.
 */
export async function disconnectGoogle(): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login?next=/settings');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/settings?google=failed');

  try {
    await revokeConnection(ctx.activeOrg.organizationId, ctx.userId);
  } catch (error) {
    logger.error('google: disconnect failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    redirect('/settings?google=failed');
  }

  revalidatePath('/settings');
  redirect('/settings?google=disconnected');
}
