import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GENERATE_TOOL_NAME, generateToolInputSchema } from '../domain/generate-tool';
import {
  buildGenerateRequest,
  GENERATE_SYSTEM_PROMPT,
  GENERATE_TOOL_DEFINITION,
} from './generate-prompt';

// Drops the keywords the wire schema omits: `$schema`, and `minLength` (rejected by Claude
// strict tools). Applied at every depth so a nested drift still surfaces.
function stripWireKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripWireKeywords);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$schema' && key !== 'minLength')
      .map(([key, child]) => [key, stripWireKeywords(child)]),
  );
}

describe('Generate system prompt (ai-provider "Instruction content")', () => {
  it.each([
    ['changes only through the tool', ['Make changes only through the `add_children` tool.']],
    [
      'one parent per call with a flat list of children',
      ['one parent per call', 'flat list of children'],
    ],
    [
      'short temporary ids with `root` for the primary root',
      ['short temporary id', 'The primary root is `root`.'],
    ],
    ['the root call first', ['Call for the root first.']],
    [
      'every first-level call in parallel in one turn',
      ['every first-level call in parallel in one turn'],
    ],
    ['exactly two levels below the root', ['exactly two levels below the root']],
    ['3–7 children per parent', ['Give each parent 3–7 children.']],
    ['at most 40 characters with no paragraphs', ['at most 40 characters', 'no paragraphs']],
    ['mutually exclusive siblings', ['Make siblings mutually exclusive']],
    ['output language following the topic', ['in the language of the topic']],
  ])('states %s', (_constraint, anchors) => {
    for (const anchor of anchors) expect(GENERATE_SYSTEM_PROMPT).toContain(anchor);
  });

  it('names the tool by the shared constant', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain(`\`${GENERATE_TOOL_NAME}\``);
  });
});

describe('buildGenerateRequest', () => {
  it.each(['学习 TypeScript', 'Plan a vegetable garden'])(
    'keeps the system text constant and places %s only in the user turn',
    (topic) => {
      const request = buildGenerateRequest(topic);

      expect(request).toStrictEqual({
        system: GENERATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: topic }],
      });
      expect(request.system).not.toContain(topic);
    },
  );

  it('returns the same system text for different topics', () => {
    expect(buildGenerateRequest('学习 TypeScript').system).toBe(
      buildGenerateRequest('Plan a vegetable garden').system,
    );
  });
});

describe('Generate wire tool definition', () => {
  it('deep-equals the literal wire definition', () => {
    expect(GENERATE_TOOL_DEFINITION).toStrictEqual({
      name: 'add_children',
      description: 'Add a flat list of children under one parent node of the mind map.',
      inputSchema: {
        type: 'object',
        properties: {
          parentId: { type: 'string' },
          children: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['id', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['parentId', 'children'],
        additionalProperties: false,
      },
    });
    expect(GENERATE_TOOL_DEFINITION.name).toBe(GENERATE_TOOL_NAME);
  });

  it('matches the zod tool input schema without `$schema` and `minLength`', () => {
    expect(GENERATE_TOOL_DEFINITION.inputSchema).toStrictEqual(
      stripWireKeywords(z.toJSONSchema(generateToolInputSchema)),
    );
  });

  it('carries neither `$schema` nor `minLength` in its serialised form', () => {
    const wire = JSON.stringify(GENERATE_TOOL_DEFINITION.inputSchema);

    expect(wire).not.toContain('$schema');
    expect(wire).not.toContain('minLength');
  });
});
