import { describe, it, expect } from 'vitest';
import { navItems, mobileNavItems } from './nav-config';

describe('navigation config', () => {
  it('defines the twelve top-level sections', () => {
    expect(navItems).toHaveLength(12);
  });

  it('every item has a unique route', () => {
    const hrefs = navItems.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('exposes a focused set of mobile-primary destinations', () => {
    expect(mobileNavItems.length).toBeGreaterThan(0);
    expect(mobileNavItems.length).toBeLessThanOrEqual(4);
    expect(mobileNavItems.every((i) => i.mobilePrimary)).toBe(true);
  });
});
