import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONTRACT_TERMS,
  hasUnresolvedBlanks,
  parseTerms,
  renderSections,
  renderTerms,
  resolveTerms,
  serializeTerms,
  unresolvedBlanks,
  type TermsSection,
} from './terms-core';

describe('renderTerms', () => {
  it('substitutes known placeholders', () => {
    expect(renderTerms('Total is {{contract_value}}.', { contract_value: '$14,500.00' })).toBe(
      'Total is $14,500.00.',
    );
  });

  it('leaves unknown or empty placeholders visible so mistakes are caught', () => {
    expect(renderTerms('Hello {{nope}}', {})).toBe('Hello {{nope}}');
    expect(renderTerms('Hi {{client_name}}', { client_name: '' })).toBe('Hi {{client_name}}');
  });

  it('substitutes repeated placeholders everywhere', () => {
    expect(renderTerms('{{org_name}} — {{org_name}}', { org_name: 'PTTR' })).toBe('PTTR — PTTR');
  });
});

describe('renderSections', () => {
  it('renders headings and bodies', () => {
    const sections: TermsSection[] = [
      { heading: '{{org_name}} terms', body: 'For {{client_name}}.' },
    ];
    expect(renderSections(sections, { org_name: 'PTTR', client_name: 'Jane' })).toEqual([
      { heading: 'PTTR terms', body: 'For Jane.' },
    ]);
  });
});

describe('parseTerms', () => {
  it('reads a heading line followed by its paragraph', () => {
    expect(parseTerms('Warranty\nWe warrant the work for one year.')).toEqual([
      { heading: 'Warranty', body: 'We warrant the work for one year.' },
    ]);
  });

  it('splits blocks on blank lines', () => {
    const parsed = parseTerms('Warranty\nOne year.\n\nPayment\nNet 30.');
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ heading: 'Payment', body: 'Net 30.' });
  });

  it('treats a lone paragraph as an unheaded section', () => {
    expect(parseTerms('Just a single paragraph of terms.')).toEqual([
      { heading: '', body: 'Just a single paragraph of terms.' },
    ]);
  });

  it('does not mistake a sentence for a heading', () => {
    const parsed = parseTerms('This is a full sentence.\nAnd more text.');
    expect(parsed[0]?.heading).toBe('');
    expect(parsed[0]?.body).toContain('This is a full sentence.');
  });

  it('ignores stray blank lines', () => {
    expect(parseTerms('\n\nWarranty\nOne year.\n\n\n')).toHaveLength(1);
  });
});

describe('resolveTerms', () => {
  it('falls back to the starter template when unset', () => {
    expect(resolveTerms(null)).toBe(DEFAULT_CONTRACT_TERMS);
    expect(resolveTerms('   ')).toBe(DEFAULT_CONTRACT_TERMS);
  });

  it('parses the org’s own terms when configured', () => {
    expect(resolveTerms('Payment\nNet 30.')).toEqual([{ heading: 'Payment', body: 'Net 30.' }]);
  });
});

describe('starter template', () => {
  it('covers the clauses a residential job needs', () => {
    const headings = DEFAULT_CONTRACT_TERMS.map((s) => s.heading.toLowerCase());
    for (const expected of [
      'scope of work',
      'contract price and payment',
      'change orders',
      'warranty',
      'insurance and licensing',
      'dispute resolution',
    ]) {
      expect(headings).toContain(expected);
    }
  });

  it('is flagged as unfinished until the bracketed blanks are filled in', () => {
    expect(hasUnresolvedBlanks(DEFAULT_CONTRACT_TERMS)).toBe(true);
    const blanks = unresolvedBlanks(DEFAULT_CONTRACT_TERMS);
    expect(blanks).toContain('LICENSE NUMBER');
    expect(blanks).toContain('WARRANTY PERIOD');
    expect(blanks).toContain('STATE');
  });

  it('reports clean terms as finished', () => {
    expect(hasUnresolvedBlanks([{ heading: 'Payment', body: 'Net 30 days.' }])).toBe(false);
    expect(unresolvedBlanks([{ heading: 'Payment', body: 'Net 30 days.' }])).toEqual([]);
  });

  it('uses only supported placeholders', () => {
    const used = new Set<string>();
    for (const section of DEFAULT_CONTRACT_TERMS) {
      for (const match of `${section.heading} ${section.body}`.matchAll(/\{\{(\w+)\}\}/g)) {
        if (match[1]) used.add(match[1]);
      }
    }
    const rendered = renderSections(DEFAULT_CONTRACT_TERMS, {
      org_name: 'PTTR',
      client_name: 'Jane Dorsey',
      contract_number: 'CON-2026-0001',
      contract_value: '$14,500.00',
      project_address: '123 Main St',
      project_name: 'Hall bath remodel',
      today: 'July 25, 2026',
    });
    // Every placeholder the template uses must be fillable.
    expect(rendered.some((s) => s.body.includes('{{'))).toBe(false);
    expect(used.size).toBeGreaterThan(0);
  });
});

describe('serializeTerms', () => {
  it('round-trips through parseTerms', () => {
    const sections: TermsSection[] = [
      { heading: 'Warranty', body: 'One year on workmanship.' },
      { heading: 'Payment', body: 'Net 30.' },
    ];
    expect(parseTerms(serializeTerms(sections))).toEqual(sections);
  });

  it('omits the heading line for unheaded sections', () => {
    expect(serializeTerms([{ heading: '', body: 'Plain terms.' }])).toBe('Plain terms.');
  });
});
