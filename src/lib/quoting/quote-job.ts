import 'server-only';

import type { WebAnswersParams, WebAnswersResponse } from 'context.dev/resources/web';
import { z } from 'zod';

import { getContextDevClient, withContextDevRetry } from '@/lib/context-dev/client';
import { sourceLowesMaterial, type LowesMaterialResult } from '@/lib/quoting/lowes-material';

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
  vendor: string | null;
  itemNumber: string | null;
  productUrl: string | null;
  verification: string | null;
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
  "Unverified draft. Material prices are read from a Lowe's product page and are NOT VERIFIED — CHECK REQUIRED. Confirm every cost before sending a bid.";

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
    "Do not price materials. Material item numbers and prices are sourced from Lowe's separately.",
    'Return labor, equipment, and subcontractor unit-cost ranges only, in US dollars.',
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
  deps?: { answers?: AnswersFn; lowes?: (scope: string) => Promise<LowesMaterialResult> },
): Promise<JobQuoteDraft> {
  const parsed = quoteInputSchema.parse(input);
  const answers = deps?.answers ?? defaultAnswers;
  const lowes = deps?.lowes ?? ((scope: string) => sourceLowesMaterial({ scope }));
  const [response, lowesMaterials] = await Promise.all([
    answers({
      mode: 'fast',
      task: buildQuoteTask(parsed),
      json_format: QUOTE_JSON_FORMAT,
      timeoutOpts: { milliseconds: 30_000, behavior: 'return-partial' },
      tags: ['job-quote'],
    }),
    lowes(parsed.scope),
  ]);

  const content = quoteContentSchema.parse(response.json_content);
  const laborLines = content.line_items
    .map((item) => ({
      description: item.description?.trim() ?? '',
      category: item.category?.trim().toLowerCase() ?? '',
      unit: blankToNull(item.unit),
      quantity: item.quantity,
      unitCostLow: item.unit_cost_low,
      unitCostHigh: item.unit_cost_high,
      vendor: null,
      itemNumber: null,
      productUrl: null,
      verification: null,
    }))
    .filter((item) => item.description.length > 0 && item.category !== 'material');

  return {
    verified: false,
    disclaimer: QUOTE_DISCLAIMER,
    trade: parsed.trade,
    location: parsed.location,
    scope: parsed.scope,
    lineItems: [...lowesMaterials.materials, ...laborLines],
    assumptions: content.assumptions.map((item) => item.trim()).filter(Boolean),
    exclusions: content.exclusions.map((item) => item.trim()).filter(Boolean),
    sources: [...lowesMaterials.sources, ...response.sources],
    partial: response.partial === true || lowesMaterials.partial,
    creditsConsumed: sumCredits(
      lowesMaterials.creditsConsumed,
      response.key_metadata?.credits_consumed ?? null,
    ),
    creditsRemaining: minCredits(
      lowesMaterials.creditsRemaining,
      response.key_metadata?.credits_remaining ?? null,
    ),
  };
}

async function defaultAnswers(body: WebAnswersParams): Promise<WebAnswersResponse> {
  const client = getContextDevClient();
  return withContextDevRetry(() => client.web.answers(body));
}

function sumCredits(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function minCredits(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
