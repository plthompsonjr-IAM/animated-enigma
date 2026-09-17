import { LINE_TYPE_LABELS, LINE_TYPE_STYLES, type LineType } from '@/lib/estimates/estimate-core';
import {
  VERSION_STATUS_LABELS,
  VERSION_STATUS_STYLES,
  type VersionStatus,
} from '@/lib/scopes/scopes-core';
import { cn } from '@/lib/utils';

export function LineTypeBadge({ type }: { type: LineType }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold',
        LINE_TYPE_STYLES[type],
      )}
    >
      {LINE_TYPE_LABELS[type]}
    </span>
  );
}

export function EstimateStatusBadge({ status }: { status: VersionStatus }) {
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
