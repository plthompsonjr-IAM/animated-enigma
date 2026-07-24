/**
 * Pure proposal logic (Task 17): status model, proposal-number formatting, the
 * event catalog, expiry, and — most importantly — the client-safe snapshot
 * builder. The snapshot is the ONLY thing a client ever sees, so it must never
 * carry costs, margins, overhead, or profit. No I/O; unit-testable.
 */

export const PROPOSAL_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'changes_requested',
  'expired',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  accepted: 'Accepted',
  declined: 'Declined',
  changes_requested: 'Changes requested',
  expired: 'Expired',
};

export const PROPOSAL_STATUS_STYLES: Record<ProposalStatus, string> = {
  draft: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  sent: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  viewed: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  accepted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  declined: 'bg-red-500/15 text-red-700 dark:text-red-300',
  changes_requested: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  expired: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
};

/** A proposal is live (client can view/act) while sent or viewed. */
export function isLive(status: ProposalStatus): boolean {
  return status === 'sent' || status === 'viewed';
}

/** Terminal states — the client has responded (or it lapsed). */
export function isClosed(status: ProposalStatus): boolean {
  return status === 'accepted' || status === 'declined' || status === 'expired';
}

/** Client can accept/decline only while the proposal is live. */
export function canRespond(status: ProposalStatus): boolean {
  return isLive(status);
}

export function formatProposalNumber(year: number, seq: number): string {
  return `PROP-${year}-${String(seq).padStart(4, '0')}`;
}

export function isExpired(expiresAt: string | Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= now.getTime();
}

// ── Events ───────────────────────────────────────────────────────────────────

export const PROPOSAL_EVENT_LABELS: Record<string, string> = {
  created: 'Created',
  sent: 'Sent to client',
  viewed: 'Viewed by client',
  accepted: 'Accepted',
  declined: 'Declined',
  changes_requested: 'Changes requested',
  reminder: 'Reminder sent',
  new_version: 'New version issued',
};

// ── Client-safe snapshot ─────────────────────────────────────────────────────

export interface SnapshotScopeSection {
  sectionType: string;
  title: string;
  items: string[];
}

export interface ProposalSnapshotInput {
  org: { name: string; tagline?: string | null };
  client: { name: string };
  project: { number: string; name: string; type?: string | null; address?: string | null };
  scope?: { sections: SnapshotScopeSection[] } | null;
  /** Client price only — never cost/margin. */
  price: number;
  expiresAt?: string | null;
  preparedBy?: string | null;
  preparedAt: string;
}

export interface ProposalSnapshot {
  org: { name: string; tagline: string | null };
  client: { name: string };
  project: { number: string; name: string; type: string | null; address: string | null };
  scope: { sections: SnapshotScopeSection[] };
  pricing: { total: number; expiresAt: string | null };
  preparedBy: string | null;
  preparedAt: string;
}

/**
 * Build the immutable, client-safe view model captured on a proposal version.
 * Deliberately narrow: the client sees the org, the project, the scope, and one
 * number — the total price. Costs, margins, unit prices, and internal notes are
 * never included.
 */
export function buildProposalSnapshot(input: ProposalSnapshotInput): ProposalSnapshot {
  return {
    org: { name: input.org.name, tagline: input.org.tagline ?? null },
    client: { name: input.client.name },
    project: {
      number: input.project.number,
      name: input.project.name,
      type: input.project.type ?? null,
      address: input.project.address ?? null,
    },
    scope: { sections: input.scope?.sections ?? [] },
    pricing: { total: round2(input.price), expiresAt: input.expiresAt ?? null },
    preparedBy: input.preparedBy ?? null,
    preparedAt: input.preparedAt,
  };
}

/** Guard: confirm a stored snapshot has no cost/margin keys (defense in depth). */
const FORBIDDEN_KEYS = ['cost', 'margin', 'overhead', 'profit', 'markup', 'unitcost', 'directcost'];
export function snapshotLeaksCost(snapshot: unknown): boolean {
  const json = JSON.stringify(snapshot ?? {}).toLowerCase();
  return FORBIDDEN_KEYS.some((k) => json.includes(k));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}
