/**
 * Pure intake-form domain logic (Task 10): the public form's option lists and
 * the spam heuristics. No I/O — unit-testable and shared by the public form,
 * the quick-intake form, and their server actions.
 */

/** Timeline choices a homeowner can pick on the public form. */
export const TIMELINE_OPTIONS = [
  'As soon as possible',
  'Within 1 month',
  '1–3 months',
  '3–6 months',
  'Just planning / budgeting',
] as const;

/** Budget brackets — a range is easier to answer honestly than a number. */
export const BUDGET_RANGES = [
  'Under $1,000',
  '$1,000 – $5,000',
  '$5,000 – $15,000',
  '$15,000 – $50,000',
  'Over $50,000',
  'Not sure yet',
] as const;

/** "How did you hear about us" options on the public form. */
export const HEARD_ABOUT_OPTIONS = [
  'Google search',
  'Facebook',
  'Referral from a friend',
  'Saw your truck / jobsite sign',
  'Repeat customer',
  'Other',
] as const;

// ── Spam screening ───────────────────────────────────────────────────────────

export interface SpamSignals {
  /** Value of the hidden honeypot field — humans leave it empty. */
  honeypot?: string | null;
  /** Seconds between form render and submit — bots submit instantly. */
  elapsedSeconds?: number | null;
  /** Free-text fields, checked for link stuffing. */
  text?: string | null;
}

export interface SpamVerdict {
  spam: boolean;
  reason: 'honeypot' | 'too_fast' | 'link_stuffing' | null;
}

const MIN_HUMAN_SECONDS = 3;
const MAX_LINKS = 2;

/**
 * Conservative spam screen for the public form. Real inquiries are never
 * blocked for content alone — only classic bot tells: a filled honeypot,
 * an instant submit, or link-stuffed text.
 */
export function screenForSpam(signals: SpamSignals): SpamVerdict {
  if (signals.honeypot && signals.honeypot.trim() !== '') {
    return { spam: true, reason: 'honeypot' };
  }
  if (
    typeof signals.elapsedSeconds === 'number' &&
    signals.elapsedSeconds >= 0 &&
    signals.elapsedSeconds < MIN_HUMAN_SECONDS
  ) {
    return { spam: true, reason: 'too_fast' };
  }
  const links = (signals.text ?? '').match(/https?:\/\//gi)?.length ?? 0;
  if (links > MAX_LINKS) {
    return { spam: true, reason: 'link_stuffing' };
  }
  return { spam: false, reason: null };
}

/** Compose the lead's description from the public form's structured answers. */
export function composeIntakeDescription(input: {
  description?: string | null;
  timeline?: string | null;
  budgetRange?: string | null;
}): string {
  const parts: string[] = [];
  if (input.description) parts.push(input.description.trim());
  const facts: string[] = [];
  if (input.timeline) facts.push(`Timeline: ${input.timeline}`);
  if (input.budgetRange) facts.push(`Budget: ${input.budgetRange}`);
  if (facts.length > 0) parts.push(facts.join(' · '));
  return parts.join('\n\n');
}
