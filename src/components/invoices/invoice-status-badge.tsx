import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  type InvoiceStatus,
} from '@/lib/invoices/invoices-core';
import { cn } from '@/lib/utils';

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        INVOICE_STATUS_STYLES[status],
      )}
    >
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}
