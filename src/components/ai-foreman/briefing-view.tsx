import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  AREA_LABELS,
  LEVEL_LABELS,
  LEVEL_STYLES,
  LEVEL_TEXT_STYLES,
  countByLevel,
  type Briefing,
} from '@/lib/ai-foreman/ai-foreman-core';
import { cn } from '@/lib/utils';

/**
 * The briefing itself.
 *
 * Each finding shows its evidence directly under the claim rather than behind a
 * disclosure — the whole point is that a statement about somebody's job arrives
 * with the number it came from, and a number you have to click for is one you
 * won't check.
 */
export function BriefingView({ briefing }: { briefing: Briefing }) {
  const counts = countByLevel(briefing.findings);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold">{briefing.headline}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {briefing.title} · {briefing.day} · {counts.risk} risk
          {counts.risk === 1 ? '' : 's'}, {counts.watch} to watch
        </p>
      </div>

      {briefing.withheld.length > 0 && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          This briefing is partial —{' '}
          {briefing.withheld.map((a) => AREA_LABELS[a].toLowerCase()).join(' and ')} are not
          included, because your role does not have access to them.
        </p>
      )}

      <ul className="space-y-2">
        {briefing.findings.map((finding) => (
          <li key={finding.id} className={cn('rounded-lg border p-3', LEVEL_STYLES[finding.level])}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn('text-[11px] font-semibold uppercase', LEVEL_TEXT_STYLES[finding.level])}
              >
                {LEVEL_LABELS[finding.level]}
              </span>
              <span className="text-[11px] uppercase text-muted-foreground">
                {AREA_LABELS[finding.area]}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium">{finding.statement}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{finding.evidence}</p>
            {finding.action && <p className="mt-1 text-xs">{finding.action}</p>}
            {finding.href && (
              <Link
                href={finding.href}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Go there
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
