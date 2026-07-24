import { z } from 'zod';
import { LINE_TYPES } from './estimate-core';
import { UNITS } from '@/lib/catalog/catalog-core';
import { VERSION_STATUSES } from '@/lib/scopes/scopes-core';

/** Zod schemas for estimate editing (Task 16). */

export const createEstimateSchema = z.object({
  projectId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  scopeVersionId: z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const qty = z.coerce.number().nonnegative('Quantity can’t be negative.').max(1_000_000);
const money = z.coerce.number().nonnegative('Cost can’t be negative.').max(100_000_000);
const percent = z
  .union([z.literal(''), z.coerce.number().min(0).max(100)])
  .optional()
  .transform((v) => (v === '' || v === undefined ? 0 : Number(v) / 100));

/** Add a line from a catalog item — costs snapshot server-side from the item. */
export const addCatalogLineSchema = z.object({
  estimateVersionId: z.string().uuid(),
  catalogItemId: z.string().uuid(),
  quantity: qty.default(1),
});

/** Add or edit a free-form line. */
export const lineSchema = z.object({
  estimateVersionId: z.string().uuid(),
  description: z.string().trim().min(1, 'Add a description.').max(500),
  lineType: z.enum(LINE_TYPES).default('material'),
  quantity: qty.default(1),
  unit: z.enum(UNITS).default('each'),
  unitCost: money.default(0),
  wasteFactorPct: percent,
  taxable: z
    .union([z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((v) => v !== 'false'),
});

export const updateLineSchema = z.object({
  lineId: z.string().uuid(),
  description: z.string().trim().min(1, 'Add a description.').max(500),
  lineType: z.enum(LINE_TYPES),
  quantity: qty,
  unit: z.enum(UNITS),
  unitCost: money,
  wasteFactorPct: percent,
  taxable: z
    .union([z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((v) => v !== 'false'),
});

export const ratesSchema = z.object({
  estimateVersionId: z.string().uuid(),
  overheadPct: percent,
  profitPct: percent,
  taxRate: percent,
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const statusChangeSchema = z.object({
  versionId: z.string().uuid(),
  status: z.enum(VERSION_STATUSES),
});
