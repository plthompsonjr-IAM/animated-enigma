import Link from 'next/link';
import { Calculator, Library, ArrowRight } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';

export const metadata = { title: 'Estimates' };

export default async function EstimatesPage() {
  const ctx = await getAuthContext();
  const mayReadCosts =
    ctx.activeOrg != null && can(ctx.activeOrg.roles, 'costs:read', ctx.activeOrg.extraPermissions);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Estimates</h1>
        <p className="text-sm text-muted-foreground">
          Line-item estimating with versions, margins, and options.
        </p>
      </div>

      {/* The cost catalog (Task 15) is the foundation estimating builds on. */}
      {mayReadCosts ? (
        <Link href="/cost-catalog" className="block">
          <Card className="transition-colors hover:border-primary/50 hover:bg-accent/40">
            <CardContent className="flex items-center gap-4 py-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Library className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">Cost catalog</p>
                <p className="text-sm text-muted-foreground">
                  Manage your labor, material, and equipment costs — the building blocks estimates
                  pull from.
                </p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      ) : null}

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Calculator className="h-6 w-6" />
          </div>
          <div className="max-w-sm">
            <p className="font-medium">Estimating engine coming soon</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Line-item estimates that pull from your cost catalog and roll up to margins and
              client-ready prices are built in Task 16.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
