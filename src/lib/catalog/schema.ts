import { z } from 'zod';
import { UNITS, TIERS } from './catalog-core';

/** Zod schemas for cost-catalog item input (Task 15). */

const optionalTrimmed = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalText = z
  .string()
  .trim()
  .max(5000)
  .optional()
  .transform((v) => (v ? v : undefined));

const money = z
  .union([z.literal(''), z.coerce.number().nonnegative('Costs can’t be negative.')])
  .optional()
  .transform((v) => (v === '' || v === undefined ? 0 : Number(v)));

/** Waste is entered as a whole percent (5) and stored as a fraction (0.05). */
const wastePercent = z
  .union([
    z.literal(''),
    z.coerce.number().min(0, 'Waste can’t be negative.').max(100, 'Waste is a percent (0–100).'),
  ])
  .optional()
  .transform((v) => (v === '' || v === undefined ? 0 : Number(v) / 100));

export const catalogItemSchema = z.object({
  name: z.string().trim().min(2, 'Give the item a name.').max(300),
  trade: optionalTrimmed,
  description: optionalText,
  unit: z.enum(UNITS).default('each'),
  defaultMaterialCost: money,
  defaultLaborHours: money,
  defaultLaborRate: money,
  equipmentCost: money,
  wastePct: wastePercent,
  vendor: optionalTrimmed,
  vendorItemNumber: optionalTrimmed,
  region: optionalTrimmed,
  tier: z.enum(TIERS).default('standard'),
  lastVerifiedDate: z
    .union([z.literal(''), z.string().date()])
    .optional()
    .transform((v) => (v ? v : undefined)),
  notes: optionalText,
});

export type CatalogItemInput = z.infer<typeof catalogItemSchema>;

export const itemIdSchema = z.object({
  itemId: z.string().uuid(),
});
