import { z } from 'zod';

/** Zod schemas for proposal actions (Task 17). */

export const createProposalSchema = z.object({
  projectId: z.string().uuid(),
  estimateVersionId: z.string().uuid(),
});

export const markSentSchema = z.object({
  proposalId: z.string().uuid(),
  expiresInDays: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * Client response (Task 17, extended with the e-signature fields in Task 19).
 * Accepting is a signing act, so it additionally requires explicit consent to
 * sign electronically; declining does not.
 */
export const respondSchema = z
  .object({
    token: z.string().min(10).max(200),
    decision: z.enum(['accept', 'decline']),
    signerName: z.string().trim().min(2, 'Please enter your name.').max(200),
    signerEmail: z
      .union([z.string().trim().email('Enter a valid email address.'), z.literal('')])
      .optional(),
    consent: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'accept' && value.consent !== 'on') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['consent'],
        message: 'Please agree to sign electronically before accepting.',
      });
    }
  });
