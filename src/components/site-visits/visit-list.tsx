import Link from 'next/link';
import { MapPin, User } from 'lucide-react';
import type { VisitRow } from '@/lib/site-visits/queries';
import { VISIT_TYPE_LABELS } from '@/lib/site-visits/site-visits-core';
import { VisitStatusBadge, VisitWhen } from './visit-badges';
import { VisitActions } from './visit-actions';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** Renders a list of visits. `showParent` links to the lead/project the visit
 * belongs to (used on the org-wide schedule page). `mayWrite` gates actions. */
export function VisitList({
  visits,
  members,
  mayWrite,
  showParent = false,
  emptyText = 'No site visits.',
}: {
  visits: VisitRow[];
  members: Member[];
  mayWrite: boolean;
  showParent?: boolean;
  emptyText?: string;
}) {
  if (visits.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2">
      {visits.map((v) => {
        const href = v.projectId
          ? `/projects/${v.projectId}`
          : v.leadId
            ? `/leads/${v.leadId}`
            : null;
        return (
          <li key={v.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{VISIT_TYPE_LABELS[v.visitType]}</span>
                  <VisitStatusBadge status={v.status} />
                </div>
                <p className="mt-0.5 text-sm">
                  <VisitWhen status={v.status} scheduledAt={v.scheduledAt} />
                </p>
                {showParent && href ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    <Link href={href} className="hover:underline">
                      {v.subject}
                    </Link>
                    {v.clientName ? ` · ${v.clientName}` : ''}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <User className="mr-1 inline h-3 w-3" />
                  {v.assignedToName ?? 'Unassigned'}
                </p>
                {v.notes ? <p className="mt-1 text-xs text-muted-foreground">{v.notes}</p> : null}
              </div>
            </div>
            {mayWrite ? (
              <div className="mt-2">
                <VisitActions
                  visitId={v.id}
                  status={v.status}
                  assignedTo={v.assignedTo}
                  durationMinutes={v.durationMinutes}
                  members={members}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
