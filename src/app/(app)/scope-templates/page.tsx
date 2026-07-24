import { LayoutTemplate } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listTemplates } from '@/lib/scopes/template-queries';
import { Card, CardContent } from '@/components/ui/card';
import { TemplateManageActions } from './template-manage-actions';

export const metadata = { title: 'Scope templates' };

export default async function ScopeTemplatesPage() {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return <NotReady />;
  }

  const { activeOrg } = ctx;
  const mayEdit =
    can(activeOrg.roles, 'estimates:write', activeOrg.extraPermissions) ||
    can(activeOrg.roles, 'projects:write', activeOrg.extraPermissions);
  if (!mayEdit) {
    return (
      <Empty title="Scope templates">
        You don’t have permission to manage scope templates. Ask an administrator.
      </Empty>
    );
  }

  const templates = await listTemplates(activeOrg.organizationId, { includeInactive: true });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scope templates</h1>
        <p className="text-sm text-muted-foreground">
          Reusable scopes for your common jobs. Save any scope version as a template from a
          project’s scope page, then start new scopes from it.
        </p>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LayoutTemplate className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No templates yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Build a scope on any project, then use “Save as template” to reuse it here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  {t.isGlobal ? (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      Shared
                    </span>
                  ) : null}
                  {!t.isActive ? (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      Inactive
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.projectType ? `${t.projectType} · ` : ''}
                  {t.summary.sectionCount} {t.summary.sectionCount === 1 ? 'section' : 'sections'} ·{' '}
                  {t.summary.itemCount} {t.summary.itemCount === 1 ? 'line' : 'lines'}
                  {t.createdByName ? ` · by ${t.createdByName}` : ''}
                </p>
              </div>
              {/* Global templates aren't editable by an org. */}
              {t.isGlobal ? (
                <span className="text-xs text-muted-foreground">Platform template</span>
              ) : (
                <TemplateManageActions templateId={t.id} isActive={t.isActive} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotReady() {
  return (
    <Empty title="Scope templates">
      Templates activate once authentication and the database are configured and an organization
      exists.
    </Empty>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
