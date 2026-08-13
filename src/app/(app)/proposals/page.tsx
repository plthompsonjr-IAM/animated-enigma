import { FileText } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Proposals' };

export default function ProposalsPage() {
  return (
    <SectionPlaceholder
      title="Proposals"
      description="Branded proposals, delivery tracking, and e-signature."
      icon={FileText}
      taskNote="Proposal generation is built in Task 18."
    />
  );
}
