import { describe, it, expect } from 'vitest';
import { buildBreadcrumbs, QUICK_CREATE_ITEMS } from './navigation';

describe('buildBreadcrumbs', () => {
  it('maps nested paths to labeled crumbs with correct hrefs', () => {
    expect(buildBreadcrumbs('/settings/team')).toEqual([
      { label: 'Settings', href: '/settings', current: false },
      { label: 'Team', href: '/settings/team', current: true },
    ]);
  });

  it('produces a single crumb for top-level sections', () => {
    const crumbs = buildBreadcrumbs('/leads');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]).toEqual({ label: 'Leads', href: '/leads', current: true });
  });

  it('labels uuid-like segments neutrally instead of showing raw ids', () => {
    const crumbs = buildBreadcrumbs('/projects/0000000a-0000-4000-8000-000000000001');
    expect(crumbs[1]?.label).toBe('Detail');
    expect(crumbs[1]?.current).toBe(true);
  });

  it('humanizes unknown segments', () => {
    const crumbs = buildBreadcrumbs('/settings/cost-catalog');
    expect(crumbs[1]?.label).toBe('Cost Catalog');
  });
});

describe('quick-create catalog', () => {
  it('contains the eight Task 7 actions', () => {
    expect(QUICK_CREATE_ITEMS).toHaveLength(8);
    const labels = QUICK_CREATE_ITEMS.map((i) => i.label);
    for (const expected of [
      'New lead',
      'New client',
      'New project',
      'New estimate',
      'New task',
      'New daily log',
      'Upload document',
      'Ask AI Foreman',
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it('every action targets an in-app route', () => {
    for (const item of QUICK_CREATE_ITEMS) {
      expect(item.href.startsWith('/')).toBe(true);
    }
  });
});
