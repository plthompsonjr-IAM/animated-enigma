/**
 * Pure scope-template logic (Task 14): the template body shape, conversion to
 * and from a version's section/item content, and validation. No I/O — shared by
 * actions, queries, and UI, and unit-testable.
 *
 * A template body is a plain, versionless outline:
 *   { sections: [{ sectionType, title, items: [description, …] }] }
 */

import { isSectionType, type SectionType } from './scopes-core';

export interface TemplateSection {
  sectionType: SectionType;
  title: string;
  items: string[];
}

export interface TemplateBody {
  sections: TemplateSection[];
}

/** Content shape as it arrives from a scope version (sections with items). */
export interface VersionSectionInput {
  sectionType: string;
  title: string;
  items: { description: string }[];
}

/** Snapshot a version's sections/items into a normalized template body. */
export function buildTemplateBody(sections: VersionSectionInput[]): TemplateBody {
  return {
    sections: sections
      .filter((s) => isSectionType(s.sectionType))
      .map((s) => ({
        sectionType: s.sectionType as SectionType,
        title: (s.title ?? '').trim() || 'Section',
        items: s.items.map((i) => i.description.trim()).filter(Boolean),
      })),
  };
}

/**
 * Parse/normalize an untrusted jsonb body into a TemplateBody, dropping
 * anything malformed. Always returns a valid (possibly empty) body so callers
 * never crash on legacy or hand-edited rows.
 */
export function parseTemplateBody(body: unknown): TemplateBody {
  if (!body || typeof body !== 'object') return { sections: [] };
  const raw = (body as { sections?: unknown }).sections;
  if (!Array.isArray(raw)) return { sections: [] };

  const sections: TemplateSection[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const sectionType = (s as { sectionType?: unknown }).sectionType;
    const title = (s as { title?: unknown }).title;
    const items = (s as { items?: unknown }).items;
    if (typeof sectionType !== 'string' || !isSectionType(sectionType)) continue;
    sections.push({
      sectionType,
      title: typeof title === 'string' && title.trim() ? title.trim() : 'Section',
      items: Array.isArray(items)
        ? items
            .filter((i): i is string => typeof i === 'string' && i.trim() !== '')
            .map((i) => i.trim())
        : [],
    });
  }
  return { sections };
}

export interface TemplateSummary {
  sectionCount: number;
  itemCount: number;
}

/** Counts for compact display on template cards. */
export function summarizeTemplate(body: unknown): TemplateSummary {
  const parsed = parseTemplateBody(body);
  return {
    sectionCount: parsed.sections.length,
    itemCount: parsed.sections.reduce((n, s) => n + s.items.length, 0),
  };
}

/** True when the body has at least one section — worth saving/applying. */
export function isNonEmptyBody(body: TemplateBody): boolean {
  return body.sections.length > 0;
}
