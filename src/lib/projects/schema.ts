import { z } from 'zod';
import { PROJECT_STATUSES, PERMIT_STATUSES, PAYMENT_STATES } from './projects-core';

/** Shared Zod schemas for project input (Task 11). */

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

const optionalUuid = z
  .union([z.literal(''), z.string().uuid()])
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalDate = z
  .union([z.literal(''), z.string().date()])
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalMoney = z
  .union([z.literal(''), z.coerce.number().nonnegative('Amounts can’t be negative.')])
  .optional()
  .transform((v) => (v === '' || v === undefined ? undefined : Number(v)));

export const projectInputSchema = z.object({
  name: z.string().trim().min(2, 'Give the project a name.').max(200),
  clientId: z.string().uuid('Choose a client.'),
  propertyId: optionalUuid,
  projectType: optionalTrimmed,
  status: z.enum(PROJECT_STATUSES).default('planning'),
  projectManagerId: optionalUuid,
  foremanId: optionalUuid,
  salespersonId: optionalUuid,
  contractValue: optionalMoney,
  budget: optionalMoney,
  expectedStart: optionalDate,
  expectedCompletion: optionalDate,
  actualStart: optionalDate,
  actualCompletion: optionalDate,
  permitStatus: z.enum(PERMIT_STATUSES).default('not_required'),
  paymentState: z.enum(PAYMENT_STATES).default('none'),
  description: optionalText,
  internalNotes: optionalText,
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

export const statusChangeSchema = z.object({
  projectId: z.string().uuid(),
  status: z.enum(PROJECT_STATUSES),
});

export const teamMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid('Choose a team member.'),
});

export const projectNoteSchema = z.object({
  projectId: z.string().uuid(),
  summary: z.string().trim().min(1, 'Add a note.').max(2000),
});
