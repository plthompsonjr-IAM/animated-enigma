import { LayoutDashboard } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <SectionPlaceholder
      title="Dashboard"
      description="Your command center: pipeline, active projects, and money at a glance."
      icon={LayoutDashboard}
      taskNote="Dashboards and KPIs are built in Task 40."
    />
  );
}
