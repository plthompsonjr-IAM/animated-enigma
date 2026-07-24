import { z } from 'zod';

/** Zod schemas for scope-template actions (Task 14). */

export const saveTemplateSchema = z.object({
  versionId: z.string().uuid(),
  name: z.string().trim().min(2, 'Give the template a name.').max(200),
  projectType: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const applyTemplateSchema = z.object({
  templateId: z.string().uuid(),
  /** Apply into a project's scope: creates a new draft version from the template. */
  projectId: z.string().uuid(),
});

export const startScopeFromTemplateSchema = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
});

export const templateIdSchema = z.object({
  templateId: z.string().uuid(),
});
