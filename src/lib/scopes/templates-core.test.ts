import { describe, it, expect } from 'vitest';
import {
  buildTemplateBody,
  parseTemplateBody,
  summarizeTemplate,
  isNonEmptyBody,
  type VersionSectionInput,
} from './templates-core';

describe('buildTemplateBody', () => {
  const version: VersionSectionInput[] = [
    {
      sectionType: 'included',
      title: 'Included',
      items: [{ description: 'Demo bathroom' }, { description: '  Install vanity  ' }],
    },
    { sectionType: 'excluded', title: 'Excluded', items: [{ description: 'Plumbing relocation' }] },
  ];

  it('snapshots sections and trims item text', () => {
    const body = buildTemplateBody(version);
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0]?.items).toEqual(['Demo bathroom', 'Install vanity']);
  });

  it('drops unknown section types', () => {
    const body = buildTemplateBody([
      { sectionType: 'nonsense', title: 'x', items: [{ description: 'y' }] },
    ]);
    expect(body.sections).toHaveLength(0);
  });

  it('drops empty item lines', () => {
    const body = buildTemplateBody([
      {
        sectionType: 'included',
        title: 'Inc',
        items: [{ description: '   ' }, { description: 'Real' }],
      },
    ]);
    expect(body.sections[0]?.items).toEqual(['Real']);
  });

  it('falls back to a default title when blank', () => {
    const body = buildTemplateBody([{ sectionType: 'included', title: '   ', items: [] }]);
    expect(body.sections[0]?.title).toBe('Section');
  });
});

describe('parseTemplateBody', () => {
  it('round-trips a well-formed body', () => {
    const body = {
      sections: [{ sectionType: 'allowance', title: 'Allowances', items: ['Tile $2000'] }],
    };
    expect(parseTemplateBody(body)).toEqual(body);
  });

  it('returns an empty body for garbage input', () => {
    expect(parseTemplateBody(null)).toEqual({ sections: [] });
    expect(parseTemplateBody('string')).toEqual({ sections: [] });
    expect(parseTemplateBody({ sections: 'nope' })).toEqual({ sections: [] });
    expect(parseTemplateBody({})).toEqual({ sections: [] });
  });

  it('skips malformed sections and non-string items', () => {
    const parsed = parseTemplateBody({
      sections: [
        { sectionType: 'included', title: 'Inc', items: ['a', 3, null, 'b'] },
        { sectionType: 'bogus', title: 'x', items: [] },
        'not an object',
      ],
    });
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.items).toEqual(['a', 'b']);
  });
});

describe('summarizeTemplate', () => {
  it('counts sections and items', () => {
    const body = {
      sections: [
        { sectionType: 'included', title: 'Inc', items: ['a', 'b'] },
        { sectionType: 'excluded', title: 'Exc', items: ['c'] },
      ],
    };
    expect(summarizeTemplate(body)).toEqual({ sectionCount: 2, itemCount: 3 });
  });
  it('is zero for an empty/garbage body', () => {
    expect(summarizeTemplate(null)).toEqual({ sectionCount: 0, itemCount: 0 });
  });
});

describe('isNonEmptyBody', () => {
  it('is true only with at least one section', () => {
    expect(isNonEmptyBody({ sections: [] })).toBe(false);
    expect(isNonEmptyBody({ sections: [{ sectionType: 'included', title: 'x', items: [] }] })).toBe(
      true,
    );
  });
});
