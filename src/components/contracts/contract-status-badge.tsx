import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_STYLES,
  type ContractStatus,
} from '@/lib/contracts/contracts-core';
import { cn } from '@/lib/utils';

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        CONTRACT_STATUS_STYLES[status],
      )}
    >
      {CONTRACT_STATUS_LABELS[status]}
    </span>
  );
}
