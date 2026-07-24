import type { ProposalSnapshot } from '@/lib/proposals/proposal-core';
import { formatMoney } from '@/lib/proposals/proposal-core';
import { SECTION_TYPE_LABELS, isSectionType } from '@/lib/scopes/scopes-core';

/**
 * The client-safe proposal document. Renders only what a client should see —
 * org, project, scope, and the total price. Never costs or margins. Shared by
 * the internal preview and the public share page so they're identical.
 */
export function ProposalDocument({ snapshot }: { snapshot: ProposalSnapshot }) {
  const { org, client, project, scope, pricing } = snapshot;
  return (
    <article className="space-y-6 rounded-lg border bg-card p-6">
      <header className="space-y-1 border-b pb-4 text-center">
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-black text-primary-foreground">
            PT
          </div>
          <span className="text-lg font-bold">{org.name}</span>
        </div>
        {org.tagline ? <p className="text-sm text-muted-foreground">{org.tagline}</p> : null}
        <h1 className="pt-2 text-xl font-bold tracking-tight">Project Proposal</h1>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Prepared for" value={client.name} />
        <Field label="Project" value={`${project.number} · ${project.name}`} />
        {project.type ? <Field label="Type" value={project.type} /> : null}
        {project.address ? <Field label="Location" value={project.address} /> : null}
      </section>

      {scope.sections.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Scope of work
          </h2>
          {scope.sections.map((s, i) => (
            <div key={i} className="rounded-md border">
              <div className="border-b bg-secondary/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isSectionType(s.sectionType) ? SECTION_TYPE_LABELS[s.sectionType] : s.title}
              </div>
              {s.items.length > 0 ? (
                <ul className="divide-y">
                  {s.items.map((item, j) => (
                    <li key={j} className="flex items-start gap-2 px-3 py-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">{s.title}</p>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <section className="rounded-md border-2 border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Total investment
          </span>
          <span className="text-2xl font-bold tabular-nums">{formatMoney(pricing.total)}</span>
        </div>
        {pricing.expiresAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Valid through{' '}
            {new Date(pricing.expiresAt).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        ) : null}
      </section>

      {snapshot.preparedBy ? (
        <footer className="border-t pt-3 text-xs text-muted-foreground">
          Prepared by {snapshot.preparedBy} ·{' '}
          {new Date(snapshot.preparedAt).toLocaleDateString('en-US')}
        </footer>
      ) : null}
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
