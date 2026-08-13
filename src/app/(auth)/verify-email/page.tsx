import { MailCheck } from 'lucide-react';

export const metadata = { title: 'Verify your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MailCheck className="h-6 w-6" />
      </div>
      <h1 className="text-lg font-bold">Check your email</h1>
      <p className="text-sm text-muted-foreground">
        We sent a verification link{email ? ` to ${email}` : ''}. Open it to activate your account,
        then sign in.
      </p>
    </div>
  );
}
