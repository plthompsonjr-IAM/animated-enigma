import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Users } from 'lucide-react';
import { getDb, schema } from '@/db';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { resolveTerms, unresolvedBlanks } from '@/lib/contracts/terms-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { SettingsForm } from './settings-form';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Settings activate once authentication and the database are configured and an organization
          exists.
        </p>
      </div>
    );
  }

  const { activeOrg } = ctx;
  const mayManage = can(activeOrg.roles, 'org:manage', activeOrg.extraPermissions);

  const [org] = await getDb()
    .select({
      name: schema.organizations.name,
      tagline: schema.organizations.tagline,
      timezone: schema.organizations.timezone,
      signatureDisclosure: schema.organizations.signatureDisclosure,
      contractTerms: schema.organizations.contractTerms,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, activeOrg.organizationId));

  const blanks = unresolvedBlanks(resolveTerms(org?.contractTerms));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Company branding and the legal text used on your client documents.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Team</CardTitle>
          <Link href="/settings/team" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Users className="h-4 w-4" />
            Manage team
          </Link>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Invite people and set what each of them can see and do.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization</CardTitle>
        </CardHeader>
        <CardContent>
          {mayManage ? (
            <SettingsForm
              org={{
                name: org?.name ?? '',
                tagline: org?.tagline ?? '',
                timezone: org?.timezone ?? 'America/New_York',
                signatureDisclosure: org?.signatureDisclosure ?? '',
                contractTerms: org?.contractTerms ?? '',
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only an owner or administrator can change organization settings.
            </p>
          )}
        </CardContent>
      </Card>

      {blanks.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Your contract terms still have {blanks.length} blanks.</p>
          <p className="mt-0.5 text-muted-foreground">
            Outstanding: {blanks.join(', ').toLowerCase()}. Fill these in — and have the result
            reviewed by an attorney — before sending a contract to a client.
          </p>
        </div>
      ) : null}
    </div>
  );
}
