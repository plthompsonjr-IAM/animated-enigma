/**
 * Contract terms & conditions (Task 20b): the starter template, placeholder
 * substitution, and the section model used by the printable contract. Pure —
 * no I/O, fully unit-testable.
 *
 * IMPORTANT — this is a STARTER, not legal advice. The default template below
 * is generic residential-construction boilerplate written to be edited. It has
 * deliberate [BRACKETED] blanks for the things only the contractor and their
 * attorney can supply (license number, cancellation window, venue). Nothing
 * here has been reviewed by a lawyer and it makes no claim to satisfy any
 * jurisdiction. `hasUnresolvedBlanks` exists so the UI can nag until they are
 * filled in.
 */

export interface TermsSection {
  heading: string;
  body: string;
}

/**
 * Placeholders are `{{snake_case}}`. Unknown placeholders are left visible
 * rather than silently blanked, so a typo shows up on the page instead of
 * quietly producing an empty clause.
 */
export const TERMS_PLACEHOLDERS = [
  'org_name',
  'client_name',
  'contract_number',
  'contract_value',
  'project_address',
  'project_name',
  'today',
] as const;
export type TermsPlaceholder = (typeof TERMS_PLACEHOLDERS)[number];

export type TermsVariables = Partial<Record<TermsPlaceholder, string>>;

/**
 * The default terms. Sections are ordered as they print. Bracketed ALL-CAPS
 * blanks are intentional and must be replaced by the contractor.
 */
export const DEFAULT_CONTRACT_TERMS: TermsSection[] = [
  {
    heading: 'Parties and agreement',
    body: 'This agreement is made between {{org_name}} ("Contractor") and {{client_name}} ("Owner") for work at {{project_address}}. This document, together with the attached scope of work and payment schedule, is the entire agreement between the parties and replaces any prior discussions, estimates, or proposals. It may be changed only by a written change order signed by both parties.',
  },
  {
    heading: 'Scope of work',
    body: 'Contractor will furnish the labor, materials, and supervision described in the attached scope of work for {{project_name}}. Work not expressly listed in that scope is excluded. Contractor will perform the work in a good and workmanlike manner and in compliance with applicable building codes.',
  },
  {
    heading: 'Contract price and payment',
    body: 'The total contract price is {{contract_value}}. Owner will pay according to the payment schedule attached to this agreement. Payments are due within [NUMBER] days of invoice. Amounts unpaid past their due date may accrue interest at [RATE]% per month or the maximum permitted by law, whichever is less. Contractor may suspend work if payment is more than [NUMBER] days late.',
  },
  {
    heading: 'Change orders',
    body: 'Any change to the scope, price, or schedule must be documented in a written change order signed by both parties before the changed work begins. Concealed or unforeseen conditions discovered after work starts — including hidden damage, code violations, or conditions not visible during the initial inspection — will be handled by change order.',
  },
  {
    heading: 'Schedule',
    body: "Contractor will begin work on or about [START DATE] and will pursue the work diligently to completion, subject to delays beyond Contractor's reasonable control, including weather, permit or inspection delays, material availability, and Owner-requested changes. Time is not of the essence unless separately agreed in writing.",
  },
  {
    heading: 'Permits and approvals',
    body: 'Contractor will obtain the building permits required for the work unless stated otherwise in the scope. Owner is responsible for association, historic district, or other private approvals, and for providing access to the property during normal working hours.',
  },
  {
    heading: 'Allowances',
    body: 'Where the scope includes an allowance for materials or fixtures, the allowance covers the stated amount only. Selections costing more or less than the allowance will be reconciled by change order or on the final invoice.',
  },
  {
    heading: 'Warranty',
    body: 'Contractor warrants its workmanship for a period of [WARRANTY PERIOD] from substantial completion. Manufacturer warranties on materials and appliances pass through to Owner and are not extended by this warranty. This warranty does not cover normal wear, damage from misuse or neglect, alterations by others, or conditions outside the contracted scope.',
  },
  {
    heading: 'Insurance and licensing',
    body: "Contractor maintains general liability insurance and, where required, workers' compensation coverage. Contractor's license number, where applicable, is [LICENSE NUMBER]. Certificates of insurance are available to Owner on request.",
  },
  {
    heading: "Owner's right to cancel",
    body: 'Owner may cancel this agreement without penalty or obligation within [CANCELLATION PERIOD] of signing, in writing, delivered to Contractor at the address above. Cancellation rights vary by state and by where the contract was signed — [VERIFY THE REQUIRED NOTICE AND WORDING FOR YOUR JURISDICTION WITH COUNSEL].',
  },
  {
    heading: 'Termination',
    body: 'Either party may terminate for material breach if the breach is not cured within [NUMBER] days of written notice. On termination, Owner will pay for work performed and materials ordered through the termination date, plus any non-refundable costs reasonably incurred.',
  },
  {
    heading: 'Dispute resolution',
    body: 'The parties will attempt in good faith to resolve any dispute directly. Disputes not resolved that way will be handled by [MEDIATION / ARBITRATION / COURTS] in [COUNTY, STATE], and this agreement is governed by the laws of [STATE].',
  },
];

/**
 * Substitute `{{placeholders}}`. Values are inserted as-is (the print view
 * renders them as text, never HTML). Unknown names are left in place so
 * mistakes are visible.
 */
export function renderTerms(text: string, variables: TermsVariables): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = variables[name as TermsPlaceholder];
    return value !== undefined && value !== '' ? value : match;
  });
}

/** Apply {@link renderTerms} across a whole section list. */
export function renderSections(
  sections: TermsSection[],
  variables: TermsVariables,
): TermsSection[] {
  return sections.map((section) => ({
    heading: renderTerms(section.heading, variables),
    body: renderTerms(section.body, variables),
  }));
}

/**
 * Parse an org's stored terms. The storage format is plain text: a line that
 * is a heading followed by its paragraph(s), with blank lines between blocks.
 * A heading is a short line (no trailing period) — deliberately forgiving so
 * the contractor can paste terms from a Word document without markup.
 */
export function parseTerms(raw: string): TermsSection[] {
  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const sections: TermsSection[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim());
    const [first, ...rest] = lines;
    if (first && rest.length > 0 && looksLikeHeading(first)) {
      sections.push({ heading: first, body: rest.join(' ').trim() });
    } else {
      sections.push({ heading: '', body: lines.join(' ').trim() });
    }
  }
  return sections;
}

function looksLikeHeading(line: string): boolean {
  return line.length <= 80 && !line.endsWith('.') && !line.endsWith(';');
}

/** The org's terms if configured, else the starter template. */
export function resolveTerms(configured?: string | null): TermsSection[] {
  const raw = (configured ?? '').trim();
  return raw.length > 0 ? parseTerms(raw) : DEFAULT_CONTRACT_TERMS;
}

/** True when the terms still contain [BRACKETED] blanks that need filling in. */
export function hasUnresolvedBlanks(sections: TermsSection[]): boolean {
  return sections.some((s) => /\[[A-Z][^\]]*\]/.test(s.body) || /\[[A-Z][^\]]*\]/.test(s.heading));
}

/** The blanks still outstanding, de-duplicated, for a "finish these" nudge. */
export function unresolvedBlanks(sections: TermsSection[]): string[] {
  const found = new Set<string>();
  for (const section of sections) {
    for (const text of [section.heading, section.body]) {
      for (const match of text.matchAll(/\[([A-Z][^\]]*)\]/g)) {
        if (match[1]) found.add(match[1]);
      }
    }
  }
  return [...found];
}

/** Serialize sections back to the plain-text storage format. */
export function serializeTerms(sections: TermsSection[]): string {
  return sections.map((s) => (s.heading ? `${s.heading}\n${s.body}` : s.body)).join('\n\n');
}
