import Link from 'next/link';
import { Plus, Hammer } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import {
  listProjects,
  projectStatusCounts,
  assignableMembers,
  type ProjectListRow,
} from '@/lib/projects/queries';
import {
  PROJECT_SORTS,
  formatCurrency,
  type ProjectSort,
  type ProjectStatus,
} from '@/lib/projects/projects-core';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProjectStatusBadge, ScheduleHealthText } from '@/components/projects/project-badges';
import { ProjectsToolbar } from './projects-toolbar';
import { StatusFilter } from './status-filter';

export const metadata = { title: 'Projects' };

interface SearchParams {
  q?: string;
  status?: string;
  assignee?: string;
  sort?: string;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return <NotReady />;
  }

  const { activeOrg } = ctx;
  const mayRead = can(activeOrg.roles, 'projects:read', activeOrg.extraPermissions);
  const mayWrite = can(activeOrg.roles, 'projects:write', activeOrg.extraPermissions);
  const showCosts = can(activeOrg.roles, 'costs:read', activeOrg.extraPermissions);
  if (!mayRead) {
    return (
      <Empty title="Projects">
        You don’t have permission to view projects. Ask an administrator.
      </Empty>
    );
  }

  const sp = await searchParams;
  const sort: ProjectSort = (PROJECT_SORTS as readonly string[]).includes(sp.sort ?? '')
    ? (sp.sort as ProjectSort)
    : 'recent';

  const orgId = activeOrg.organizationId;
  const [projects, counts, members] = await Promise.all([
    listProjects({
      organizationId: orgId,
      search: sp.q?.trim() || undefined,
      status: (sp.status as ProjectStatus | 'open' | undefined) ?? undefined,
      assignedTo: sp.assignee || undefined,
      sort,
    }),
    projectStatusCounts(orgId),
    assignableMembers(orgId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Every job, from planning through warranty.
          </p>
        </div>
        {mayWrite ? (
          <Link href="/projects/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            New project
          </Link>
        ) : null}
      </div>

      <ProjectsToolbar members={members} />
      <StatusFilter counts={counts} />

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Hammer className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No projects match</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {sp.q || sp.status || sp.assignee
                  ? 'Try clearing filters or search.'
                  : 'Start a project, or convert a won lead into one.'}
              </p>
            </div>
            {mayWrite && !sp.q && !sp.status && !sp.assignee ? (
              <Link href="/projects/new" className={buttonVariants()}>
                <Plus className="h-4 w-4" />
                New project
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectCard project={project} showCosts={showCosts} />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Project</th>
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">PM</th>
                  <th className="px-4 py-2.5 font-semibold">Target completion</th>
                  {showCosts ? <th className="px-4 py-2.5 font-semibold">Contract</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium hover:underline"
                      >
                        {project.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {project.projectNumber}
                        {project.projectType ? ` · ${project.projectType}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {project.clientName ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <ProjectStatusBadge status={project.status} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {project.projectManagerName ?? 'Unassigned'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <ScheduleHealthText
                        status={project.status}
                        expectedCompletion={project.expectedCompletion}
                      />
                    </td>
                    {showCosts ? (
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {formatCurrency(project.contractValue) || '—'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ProjectCard({ project, showCosts }: { project: ProjectListRow; showCosts: boolean }) {
  return (
    <Link href={`/projects/${project.id}`} className="block rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{project.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {project.projectNumber} · {project.clientName ?? 'No client'}
          </div>
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <ScheduleHealthText
          status={project.status}
          expectedCompletion={project.expectedCompletion}
        />
        {showCosts && formatCurrency(project.contractValue) ? (
          <span className="tabular-nums">{formatCurrency(project.contractValue)}</span>
        ) : null}
      </div>
    </Link>
  );
}

function NotReady() {
  return (
    <Empty title="Projects">
      Project management activates once authentication and the database are configured and an
      organization exists.
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
