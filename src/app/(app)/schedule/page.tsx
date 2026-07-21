import { Calendar } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Schedule' };

export default function SchedulePage() {
  return (
    <SectionPlaceholder
      title="Schedule"
      description="Site visits, crews, inspections, deliveries, and milestones."
      icon={Calendar}
      taskNote="Scheduling is built in Task 21."
    />
  );
}
