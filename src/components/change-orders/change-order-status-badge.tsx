import {
  CHANGE_ORDER_STATUS_LABELS,
  CHANGE_ORDER_STATUS_STYLES,
  type ChangeOrderStatus,
} from '@/lib/change-orders/change-orders-core';
import { cn } from '@/lib/utils';

export function ChangeOrderStatusBadge({ status }: { status: ChangeOrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        CHANGE_ORDER_STATUS_STYLES[status],
      )}
    >
      {CHANGE_ORDER_STATUS_LABELS[status]}
    </span>
  );
}
