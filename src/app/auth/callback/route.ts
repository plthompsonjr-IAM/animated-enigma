import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * OAuth/OTP code exchange endpoint. Supabase email links (verification,
 * password recovery) land here with a `code`; we exchange it for a session
 * and continue to the requested destination.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const rawNext = url.searchParams.get('next') ?? '/dashboard';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.warn('auth: code exchange failed', { message: error.message });
      return NextResponse.redirect(new URL('/login?error=link', url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
