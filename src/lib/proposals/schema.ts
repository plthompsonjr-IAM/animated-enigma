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

export const respondSchema = z.object({
  token: z.string().min(10).max(200),
  decision: z.enum(['accept', 'decline']),
  signerName: z.string().trim().min(2, 'Please enter your name.').max(200),
});
