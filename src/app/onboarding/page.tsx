import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { OnboardingForm } from './onboarding-form';

export const metadata = { title: 'Set up your company' };

export default async function OnboardingPage() {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login?next=/onboarding');
  if (ctx.activeOrg) redirect('/dashboard');

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-secondary/40 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-black text-primary-foreground">
          PT
        </div>
        <span className="font-bold">Tactical Foreman</span>
      </div>
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-bold">Set up your company</h1>
          <p className="text-sm text-muted-foreground">
            Create the organization your jobs, team, and clients will live under.
          </p>
        </div>
        <OnboardingForm />
      </div>
    </div>
  );
}
