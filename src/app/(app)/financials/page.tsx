import { DollarSign } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Financials' };

export default function FinancialsPage() {
  return (
    <SectionPlaceholder
      title="Financials"
      description="Invoices, payments, and live project profitability."
      icon={DollarSign}
      taskNote="Invoicing and financials are built in Tasks 27 to 29."
    />
  );
}
