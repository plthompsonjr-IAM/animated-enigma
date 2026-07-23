import { z } from 'zod';
import { LEAD_STATUSES, PRIORITIES } from './leads-core';

/** Shared Zod schemas for lead input — used by forms, actions, and (later) AI drafts. */

const optionalTrimmed = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalText = z
  .string()
  .trim()
  .max(5000)
  .optional()
  .transform((v) => (v ? v : undefined));

export const leadInputSchema = z.object({
  leadName: z.string().trim().min(2, 'Give the lead a short name.').max(200),
  clientName: optionalTrimmed,
  phone: optionalTrimmed,
  email: z
    .union([z.literal(''), z.string().trim().email('Enter a valid email or leave blank.')])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  propertyAddress: optionalTrimmed,
  projectType: optionalTrimmed,
  leadSource: optionalTrimmed,
  estimatedBudget: z
    .union([z.literal(''), z.coerce.number().nonnegative('Budget cannot be negative.')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : Number(v))),
  desiredStartDate: z
    .union([z.literal(''), z.string().date()])
    .optional()
    .transform((v) => (v ? v : undefined)),
  description: optionalText,
  assignedTo: z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .transform((v) => (v ? v : undefined)),
  status: z.enum(LEAD_STATUSES).default('new'),
  priority: z.enum(PRIORITIES).default('medium'),
  nextFollowUpDate: z
    .union([z.literal(''), z.string().date()])
    .optional()
    .transform((v) => (v ? v : undefined)),
  notes: optionalText,
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export const statusChangeSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum(LEAD_STATUSES),
});

export const assignSchema = z.object({
  leadId: z.string().uuid(),
  assignedTo: z.union([z.literal(''), z.string().uuid()]).transform((v) => (v ? v : null)),
});

export const activitySchema = z.object({
  leadId: z.string().uuid(),
  activityType: z.enum(['note', 'call', 'email', 'meeting']).default('note'),
  summary: z.string().trim().min(1, 'Add a note.').max(2000),
});

export const followUpSchema = z.object({
  leadId: z.string().uuid(),
  nextFollowUpDate: z.union([z.literal(''), z.string().date()]).transform((v) => (v ? v : null)),
});
