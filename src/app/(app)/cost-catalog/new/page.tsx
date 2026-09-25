import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { CatalogForm } from '@/components/catalog/catalog-form';

export const metadata = { title: 'New catalog item' };

export default async function NewCatalogItemPage() {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/cost-catalog');
  if (!can(ctx.activeOrg.roles, 'estimates:write', ctx.activeOrg.extraPermissions)) {
    redirect('/cost-catalog');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/cost-catalog"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Cost catalog
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">New catalog item</h1>
      </div>
      <CatalogForm mode="create" />
    </div>
  );
}
