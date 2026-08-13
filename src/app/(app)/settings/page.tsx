import { Settings } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <SectionPlaceholder
      title="Settings"
      description="Company branding, defaults, users, and integrations."
      icon={Settings}
      taskNote="Organization settings are built in Task 41."
    />
  );
}
