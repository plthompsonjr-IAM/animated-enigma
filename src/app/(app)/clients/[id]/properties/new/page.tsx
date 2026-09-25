import { notFound, redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getClient } from '@/lib/clients/queries';
import { PropertyForm } from '@/components/clients/property-form';

export const metadata = { title: 'Add property' };

export default async function NewPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/clients');
  if (!can(ctx.activeOrg.roles, 'clients:write', ctx.activeOrg.extraPermissions)) {
    redirect(`/clients/${id}`);
  }

  const client = await getClient(ctx.activeOrg.organizationId, id);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add property</h1>
        <p className="text-sm text-muted-foreground">For {client.displayName}</p>
      </div>
      <PropertyForm mode="create" clientId={client.id} />
    </div>
  );
}
