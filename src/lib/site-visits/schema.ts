import { z } from 'zod';
import { VISIT_TYPES } from './site-visits-core';

/** Zod schemas for scheduling and completing site visits (Task 12). */

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

/** A visit attaches to exactly one of a lead or a project. */
export const scheduleVisitSchema = z
  .object({
    leadId: optionalUuid,
    projectId: optionalUuid,
    visitType: z.enum(VISIT_TYPES).default('estimate'),
    // datetime-local yields "YYYY-MM-DDTHH:mm"; treat as required to schedule.
    scheduledAt: z
      .string()
      .trim()
      .min(1, 'Pick a date and time.')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Pick a valid date and time.'),
    durationMinutes: z.coerce.number().int().positive().max(1440).default(60),
    assignedTo: optionalUuid,
    notes: optionalText,
  })
  .refine((v) => Boolean(v.leadId) !== Boolean(v.projectId), {
    message: 'A visit must belong to either a lead or a project.',
    path: ['leadId'],
  });

export type ScheduleVisitInput = z.infer<typeof scheduleVisitSchema>;

export const rescheduleVisitSchema = z.object({
  visitId: z.string().uuid(),
  scheduledAt: z
    .string()
    .trim()
    .min(1, 'Pick a date and time.')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Pick a valid date and time.'),
  durationMinutes: z.coerce.number().int().positive().max(1440).default(60),
});

export const assignVisitSchema = z.object({
  visitId: z.string().uuid(),
  assignedTo: z.union([z.literal(''), z.string().uuid()]).transform((v) => (v ? v : null)),
});

export const completeVisitSchema = z.object({
  visitId: z.string().uuid(),
  notes: optionalText,
  measurements: optionalText,
});
