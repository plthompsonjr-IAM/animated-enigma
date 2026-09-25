import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { ClientForm } from '@/components/clients/client-form';

export const metadata = { title: 'New client' };

export default async function NewClientPage() {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/clients');
  if (!can(ctx.activeOrg.roles, 'clients:write', ctx.activeOrg.extraPermissions)) {
    redirect('/clients');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New client</h1>
        <p className="text-sm text-muted-foreground">
          Add a customer. Properties can be attached right after.
        </p>
      </div>
      <ClientForm mode="create" />
    </div>
  );
}
