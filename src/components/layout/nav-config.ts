import {
  LayoutDashboard,
  Users,
  Contact,
  Hammer,
  Calculator,
  FileText,
  Calendar,
  ListChecks,
  FolderOpen,
  DollarSign,
  Bot,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Show in the mobile bottom bar (space-limited to the most-used destinations). */
  mobilePrimary?: boolean;
}

/** The twelve top-level sections of the application (PRD navigation). */
export const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, mobilePrimary: true },
  { label: 'Leads', href: '/leads', icon: Users, mobilePrimary: true },
  { label: 'Clients', href: '/clients', icon: Contact },
  { label: 'Projects', href: '/projects', icon: Hammer, mobilePrimary: true },
  { label: 'Estimates', href: '/estimates', icon: Calculator },
  { label: 'Proposals', href: '/proposals', icon: FileText },
  { label: 'Schedule', href: '/schedule', icon: Calendar },
  { label: 'Tasks', href: '/tasks', icon: ListChecks },
  { label: 'Documents', href: '/documents', icon: FolderOpen },
  { label: 'Financials', href: '/financials', icon: DollarSign },
  { label: 'AI Foreman', href: '/ai-foreman', icon: Bot, mobilePrimary: true },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export const mobileNavItems = navItems.filter((item) => item.mobilePrimary);
