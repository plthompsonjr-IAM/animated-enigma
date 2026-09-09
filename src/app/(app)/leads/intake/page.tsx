import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { CheckCircle2, Share2 } from 'lucide-react';
import { getDb, schema } from '@/db';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QuickIntakeForm } from '@/components/intake/quick-intake-form';
import { ShareIntakeLink } from '@/components/intake/share-intake-link';

export const metadata = { title: 'Quick intake' };

export default async function QuickIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/leads');
  if (!can(ctx.activeOrg.roles, 'leads:write', ctx.activeOrg.extraPermissions)) redirect('/leads');

  const [org] = await getDb()
    .select({ slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, ctx.activeOrg.organizationId));

  const { saved } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quick intake</h1>
        <p className="text-sm text-muted-foreground">
          Capturing a call? Take the essentials now — you can fill in the rest on the lead later.
        </p>
      </div>

      {saved ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Saved <span className="font-medium">{saved}</span> to the pipeline. Ready for the next
            one.
          </span>
        </div>
      ) : null}

      <QuickIntakeForm />

      {org?.slug ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Share2 className="h-4 w-4 text-primary" />
              Public intake form
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this link on your website, in emails, or on social media. Anything a homeowner
              submits lands straight in your Leads pipeline — no login required.
            </p>
            <ShareIntakeLink slug={org.slug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
