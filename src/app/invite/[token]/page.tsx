import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getAuthContext } from '@/lib/auth/session';
import { hashInviteToken, isInvitationExpired } from '@/lib/auth/invitations';
import { ROLE_LABELS, type Role } from '@/lib/auth/rbac';
import { buttonVariants } from '@/components/ui/button';
import { AcceptInviteForm } from './accept-form';

export const metadata = { title: 'Team invitation' };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-secondary/40 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-black text-primary-foreground">
          PT
        </div>
        <span className="font-bold">Tactical Foreman</span>
      </div>
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable) {
    return (
      <Shell>
        <h1 className="text-lg font-bold">Invitation</h1>
        <p className="text-sm text-muted-foreground">
          The platform isn’t fully configured yet. Try again once setup is complete.
        </p>
      </Shell>
    );
  }

  const db = getDb();
  const [invitation] = await db
    .select({
      email: schema.invitations.email,
      roles: schema.invitations.roles,
      status: schema.invitations.status,
      expiresAt: schema.invitations.expiresAt,
      orgName: schema.organizations.name,
    })
    .from(schema.invitations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invitations.organizationId))
    .where(eq(schema.invitations.tokenHash, hashInviteToken(token)));

  if (!invitation || invitation.status !== 'pending' || isInvitationExpired(invitation.expiresAt)) {
    return (
      <Shell>
        <h1 className="text-lg font-bold">Invitation not available</h1>
        <p className="text-sm text-muted-foreground">
          This invitation is invalid, already used, or expired. Ask your administrator to send a new
          one.
        </p>
      </Shell>
    );
  }

  const roleNames = (invitation.roles as Role[]).map((r) => ROLE_LABELS[r]).join(', ');

  return (
    <Shell>
      <div>
        <h1 className="text-lg font-bold">Join {invitation.orgName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You’ve been invited as <span className="font-medium text-foreground">{roleNames}</span>{' '}
          using <span className="font-medium text-foreground">{invitation.email}</span>.
        </p>
      </div>

      {ctx.userId ? (
        <AcceptInviteForm token={token} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Sign in (or create an account) with {invitation.email} to accept.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className={buttonVariants({ className: 'w-full' })}
          >
            Sign in to accept
          </Link>
          <Link
            href="/register"
            className={buttonVariants({ variant: 'outline', className: 'w-full' })}
          >
            Create an account
          </Link>
        </div>
      )}
    </Shell>
  );
}
