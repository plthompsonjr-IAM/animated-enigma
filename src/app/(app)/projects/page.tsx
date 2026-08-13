import { Hammer } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Projects' };

export default function ProjectsPage() {
  return (
    <SectionPlaceholder
      title="Projects"
      description="Every job workspace, from scope through warranty."
      icon={Hammer}
      taskNote="Project creation and workspace are built in Task 11."
    />
  );
}
