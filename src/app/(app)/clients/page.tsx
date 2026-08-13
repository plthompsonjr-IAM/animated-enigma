import { Contact } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Clients' };

export default function ClientsPage() {
  return (
    <SectionPlaceholder
      title="Clients"
      description="Client records, properties, and full history."
      icon={Contact}
      taskNote="Client and property management is built in Task 9."
    />
  );
}
