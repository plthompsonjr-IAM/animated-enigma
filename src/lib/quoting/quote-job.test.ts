import { describe, expect, it, vi } from 'vitest';
import type { WebAnswersResponse } from 'context.dev/resources/web';

import { LOWES_CHECK_REQUIRED, type LowesMaterialResult } from './lowes-material';
import { QUOTE_DISCLAIMER, quoteJob, type AnswersFn } from './quote-job';

describe('quoteJob', () => {
  it('maps a sourced answer into an unverified draft', async () => {
    const answers = vi.fn<AnswersFn>(async () => answer());

    const draft = await quoteJob(
      {
        trade: 'interior carpentry',
        location: 'United States national average',
        scope: 'Replace one interior prehung door.',
      },
      { answers, lowes: fakeLowes },
    );

    expect(answers).toHaveBeenCalledTimes(1);
    const request = answers.mock.calls[0]?.[0];
    expect(request?.mode).toBe('fast');
    expect(request?.tags).toEqual(['job-quote']);
    expect(request?.timeoutOpts).toEqual({ milliseconds: 30_000, behavior: 'return-partial' });
    expect(request?.task).toContain('interior carpentry');
    expect(request?.task).toContain('United States national average');
    expect(request?.task).toContain('Replace one interior prehung door.');
    expect(request?.task).toContain("Lowe's");

    expect(draft.verified).toBe(false);
    expect(draft.disclaimer).toBe(QUOTE_DISCLAIMER);
    expect(draft.partial).toBe(false);
    expect(draft.lineItems).toEqual([lowesDoor]);
    expect(draft.assumptions).toEqual(['Standard 60-inch door opening.']);
    expect(draft.exclusions).toEqual(['Paint and casing.']);
    expect(draft.sources).toEqual([
      'https://www.lowes.com/pd/JELD-WEN-60-in-Interior-Door/5012345678',
      'https://example.com/door-costs',
    ]);
    expect(draft.creditsConsumed).toBe(12);
    expect(draft.creditsRemaining).toBe(988);
  });

  it('preserves a partial research result and drops blank lines', async () => {
    const answers = vi.fn<AnswersFn>(async () =>
      answer({
        partial: true,
        json_content: {
          line_items: [
            {
              description: '  Hang door  ',
              category: 'Labor',
              unit: '',
              quantity: '$2',
              unit_cost_low: null,
              unit_cost_high: '90',
            },
            {
              description: '   ',
              category: 'material',
              unit: 'each',
              quantity: 1,
              unit_cost_low: 1,
              unit_cost_high: 2,
            },
          ],
          assumptions: ['', 'Opening is plumb.'],
          exclusions: ['  '],
        },
      }),
    );

    const draft = await quoteJob(
      { trade: 'carpentry', location: 'Ohio', scope: 'Hang one door.' },
      { answers, lowes: async () => emptyLowes },
    );

    expect(draft.partial).toBe(true);
    expect(draft.lineItems).toEqual([
      {
        description: 'Hang door',
        category: 'labor',
        unit: null,
        quantity: 2,
        unitCostLow: null,
        unitCostHigh: 90,
        vendor: null,
        itemNumber: null,
        productUrl: null,
        verification: null,
      },
    ]);
    expect(draft.assumptions).toEqual(['Opening is plumb.']);
    expect(draft.exclusions).toEqual([]);
  });
});

const lowesDoor = {
  description: 'JELD-WEN 60 in. White Interior Door',
  category: 'material' as const,
  vendor: "Lowe's" as const,
  itemNumber: '5012345678',
  unit: 'each' as const,
  quantity: null,
  unitCostLow: 214,
  unitCostHigh: 214,
  productUrl: 'https://www.lowes.com/pd/JELD-WEN-60-in-Interior-Door/5012345678',
  verification: LOWES_CHECK_REQUIRED,
};

const emptyLowes: LowesMaterialResult = {
  materials: [],
  sources: [],
  partial: false,
  creditsConsumed: 1,
  creditsRemaining: 100,
  note: LOWES_CHECK_REQUIRED,
};

function fakeLowes(): Promise<LowesMaterialResult> {
  const result: LowesMaterialResult = {
    materials: [lowesDoor],
    sources: [lowesDoor.productUrl],
    partial: false,
    creditsConsumed: 2,
    creditsRemaining: 988,
    note: LOWES_CHECK_REQUIRED,
  };
  return Promise.resolve(result);
}

function answer(overrides: Partial<WebAnswersResponse> = {}): WebAnswersResponse {
  return {
    json_content: {
      line_items: [
        {
          description: 'Prehung interior door',
          category: 'material',
          unit: 'each',
          quantity: 1,
          unit_cost_low: 120,
          unit_cost_high: 280,
        },
      ],
      assumptions: ['Standard 60-inch door opening.'],
      exclusions: ['Paint and casing.'],
    },
    sources: ['https://example.com/door-costs'],
    key_metadata: { credits_consumed: 10, credits_remaining: 990 },
    ...overrides,
  };
}
