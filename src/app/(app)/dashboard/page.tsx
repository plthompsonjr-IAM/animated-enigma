import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { dashboardCounts, dashboardSignals } from '@/lib/dashboard/queries';
import {
  SEVERITY_STYLES,
  SEVERITY_TEXT_STYLES,
  buildAttentionList,
  buildKpis,
  headline,
} from '@/lib/dashboard/dashboard-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

/**
 * The command centre. Deliberately not twelve numbers: the top of the page is a
 * prioritised list of what actually needs dealing with today, and an empty list
 * is a real answer rather than a blank panel.
 */
export default async function DashboardPage() {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          The dashboard activates once authentication and the database are configured and an
          organization exists.
        </p>
      </div>
    );
  }

  const { activeOrg } = ctx;
  const showMoney = can(activeOrg.roles, 'financials:read', activeOrg.extraPermissions);
  const orgId = activeOrg.organizationId;

  const [signals, counts] = await Promise.all([
    dashboardSignals(orgId, showMoney),
    dashboardCounts(orgId),
  ]);

  const attention = buildAttentionList(signals);
  const kpis = buildKpis({ signals, ...counts, showMoney });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{headline(attention)}</p>
      </div>

      <div
        className={cn(
          'grid gap-2',
          kpis.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3',
        )}
      >
        {kpis.map((tile) => {
          const body = (
            <>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </div>
              <div
                className={cn(
                  'text-xl font-bold tabular-nums',
                  tile.tone === 'bad' && 'text-red-600 dark:text-red-400',
                )}
              >
                {tile.value}
              </div>
              {tile.note ? (
                <div
                  className={cn(
                    'text-[11px]',
                    tile.tone === 'bad'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-muted-foreground',
                  )}
                >
                  {tile.note}
                </div>
              ) : null}
            </>
          );
          return tile.href ? (
            <Link
              key={tile.label}
              href={tile.href}
              className="rounded-md border p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
            >
              {body}
            </Link>
          ) : (
            <div key={tile.label} className="rounded-md border p-3">
              {body}
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needs attention</CardTitle>
        </CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4">
              <CheckCircle2 className="h-5 w-5 flex-none text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-medium">Nothing outstanding.</p>
                <p className="text-xs text-muted-foreground">
                  No overdue money, no crew clashes, no late work, and today’s logs are in.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {attention.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-start justify-between gap-3 rounded-md border p-3 transition-colors hover:brightness-105',
                      SEVERITY_STYLES[item.severity],
                    )}
                  >
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'text-sm font-semibold',
                          SEVERITY_TEXT_STYLES[item.severity],
                        )}
                      >
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jump to</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Schedule', href: '/schedule' },
              { label: 'Tasks', href: '/tasks' },
              { label: 'Daily logs', href: '/daily-logs' },
              { label: 'Documents', href: '/documents' },
              { label: 'Leads', href: '/leads' },
              { label: 'Projects', href: '/projects' },
              ...(showMoney
                ? [
                    { label: 'Invoices', href: '/invoices' },
                    { label: 'Contracts', href: '/contracts' },
                  ]
                : []),
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md border p-3 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-accent/40"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
