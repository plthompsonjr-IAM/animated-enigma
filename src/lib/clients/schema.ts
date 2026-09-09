import { z } from 'zod';
import { CLIENT_TYPES, CONTACT_METHODS, OCCUPANCY_STATUSES } from './clients-core';

/** Shared Zod schemas for client & property input (Task 9). */

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

const optionalEmail = z
  .union([z.literal(''), z.string().trim().email('Enter a valid email or leave blank.')])
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined));

export const clientInputSchema = z.object({
  clientType: z.enum(CLIENT_TYPES).default('individual'),
  displayName: z.string().trim().min(2, 'Enter the client’s name.').max(200),
  companyName: optionalTrimmed,
  primaryPhone: optionalTrimmed,
  primaryEmail: optionalEmail,
  addressLine1: optionalTrimmed,
  addressLine2: optionalTrimmed,
  addressCity: optionalTrimmed,
  addressState: optionalTrimmed,
  addressZip: optionalTrimmed,
  preferredContactMethod: z
    .union([z.literal(''), z.enum(CONTACT_METHODS)])
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Comma-separated in the form → cleaned string array. */
  tags: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) =>
      v
        ? [
            ...new Set(
              v
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ]
        : [],
    ),
  notes: optionalText,
  /** Set when the office reviewed the duplicate warning and chose to proceed. */
  confirmDuplicate: z
    .union([z.literal('true'), z.literal('')])
    .optional()
    .transform((v) => v === 'true'),
});

export type ClientInput = z.infer<typeof clientInputSchema>;

export const contactInputSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1, 'Enter the contact’s name.').max(200),
  role: optionalTrimmed,
  phone: optionalTrimmed,
  email: optionalEmail,
  isPrimary: z
    .union([z.literal('true'), z.literal('')])
    .optional()
    .transform((v) => v === 'true'),
});

const currentYear = new Date().getUTCFullYear();

export const propertyInputSchema = z.object({
  clientId: z.string().uuid(),
  addressLine1: z.string().trim().min(3, 'Enter the street address.').max(500),
  addressLine2: optionalTrimmed,
  addressCity: optionalTrimmed,
  addressState: optionalTrimmed,
  addressZip: optionalTrimmed,
  propertyType: optionalTrimmed,
  squareFootage: z
    .union([z.literal(''), z.coerce.number().int().positive('Square footage must be positive.')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : Number(v))),
  yearBuilt: z
    .union([
      z.literal(''),
      z.coerce
        .number()
        .int()
        .min(1700, 'Check the year built.')
        .max(currentYear + 1, 'Check the year built.'),
    ])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : Number(v))),
  occupancyStatus: z
    .union([z.literal(''), z.enum(OCCUPANCY_STATUSES)])
    .optional()
    .transform((v) => (v ? v : undefined)),
  accessInstructions: optionalText,
  /** Free-text utilities summary; stored as jsonb {summary} for later structure. */
  utilities: optionalText,
  permitJurisdiction: optionalTrimmed,
  notes: optionalText,
});

export type PropertyInput = z.infer<typeof propertyInputSchema>;

/** Builds the jsonb address object from the flat form fields; null if empty. */
export function addressFromInput(input: {
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
}): Record<string, string> | null {
  const address: Record<string, string> = {};
  if (input.addressLine1) address.line1 = input.addressLine1;
  if (input.addressLine2) address.line2 = input.addressLine2;
  if (input.addressCity) address.city = input.addressCity;
  if (input.addressState) address.state = input.addressState;
  if (input.addressZip) address.zip = input.addressZip;
  return Object.keys(address).length > 0 ? address : null;
}
