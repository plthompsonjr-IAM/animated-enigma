import { z } from 'zod';
import { PRIORITIES } from '@/lib/leads/leads-core';

/** Zod schemas for the public intake form and the internal quick-intake form. */

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

export const publicIntakeSchema = z
  .object({
    name: z.string().trim().min(2, 'Please tell us your name.').max(200),
    phone: optionalTrimmed,
    email: z
      .union([z.literal(''), z.string().trim().email('Please check your email address.')])
      .optional()
      .transform((v) => (v ? v.toLowerCase() : undefined)),
    address: optionalTrimmed,
    projectType: optionalTrimmed,
    timeline: optionalTrimmed,
    budgetRange: optionalTrimmed,
    description: optionalText,
    heardAbout: optionalTrimmed,
    /** Honeypot — rendered invisibly; humans never fill it. */
    website: z.string().optional(),
    /** Render timestamp (ms since epoch) for the too-fast-submit check. */
    startedAt: z.string().optional(),
  })
  .refine((v) => v.phone || v.email, {
    message: 'Please include a phone number or an email so we can reach you.',
    path: ['phone'],
  });

export type PublicIntakeInput = z.infer<typeof publicIntakeSchema>;

export const quickIntakeSchema = z.object({
  clientName: z.string().trim().min(2, 'Who called? Add a name.').max(200),
  phone: optionalTrimmed,
  email: z
    .union([z.literal(''), z.string().trim().email('Enter a valid email or leave blank.')])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  propertyAddress: optionalTrimmed,
  projectType: optionalTrimmed,
  leadSource: optionalTrimmed,
  description: optionalText,
  priority: z.enum(PRIORITIES).default('medium'),
  nextFollowUpDate: z
    .union([z.literal(''), z.string().date()])
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Which button submitted: stay for the next call, or open the lead. */
  next: z.enum(['another', 'open']).default('open'),
});

export type QuickIntakeInput = z.infer<typeof quickIntakeSchema>;
