import { describe, expect, it } from 'vitest';
import {
  GENERATE_TOOL_NAME,
  type GenerationCaps,
  generateToolInputSchema,
  PRODUCTION_CAPS,
} from './generate-tool';

describe('Generate tool input schema', () => {
  it('accepts a parent id with at least one child carrying an id and non-empty text', () => {
    const input = { parentId: 'root', children: [{ id: 'a', text: '类型系统' }] };

    expect(generateToolInputSchema.parse(input)).toStrictEqual(input);
  });

  it.each([
    ['an unknown top-level field', { parentId: 'root', children: [{ id: 'a', text: 'x' }], x: 1 }],
    ['an unknown child field', { parentId: 'root', children: [{ id: 'a', text: 'x', note: 'n' }] }],
    ['an empty children list', { parentId: 'root', children: [] }],
    ['empty text', { parentId: 'root', children: [{ id: 'a', text: '' }] }],
    ['a missing parent id', { children: [{ id: 'a', text: 'x' }] }],
    ['a non-string child id', { parentId: 'root', children: [{ id: 1, text: 'x' }] }],
    ['a non-object input', 'root'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(generateToolInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('Generate tool contract', () => {
  it('names the single tool add_children', () => {
    expect(GENERATE_TOOL_NAME).toBe('add_children');
  });

  it('production caps are depth 2, 7 per parent and 60 in total', () => {
    const caps: GenerationCaps = PRODUCTION_CAPS;

    expect(caps).toStrictEqual({ depth: 2, perParent: 7, total: 60 });
  });
});
