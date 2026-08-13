import { Bot } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'AI Foreman' };

export default function AiForemanPage() {
  return (
    <SectionPlaceholder
      title="AI Foreman"
      description="Your AI assistant for scopes, estimates, and jobsite questions."
      icon={Bot}
      taskNote="The AI Foreman workspace is built in Task 30."
    />
  );
}
