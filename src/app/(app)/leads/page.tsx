import { Users } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Leads' };

export default function LeadsPage() {
  return (
    <SectionPlaceholder
      title="Leads"
      description="Capture and work every lead from first contact to won."
      icon={Users}
      taskNote="Lead management is built in Task 8."
    />
  );
}
