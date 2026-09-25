import 'server-only';

import type { WebAnswersParams, WebAnswersResponse } from 'context.dev/resources/web';
import { z } from 'zod';

import { getContextDevClient, withContextDevRetry } from '@/lib/context-dev/client';

const quoteInputSchema = z.object({
  trade: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(200),
  scope: z.string().trim().min(1).max(1500),
});

export type QuoteJobInput = z.infer<typeof quoteInputSchema>;

const nullableNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  });

const quoteContentSchema = z.object({
  line_items: z
    .array(
      z.object({
        description: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        quantity: nullableNumber,
        unit_cost_low: nullableNumber,
        unit_cost_high: nullableNumber,
      }),
    )
    .optional()
    .default([]),
  assumptions: z.array(z.string()).optional().default([]),
  exclusions: z.array(z.string()).optional().default([]),
});

export type JobQuoteLineItem = {
  description: string;
  category: string;
  unit: string | null;
  quantity: number | null;
  unitCostLow: number | null;
  unitCostHigh: number | null;
};

export type JobQuoteDraft = {
  verified: false;
  disclaimer: string;
  trade: string;
  location: string;
  scope: string;
  lineItems: JobQuoteLineItem[];
  assumptions: string[];
  exclusions: string[];
  sources: string[];
  partial: boolean;
  creditsConsumed: number | null;
  creditsRemaining: number | null;
};

export const QUOTE_DISCLAIMER =
  'Unverified web research draft. Confirm every cost before sending a bid. This is not a firm quote.';

export const QUOTE_JSON_FORMAT = {
  line_items: [
    {
      description: '',
      category: '',
      unit: '',
      quantity: 0,
      unit_cost_low: 0,
      unit_cost_high: 0,
    },
  ],
  assumptions: [''],
  exclusions: [''],
} as const;

export type AnswersFn = (body: WebAnswersParams) => Promise<WebAnswersResponse>;

export function buildQuoteTask(input: QuoteJobInput): string {
  const task = [
    `Draft a residential remodeling cost range for a ${input.trade} job.`,
    `Location: ${input.location}.`,
    `Scope: ${input.scope}`,
    'Use public US sources for typical unit-cost ranges in US dollars.',
    'Separate material, labor, equipment, and subcontractor items.',
    'State quantity assumptions. Do not present this as a firm bid.',
    'Leave unknown costs null.',
  ].join(' ');

  if (task.length > 2000) {
    throw new Error('Quote task exceeds 2000 characters');
  }
  return task;
}

export async function quoteJob(
  input: QuoteJobInput,
  deps?: { answers?: AnswersFn },
): Promise<JobQuoteDraft> {
  const parsed = quoteInputSchema.parse(input);
  const answers = deps?.answers ?? defaultAnswers;
  const response = await answers({
    mode: 'fast',
    task: buildQuoteTask(parsed),
    json_format: QUOTE_JSON_FORMAT,
    timeoutOpts: { milliseconds: 30_000, behavior: 'return-partial' },
    tags: ['job-quote'],
  });

  const content = quoteContentSchema.parse(response.json_content);
  const lineItems = content.line_items
    .map((item) => ({
      description: item.description?.trim() ?? '',
      category: item.category?.trim().toLowerCase() ?? '',
      unit: blankToNull(item.unit),
      quantity: item.quantity,
      unitCostLow: item.unit_cost_low,
      unitCostHigh: item.unit_cost_high,
    }))
    .filter((item) => item.description.length > 0);

  return {
    verified: false,
    disclaimer: QUOTE_DISCLAIMER,
    trade: parsed.trade,
    location: parsed.location,
    scope: parsed.scope,
    lineItems,
    assumptions: content.assumptions.map((item) => item.trim()).filter(Boolean),
    exclusions: content.exclusions.map((item) => item.trim()).filter(Boolean),
    sources: response.sources,
    partial: response.partial === true,
    creditsConsumed: response.key_metadata?.credits_consumed ?? null,
    creditsRemaining: response.key_metadata?.credits_remaining ?? null,
  };
}

async function defaultAnswers(body: WebAnswersParams): Promise<WebAnswersResponse> {
  const client = getContextDevClient();
  return withContextDevRetry(() => client.web.answers(body));
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
