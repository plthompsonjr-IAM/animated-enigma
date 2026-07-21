import { FolderOpen } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Documents' };

export default function DocumentsPage() {
  return (
    <SectionPlaceholder
      title="Documents"
      description="Photos, receipts, permits, plans, and project files."
      icon={FolderOpen}
      taskNote="Photo and document management is built in Task 25."
    />
  );
}
