/**
 * Pure scope-of-work domain logic (Task 13): the version lifecycle state
 * machine, section-type catalog, and ordering helpers. No I/O — unit-testable
 * and shared by forms, actions, queries, and UI. The version_status model here
 * is reused by estimates and proposals in later tasks.
 */

export const VERSION_STATUSES = ['draft', 'in_review', 'approved', 'locked', 'superseded'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  locked: 'Locked',
  superseded: 'Superseded',
};

export const VERSION_STATUS_STYLES: Record<VersionStatus, string> = {
  draft: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  in_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  locked: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  superseded: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
};

/**
 * Allowed lifecycle transitions:
 *   draft ⇄ in_review → approved → locked
 *   approved → draft (send back for edits before locking)
 *   in_review → draft (withdraw from review)
 * A locked or superseded version is immutable — new work starts a new version.
 */
const TRANSITIONS: Record<VersionStatus, VersionStatus[]> = {
  draft: ['in_review', 'approved'],
  in_review: ['draft', 'approved'],
  approved: ['draft', 'locked'],
  locked: [],
  superseded: [],
};

export function canTransition(from: VersionStatus, to: VersionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: VersionStatus): VersionStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** A version is editable (sections/items may change) only while draft. */
export function isEditable(status: VersionStatus): boolean {
  return status === 'draft';
}

/** Locked/superseded versions are frozen; a new version must be created to edit. */
export function isFrozen(status: VersionStatus): boolean {
  return status === 'locked' || status === 'superseded';
}

// ── Section types ────────────────────────────────────────────────────────────

export const SECTION_TYPES = [
  'included',
  'excluded',
  'assumption',
  'allowance',
  'alternate',
  'client_responsibility',
  'contractor_responsibility',
  'permit',
  'cleanup',
  'warranty',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  included: 'Included',
  excluded: 'Excluded / Not included',
  assumption: 'Assumptions',
  allowance: 'Allowances',
  alternate: 'Alternates / Options',
  client_responsibility: 'Client responsibilities',
  contractor_responsibility: 'Our responsibilities',
  permit: 'Permits',
  cleanup: 'Cleanup',
  warranty: 'Warranty',
};

/** Default section title for a type (used when adding a section quickly). */
export function defaultSectionTitle(type: SectionType): string {
  return SECTION_TYPE_LABELS[type];
}

export function isSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(value);
}

// ── Ordering ─────────────────────────────────────────────────────────────────

export interface Orderable {
  id: string;
  sortOrder: number;
}

/**
 * Compute the reordered id sequence after moving one item up or down by one
 * position within its list. Returns the new id order (stable if at an edge).
 */
export function moveInList<T extends Orderable>(
  items: T[],
  id: string,
  direction: 'up' | 'down',
): string[] {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const index = ordered.findIndex((i) => i.id === id);
  if (index === -1) return ordered.map((i) => i.id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= ordered.length) return ordered.map((i) => i.id);
  const copy = [...ordered];
  const tmp = copy[index]!;
  copy[index] = copy[swapWith]!;
  copy[swapWith] = tmp;
  return copy.map((i) => i.id);
}

/** Next sort_order value for appending to a list (max + 1, or 0 when empty). */
export function nextSortOrder(items: Orderable[]): number {
  if (items.length === 0) return 0;
  return Math.max(...items.map((i) => i.sortOrder)) + 1;
}

/** Format a version label, e.g. "v3 · Approved". */
export function versionLabel(versionNumber: number, status: VersionStatus): string {
  return `v${versionNumber} · ${VERSION_STATUS_LABELS[status]}`;
}
