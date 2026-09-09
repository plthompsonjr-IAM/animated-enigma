import { z } from 'zod';
import { SECTION_TYPES, VERSION_STATUSES } from './scopes-core';

/** Zod schemas for scope editing (Task 13). */

export const createScopeSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(2, 'Give the scope a title.').max(200).default('Scope of Work'),
});

export const sectionSchema = z.object({
  scopeVersionId: z.string().uuid(),
  sectionType: z.enum(SECTION_TYPES),
  title: z.string().trim().min(1, 'Add a section title.').max(200),
});

export const updateSectionSchema = z.object({
  sectionId: z.string().uuid(),
  title: z.string().trim().min(1, 'Add a section title.').max(200),
});

export const itemSchema = z.object({
  sectionId: z.string().uuid(),
  description: z.string().trim().min(1, 'Add a line.').max(2000),
});

export const updateItemSchema = z.object({
  itemId: z.string().uuid(),
  description: z.string().trim().min(1, 'Add a line.').max(2000),
});

export const statusChangeSchema = z.object({
  versionId: z.string().uuid(),
  status: z.enum(VERSION_STATUSES),
});

export const versionNotesSchema = z.object({
  versionId: z.string().uuid(),
  notes: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
