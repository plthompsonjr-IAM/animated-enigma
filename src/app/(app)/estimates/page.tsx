import { Calculator } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Estimates' };

export default function EstimatesPage() {
  return (
    <SectionPlaceholder
      title="Estimates"
      description="Line-item estimating with versions, margins, and options."
      icon={Calculator}
      taskNote="The estimating engine is built in Task 14."
    />
  );
}
