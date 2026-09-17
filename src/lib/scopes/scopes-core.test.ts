import { describe, it, expect } from 'vitest';
import {
  canTransition,
  allowedTransitions,
  isEditable,
  isFrozen,
  moveInList,
  nextSortOrder,
  isSectionType,
  versionLabel,
  VERSION_STATUSES,
  SECTION_TYPES,
  type Orderable,
} from './scopes-core';

describe('version lifecycle', () => {
  it('lists the five statuses', () => {
    expect(VERSION_STATUSES).toEqual(['draft', 'in_review', 'approved', 'locked', 'superseded']);
  });

  it('allows the forward path draft→in_review→approved→locked', () => {
    expect(canTransition('draft', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'approved')).toBe(true);
    expect(canTransition('approved', 'locked')).toBe(true);
  });

  it('allows reopening approved and withdrawing review to draft', () => {
    expect(canTransition('approved', 'draft')).toBe(true);
    expect(canTransition('in_review', 'draft')).toBe(true);
  });

  it('allows approving straight from draft', () => {
    expect(canTransition('draft', 'approved')).toBe(true);
  });

  it('forbids editing out of terminal states', () => {
    expect(canTransition('locked', 'draft')).toBe(false);
    expect(canTransition('superseded', 'draft')).toBe(false);
    expect(allowedTransitions('locked')).toEqual([]);
  });

  it('forbids skipping straight to locked from draft', () => {
    expect(canTransition('draft', 'locked')).toBe(false);
  });

  it('editable only while draft; frozen when locked/superseded', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('approved')).toBe(false);
    expect(isFrozen('locked')).toBe(true);
    expect(isFrozen('superseded')).toBe(true);
    expect(isFrozen('draft')).toBe(false);
  });
});

describe('section types', () => {
  it('has the ten catalog types', () => {
    expect(SECTION_TYPES).toHaveLength(10);
    expect(isSectionType('included')).toBe(true);
    expect(isSectionType('nonsense')).toBe(false);
  });
});

describe('moveInList', () => {
  const items: Orderable[] = [
    { id: 'a', sortOrder: 0 },
    { id: 'b', sortOrder: 1 },
    { id: 'c', sortOrder: 2 },
  ];

  it('moves an item up', () => {
    expect(moveInList(items, 'b', 'up')).toEqual(['b', 'a', 'c']);
  });
  it('moves an item down', () => {
    expect(moveInList(items, 'b', 'down')).toEqual(['a', 'c', 'b']);
  });
  it('is a no-op at the top edge', () => {
    expect(moveInList(items, 'a', 'up')).toEqual(['a', 'b', 'c']);
  });
  it('is a no-op at the bottom edge', () => {
    expect(moveInList(items, 'c', 'down')).toEqual(['a', 'b', 'c']);
  });
  it('respects stored sortOrder, not array order', () => {
    const shuffled: Orderable[] = [
      { id: 'c', sortOrder: 2 },
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
    ];
    expect(moveInList(shuffled, 'a', 'down')).toEqual(['b', 'a', 'c']);
  });
});

describe('nextSortOrder', () => {
  it('is 0 for an empty list', () => {
    expect(nextSortOrder([])).toBe(0);
  });
  it('is max + 1 otherwise', () => {
    expect(
      nextSortOrder([
        { id: 'a', sortOrder: 0 },
        { id: 'b', sortOrder: 5 },
      ]),
    ).toBe(6);
  });
});

describe('versionLabel', () => {
  it('formats number and status', () => {
    expect(versionLabel(3, 'approved')).toBe('v3 · Approved');
  });
});
