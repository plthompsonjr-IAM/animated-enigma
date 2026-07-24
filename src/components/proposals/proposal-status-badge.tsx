import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_STYLES,
  type ProposalStatus,
} from '@/lib/proposals/proposal-core';
import { cn } from '@/lib/utils';

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        PROPOSAL_STATUS_STYLES[status],
      )}
    >
      {PROPOSAL_STATUS_LABELS[status]}
    </span>
  );
}
