import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { publicEnv } from '@/lib/env';
import { PublicIntakeForm } from '@/components/intake/public-intake-form';

export const metadata = {
  title: 'Request an estimate',
  robots: { index: false, follow: false },
};

/** Public, unauthenticated intake form for a single organization (by slug). */
export default async function PublicIntakePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Requires a real database connection (unauthenticated read of the org).
  if (!publicEnv.supabaseUrl || !process.env.DATABASE_URL) notFound();

  const db = getDb();
  const [org] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, slug));
  if (!org) notFound();

  return (
    <div className="min-h-dvh bg-secondary/40 px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-black text-primary-foreground">
            PT
          </div>
          <span className="font-bold">{org.name}</span>
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Tell us about your project</h1>
          <p className="text-sm text-muted-foreground">
            Fill this out and we’ll get back to you with next steps. Your Home, Our Mission.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <PublicIntakeForm orgSlug={slug} orgName={org.name} />
        </div>
      </div>
    </div>
  );
}
