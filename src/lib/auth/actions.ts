'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ACTIVE_ORG_COOKIE } from './session';

export interface FormState {
  error?: string;
  message?: string;
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

const registerSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
});

/** Only allow same-app relative destinations for post-auth redirects. */
function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === 'string' ? raw : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback`,
    },
  });

  if (error) {
    logger.warn('auth: sign-up failed', { message: error.message });
    return { error: error.message };
  }

  redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    logger.warn('auth: sign-in failed', { message: error.message });
    return { error: 'Invalid email or password.' };
  }

  redirect(safeNext(formData.get('next')));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
  redirect('/login');
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get('email'));
  if (!email.success) return { error: 'Enter a valid email address.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${publicEnv.appUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    logger.warn('auth: password-reset request failed', { message: error.message });
    // Do not reveal whether the address exists.
  }

  return {
    message: 'If an account exists for that address, a reset link is on its way.',
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .safeParse(formData.get('password'));
  if (!password.success) {
    return { error: password.error.issues[0]?.message ?? 'Choose a longer password.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });

  if (error) {
    logger.warn('auth: password update failed', { message: error.message });
    return { error: 'Could not update the password. Open the reset link again and retry.' };
  }

  redirect('/dashboard');
}
