import {
  VERSION_STATUS_LABELS,
  VERSION_STATUS_STYLES,
  type VersionStatus,
} from '@/lib/scopes/scopes-core';
import { cn } from '@/lib/utils';

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        VERSION_STATUS_STYLES[status],
      )}
    >
      {VERSION_STATUS_LABELS[status]}
    </span>
  );
}
