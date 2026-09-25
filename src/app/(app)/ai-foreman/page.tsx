import Link from 'next/link';
import { Bot, ArrowRight } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { serverEnv } from '@/lib/env';
import { briefableProjects, briefingInput } from '@/lib/ai-foreman/queries';
import {
  buildBriefing,
  briefingText,
  clientUpdateDraft,
  providerStatus,
} from '@/lib/ai-foreman/ai-foreman-core';
import { BriefingView } from '@/components/ai-foreman/briefing-view';
import { AskPanel } from '@/components/ai-foreman/ask-panel';
import { CopyableText } from '@/components/ai-foreman/copyable-text';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button, buttonVariants } from '@/components/ui/button';

export const metadata = { title: 'AI Foreman' };

interface SearchParams {
  project?: string;
}

/**
 * The AI Foreman: one job, read end to end, said back to you in plain words.
 *
 * The dashboard answers "what across the company needs attention today". This
 * answers the question a contractor actually asks out loud — "where is the
 * Henderson job" — and it answers it from the record, with the number behind
 * every claim printed underneath it.
 *
 * There is no language model in this deployment, and the page says so rather
 * than implying one. That is not a placeholder: a briefing assembled from the
 * record is deterministic and checkable, which is what makes it safe to read to
 * a client. When a key is added, the model's job is phrasing and open questions
 * — the numbers keep coming from here.
 */
export default async function AiForemanPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          The AI Foreman activates once authentication and the database are configured and an
          organization exists.
        </p>
      </Shell>
    );
  }

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'ai:use', activeOrg.extraPermissions)) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          Your role doesn’t have access to the AI Foreman. Ask an administrator.
        </p>
      </Shell>
    );
  }

  const orgId = activeOrg.organizationId;
  const access = {
    money: can(activeOrg.roles, 'financials:read', activeOrg.extraPermissions),
    cost: can(activeOrg.roles, 'costs:read', activeOrg.extraPermissions),
  };

  const sp = await searchParams;
  const projects = await briefableProjects(orgId);

  // No key in this deployment. Read here rather than in the core so the module
  // stays pure and the screen stays honest about which it is.
  const provider = providerStatus(serverEnv().ANTHROPIC_API_KEY);

  if (projects.length === 0) {
    return (
      <Shell provider={provider.message}>
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm font-medium">There are no jobs to brief yet.</p>
            <p className="text-sm text-muted-foreground">
              The AI Foreman reads a job’s schedule, tasks, logs and money. Create a project and it
              has something to read.
            </p>
            <Link href="/projects/new" className={buttonVariants({ size: 'sm' })}>
              Create a project
            </Link>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const selectedId = projects.some((p) => p.id === sp.project)
    ? sp.project!
    : projects[0]!.id;

  const input = await briefingInput(orgId, selectedId, access);

  if (!input) {
    return (
      <Shell provider={provider.message}>
        <p className="text-sm text-muted-foreground">That job isn’t available.</p>
      </Shell>
    );
  }

  const briefing = buildBriefing(input);

  return (
    <Shell provider={provider.message}>
      {/* Native select in a GET form: it works before the JS lands and is the
          most reliable control there is on a phone. */}
      <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="project" className="text-sm font-medium sm:sr-only">
          Job
        </label>
        <Select id="project" name="project" defaultValue={selectedId} className="sm:max-w-sm">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.projectNumber ? `${p.projectNumber} — ${p.name}` : p.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Brief this job
        </Button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Briefing</CardTitle>
          </CardHeader>
          <CardContent>
            <BriefingView briefing={briefing} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ask about this job</CardTitle>
            </CardHeader>
            <CardContent>
              <AskPanel briefing={briefing} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Draft a client update</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Cost, margin and overdue invoices are deliberately left out — a progress update
                isn’t where any of those belong.
              </p>
              <CopyableText
                label="Client update draft"
                value={clientUpdateDraft(input, briefing)}
                rows={14}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">The briefing as text</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                For a text message, a note to a PM, or as the context a language model would be
                given once one is connected.
              </p>
              <CopyableText label="Briefing text" value={briefingText(briefing)} rows={16} />
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Everything here is read from the job record.{' '}
        <Link href={`/projects/${selectedId}`} className="inline-flex items-center gap-1 hover:underline">
          Open the job
          <ArrowRight className="h-3 w-3" />
        </Link>
      </p>
    </Shell>
  );
}

function Shell({ children, provider }: { children: React.ReactNode; provider?: string }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Bot className="h-6 w-6" />
          AI Foreman
        </h1>
        <p className="text-sm text-muted-foreground">
          One job, read end to end, with the number behind every claim.
        </p>
      </div>
      {provider && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {provider}
        </p>
      )}
      {children}
    </div>
  );
}
