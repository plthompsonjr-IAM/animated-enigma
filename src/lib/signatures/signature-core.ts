/**
 * Pure e-signature logic (Task 19): the signable catalog, signer-name
 * normalization/validation, audit-metadata extraction, and the default legal
 * disclosure. No I/O — unit-testable and shared by the public signing form, the
 * server action, and the internal approval record.
 *
 * A signature is a legal artifact: once written it is never edited (the DB
 * enforces append-only), and the exact disclosure text shown to the signer is
 * captured on the record so we can always prove what they agreed to.
 */

export const SIGNABLE_TYPES = ['proposal_version', 'change_order', 'contract'] as const;
export type SignableType = (typeof SIGNABLE_TYPES)[number];

export const SIGNABLE_TYPE_LABELS: Record<SignableType, string> = {
  proposal_version: 'Proposal',
  change_order: 'Change order',
  contract: 'Contract',
};

/**
 * Fallback disclosure shown at signing when an organization has not configured
 * its own. Deliberately generic: this is NOT legal advice and does not claim to
 * satisfy any particular jurisdiction — orgs are expected to substitute text
 * reviewed for the states they operate in.
 */
export const DEFAULT_SIGNATURE_DISCLOSURE =
  'By typing your name and accepting, you agree to sign this proposal electronically and ' +
  'that your electronic signature has the same legal effect as a handwritten signature. ' +
  'We record your name, the date and time, and your device and network information as part ' +
  'of this signature. You may request a paper copy or sign on paper instead by contacting us.';

/** Resolve the disclosure to show: the org's configured text, else the default. */
export function resolveDisclosure(configured?: string | null): string {
  const text = (configured ?? '').trim();
  return text.length > 0 ? text : DEFAULT_SIGNATURE_DISCLOSURE;
}

// ── Signer identity ──────────────────────────────────────────────────────────

/** Trim and collapse internal whitespace so "  Jane   Dorsey " → "Jane Dorsey". */
export function normalizeSignerName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * A typed signature must look like a name: at least two characters and at least
 * one letter (so "  ", "--", or "12" are rejected). Unicode-aware so non-ASCII
 * names pass.
 */
export function isValidSignerName(raw: string): boolean {
  const name = normalizeSignerName(raw);
  if (name.length < 2 || name.length > 200) return false;
  return /\p{L}/u.test(name);
}

// ── Audit metadata ───────────────────────────────────────────────────────────

/**
 * The client IP as seen through proxies. `x-forwarded-for` is a comma-separated
 * chain where the left-most entry is the original client. Returns null when the
 * header is absent or unusable — we never invent an address.
 */
export function clientIpFromForwardedFor(header?: string | null): string | null {
  if (!header) return null;
  const first = header.split(',')[0]?.trim() ?? '';
  return first.length > 0 && first.length <= 100 ? first : null;
}

/** User-agent strings are unbounded; cap what we persist. */
export function truncateUserAgent(ua?: string | null, max = 400): string | null {
  const value = (ua ?? '').trim();
  if (value.length === 0) return null;
  return value.length > max ? value.slice(0, max) : value;
}

// ── Record construction ──────────────────────────────────────────────────────

export interface SignatureInput {
  organizationId: string;
  signableType: SignableType;
  signableId: string;
  signerName: string;
  signerEmail?: string | null;
  disclosure?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SignatureRecord {
  organizationId: string;
  signableType: SignableType;
  signableId: string;
  signerName: string;
  signerEmail: string | null;
  disclosureText: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Normalize a signing request into the row we persist. Always resolves the
 * disclosure (never stores an empty one) and normalizes the typed name.
 * Throws on an invalid signer name — callers validate first for a friendly
 * message; this is the last line of defense.
 */
export function buildSignatureRecord(input: SignatureInput): SignatureRecord {
  if (!isValidSignerName(input.signerName)) {
    throw new Error('invalid signer name');
  }
  const email = (input.signerEmail ?? '').trim().toLowerCase();
  return {
    organizationId: input.organizationId,
    signableType: input.signableType,
    signableId: input.signableId,
    signerName: normalizeSignerName(input.signerName),
    signerEmail: email.length > 0 ? email : null,
    disclosureText: resolveDisclosure(input.disclosure),
    ipAddress: input.ipAddress ?? null,
    userAgent: truncateUserAgent(input.userAgent),
  };
}

/** Human-readable signing timestamp for the approval record and the PDF. */
export function formatSignedAt(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
