import { describe, it, expect } from 'vitest';
import {
  canTransition,
  nextStatus,
  scheduleHealth,
  formatCurrency,
  daysBetween,
  sortProjects,
  PROJECT_STATUSES,
  OPEN_PROJECT_STATUSES,
  type SortableProject,
} from './projects-core';

describe('project status model', () => {
  it('has nine statuses', () => {
    expect(PROJECT_STATUSES).toHaveLength(9);
  });
  it('open statuses exclude terminal and paused states', () => {
    expect(OPEN_PROJECT_STATUSES).not.toContain('closed');
    expect(OPEN_PROJECT_STATUSES).not.toContain('cancelled');
    expect(OPEN_PROJECT_STATUSES).not.toContain('on_hold');
    expect(OPEN_PROJECT_STATUSES).toContain('in_progress');
  });
});

describe('nextStatus', () => {
  it('walks the normal forward flow', () => {
    expect(nextStatus('planning')).toBe('scheduled');
    expect(nextStatus('scheduled')).toBe('in_progress');
    expect(nextStatus('in_progress')).toBe('punch_list');
    expect(nextStatus('punch_list')).toBe('completed');
    expect(nextStatus('completed')).toBe('warranty');
    expect(nextStatus('warranty')).toBe('closed');
  });
  it('has no next step at the end or for paused/terminal states', () => {
    expect(nextStatus('closed')).toBeNull();
    expect(nextStatus('cancelled')).toBeNull();
    expect(nextStatus('on_hold')).toBeNull();
  });
});

describe('canTransition', () => {
  it('allows normal moves', () => {
    expect(canTransition('planning', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'on_hold')).toBe(true);
    expect(canTransition('on_hold', 'in_progress')).toBe(true);
  });
  it('rejects a no-op', () => {
    expect(canTransition('planning', 'planning')).toBe(false);
  });
  it('only lets a cancelled project reopen to planning', () => {
    expect(canTransition('cancelled', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'planning')).toBe(true);
  });
});

describe('scheduleHealth', () => {
  const today = new Date('2026-07-23T12:00:00Z');

  it('is none without a completion date', () => {
    expect(scheduleHealth('in_progress', null, today)).toBe('none');
  });
  it('is none for finished/terminal projects', () => {
    expect(scheduleHealth('completed', '2026-01-01', today)).toBe('none');
    expect(scheduleHealth('closed', '2026-01-01', today)).toBe('none');
  });
  it('flags overdue', () => {
    expect(scheduleHealth('in_progress', '2026-07-20', today)).toBe('overdue');
  });
  it('flags due soon (within a week)', () => {
    expect(scheduleHealth('in_progress', '2026-07-28', today)).toBe('due_soon');
    expect(scheduleHealth('in_progress', '2026-07-23', today)).toBe('due_soon');
  });
  it('is on track when comfortably out', () => {
    expect(scheduleHealth('in_progress', '2026-09-01', today)).toBe('on_track');
  });
});

describe('formatCurrency', () => {
  it('formats whole dollars', () => {
    expect(formatCurrency(15000)).toBe('$15,000');
    expect(formatCurrency('2500.50')).toBe('$2,501');
  });
  it('returns empty for null/blank/invalid', () => {
    expect(formatCurrency(null)).toBe('');
    expect(formatCurrency('')).toBe('');
    expect(formatCurrency('abc')).toBe('');
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-07-01', '2026-07-15')).toBe(14);
  });
  it('is null when either date is missing', () => {
    expect(daysBetween(null, '2026-07-15')).toBeNull();
    expect(daysBetween('2026-07-01', null)).toBeNull();
  });
});

describe('sortProjects', () => {
  const rows: SortableProject[] = [
    {
      projectNumber: 'PRJ-2026-0002',
      name: 'Bravo',
      expectedCompletion: '2026-08-10',
      createdAt: '2026-07-10',
    },
    {
      projectNumber: 'PRJ-2026-0003',
      name: 'Alpha',
      expectedCompletion: null,
      createdAt: '2026-07-15',
    },
    {
      projectNumber: 'PRJ-2026-0001',
      name: 'Charlie',
      expectedCompletion: '2026-08-01',
      createdAt: '2026-07-12',
    },
  ];

  it('recent = newest createdAt first', () => {
    expect(sortProjects(rows, 'recent').map((r) => r.name)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });
  it('number = ascending project number', () => {
    expect(sortProjects(rows, 'number').map((r) => r.projectNumber)).toEqual([
      'PRJ-2026-0001',
      'PRJ-2026-0002',
      'PRJ-2026-0003',
    ]);
  });
  it('name = alphabetical', () => {
    expect(sortProjects(rows, 'name').map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
  it('completion = earliest target first, nulls last', () => {
    expect(sortProjects(rows, 'completion').map((r) => r.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });
  it('does not mutate the input', () => {
    const before = rows.map((r) => r.name);
    sortProjects(rows, 'name');
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});
