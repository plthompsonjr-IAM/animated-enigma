/**
 * Pure client/property domain logic (Task 9): labels, normalization,
 * duplicate detection, address formatting, and list sorting. No I/O — every
 * function here is unit-testable and shared by forms, actions, and queries.
 */

export const CLIENT_TYPES = ['individual', 'company'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  individual: 'Individual',
  company: 'Company',
};

export const CONTACT_METHODS = ['phone', 'email', 'text'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  phone: 'Phone call',
  email: 'Email',
  text: 'Text message',
};

export const PROPERTY_TYPES = [
  'Single-family',
  'Townhouse',
  'Condo',
  'Duplex / Multi-family',
  'Mobile home',
  'Commercial',
  'Other',
] as const;

export const OCCUPANCY_STATUSES = ['owner_occupied', 'tenant_occupied', 'vacant'] as const;
export type OccupancyStatus = (typeof OCCUPANCY_STATUSES)[number];

export const OCCUPANCY_LABELS: Record<OccupancyStatus, string> = {
  owner_occupied: 'Owner occupied',
  tenant_occupied: 'Tenant occupied',
  vacant: 'Vacant',
};

// ── Normalization ────────────────────────────────────────────────────────────

/** Digits only; a leading US country code is dropped so 1-410-… matches 410-…. */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** Display formatting for a US 10-digit number; anything else passes through. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = normalizePhone(raw);
  if (d.length !== 10) return raw;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Lowercased, punctuation stripped, whitespace collapsed — for name compare. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Duplicate detection ──────────────────────────────────────────────────────

export interface DuplicateCandidate {
  id: string;
  displayName: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
}

export interface DuplicateMatch {
  id: string;
  displayName: string;
  reasons: ('phone' | 'email' | 'name')[];
}

/**
 * Compare a new client's contact details against existing records. A phone or
 * email match is a strong signal (same person, different spelling); a name
 * match alone is a softer prompt. Matches are surfaced as a warning — the
 * office can always choose "create anyway" (e.g. two clients sharing a phone).
 */
export function findDuplicates(
  existing: DuplicateCandidate[],
  input: { displayName?: string | null; phone?: string | null; email?: string | null },
): DuplicateMatch[] {
  const phone = normalizePhone(input.phone);
  const email = (input.email ?? '').trim().toLowerCase();
  const name = normalizeName(input.displayName);

  const matches: DuplicateMatch[] = [];
  for (const c of existing) {
    const reasons: DuplicateMatch['reasons'] = [];
    if (phone && normalizePhone(c.primaryPhone) === phone) reasons.push('phone');
    if (email && (c.primaryEmail ?? '').trim().toLowerCase() === email) reasons.push('email');
    if (name && normalizeName(c.displayName) === name) reasons.push('name');
    if (reasons.length > 0) matches.push({ id: c.id, displayName: c.displayName, reasons });
  }
  // Strongest signals first: phone/email beat name-only.
  return matches.sort(
    (a, b) =>
      Number(b.reasons.some((r) => r !== 'name')) - Number(a.reasons.some((r) => r !== 'name')),
  );
}

export const DUPLICATE_REASON_LABELS: Record<DuplicateMatch['reasons'][number], string> = {
  phone: 'same phone',
  email: 'same email',
  name: 'same name',
};

// ── Addresses ────────────────────────────────────────────────────────────────

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/** "123 Main St, Unit 2, Edgewood, MD 21040" — skips empty parts. */
export function formatAddress(address: unknown): string {
  if (!address || typeof address !== 'object') return '';
  const a = address as Address;
  const cityStateZip = [a.city, [a.state, a.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [a.line1, a.line2, cityStateZip].filter(Boolean).join(', ');
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export const CLIENT_SORTS = ['name', 'recent', 'oldest'] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export const CLIENT_SORT_LABELS: Record<ClientSort, string> = {
  name: 'Name A–Z',
  recent: 'Newest first',
  oldest: 'Oldest first',
};

export interface SortableClient {
  displayName: string;
  createdAt: string | Date;
}

export function sortClients<T extends SortableClient>(rows: T[], sort: ClientSort): T[] {
  const copy = [...rows];
  const time = (v: string | Date) => new Date(v).getTime();
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.displayName.localeCompare(b.displayName));
    case 'oldest':
      return copy.sort((a, b) => time(a.createdAt) - time(b.createdAt));
    case 'recent':
    default:
      return copy.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  }
}
