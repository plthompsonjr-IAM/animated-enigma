/**
 * Pure navigation helpers: breadcrumb derivation and the quick-create catalog.
 * Kept free of React so the routing logic is unit-testable.
 */

export interface Crumb {
  label: string;
  href: string;
  current: boolean;
}

/** Labels for path segments that appear in breadcrumbs. */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  clients: 'Clients',
  projects: 'Projects',
  estimates: 'Estimates',
  proposals: 'Proposals',
  schedule: 'Schedule',
  tasks: 'Tasks',
  documents: 'Documents',
  financials: 'Financials',
  'ai-foreman': 'AI Foreman',
  settings: 'Settings',
  team: 'Team',
  onboarding: 'Set up',
};

function humanize(segment: string): string {
  // Dynamic segments (ids, tokens) get a neutral label rather than raw UUIDs.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(segment)) return 'Detail';
  return (
    SEGMENT_LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Derive breadcrumbs from a pathname: /settings/team → Settings / Team. */
export function buildBreadcrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  return segments.map((segment, i) => ({
    label: humanize(segment),
    href: '/' + segments.slice(0, i + 1).join('/'),
    current: i === segments.length - 1,
  }));
}

/** The quick-create catalog (Task 7). Each entry lands on its section with a
 * `new` intent; the actual creation forms arrive with their feature tasks. */
export const QUICK_CREATE_ITEMS = [
  { label: 'New lead', href: '/leads?new=1', icon: 'Users' },
  { label: 'New client', href: '/clients?new=1', icon: 'Contact' },
  { label: 'New project', href: '/projects?new=1', icon: 'Hammer' },
  { label: 'New estimate', href: '/estimates?new=1', icon: 'Calculator' },
  { label: 'New task', href: '/tasks?new=1', icon: 'ListChecks' },
  { label: 'New daily log', href: '/projects?log=1', icon: 'ClipboardList' },
  { label: 'Upload document', href: '/documents?upload=1', icon: 'Upload' },
  { label: 'Ask AI Foreman', href: '/ai-foreman', icon: 'Bot' },
] as const;

export type QuickCreateItem = (typeof QUICK_CREATE_ITEMS)[number];
