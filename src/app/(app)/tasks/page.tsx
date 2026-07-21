import { ListChecks } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <SectionPlaceholder
      title="Tasks"
      description="Field tasks with dependencies, checklists, and verification."
      icon={ListChecks}
      taskNote="Task management is built in Task 22."
    />
  );
}
