import { describe, expect, it } from 'vitest';
import {
  deepFreeze,
  entriesOf,
  errorFrom,
  mapOf,
  node,
  sampleMap,
} from '../../../../tests/support/map-domain';
import { TreeOpError } from './errors';
import { parseMindMap } from './parse-mind-map';
import type { MindMap } from './types';

function expectInvalidMap(input: unknown): TreeOpError {
  const before = structuredClone(input);
  deepFreeze(input);
  const error = errorFrom(() => parseMindMap(input));
  expect(input).toStrictEqual(before);
  expect(error).toBeInstanceOf(TreeOpError);
  if (!(error instanceof TreeOpError)) throw error;
  expect(error.code).toBe('invalid-op');
  expect(error.issues?.length).toBeGreaterThan(0);
  expect(error.message).toContain('Invalid MindMap');
  return error;
}

const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;

function largeMap(): MindMap {
  return mapOf(
    node(
      'primary',
      COLORS.map((color) =>
        node(
          color,
          Array.from({ length: 81 }, (_, index) =>
            node(`${color}-${String(index)}`, [], {
              text: '  想法  ',
              note: 'First line\n第二行',
              color,
              collapsed: index % 2 === 0,
            }),
          ),
          { color },
        ),
      ),
    ),
    node(
      'floating',
      Array.from({ length: 5 }, (_, index) => node(`floating-${String(index)}`)),
      { position: { x: -3.5, y: 17.25 }, note: '', collapsed: true },
    ),
    node('other-floating', [], { position: { x: 0, y: -0.25 } }),
  );
}

describe('parseMindMap', () => {
  it('rejects a floating root without a position', () => {
    expectInvalidMap(mapOf(node('primary'), node('floating')));
  });

  it.each([
    ['siblings', mapOf(node('r', [node('duplicate'), node('duplicate')]))],
    ['deep descendants', mapOf(node('r', [node('a', [node('b', [node('a')])])]))],
    ['primary and descendant', mapOf(node('r', [node('a', [node('r')])]))],
    ['roots', mapOf(node('r'), node('r', [], { position: { x: 0, y: 0 } }))],
    [
      'across roots',
      mapOf(
        node('r', [node('duplicate')]),
        node('f', [node('branch', [node('duplicate')])], { position: { x: 1, y: 2 } }),
      ),
    ],
  ])('rejects duplicate node ids among %s', (_name, input) => {
    const error = expectInvalidMap(input);
    expect(
      error.issues?.some(
        (issue) => issue.code === 'custom' && issue.message.startsWith('Duplicate'),
      ),
    ).toBe(true);
  });

  it('reports the duplicate id at its full path across floating subtrees', () => {
    const error = expectInvalidMap(
      mapOf(
        node('r', [node('duplicate')]),
        node('f', [node('branch', [node('duplicate')])], { position: { x: 1, y: 2 } }),
      ),
    );
    expect(error.issues).toEqual([
      {
        code: 'custom',
        path: ['roots', 1, 'children', 0, 'children', 0, 'id'],
        message: 'Duplicate node id: duplicate',
      },
    ]);
    expect(error.message).toContain('roots.1.children.0.children.0.id');
  });

  it('accepts a frozen 500-node forest deep-equal without mutating it', () => {
    const input = largeMap();
    const expected = structuredClone(input);
    expect(entriesOf(input)).toHaveLength(500);
    deepFreeze(input);

    expect(parseMindMap(input)).toStrictEqual(expected);
    expect(input).toStrictEqual(expected);
  });

  it('preserves empty strings, arbitrary timestamps and false collapsed without repair', () => {
    const input = {
      id: '',
      title: '  ',
      createdAt: '',
      updatedAt: 'not-a-timestamp',
      roots: [node('', [], { text: '', note: '', collapsed: false })],
    };
    expect(parseMindMap(input)).toStrictEqual(input);
  });

  it.each(COLORS)('accepts the %s color token', (color) => {
    const input = mapOf(node('primary', [node('child', [], { color })], { color }));
    expect(parseMindMap(input)).toStrictEqual(input);
  });

  it('does not retain node ids between calls', () => {
    const input = sampleMap();
    expect(parseMindMap(input)).toStrictEqual(input);
    expect(parseMindMap(input)).toStrictEqual(input);
  });

  it('rejects zero roots', () => {
    expectInvalidMap(mapOf());
  });

  it.each([{ x: 0, y: 0 }, undefined])('rejects primary root position %j', (position) => {
    expectInvalidMap({ ...mapOf(), roots: [{ ...node('r'), position }] });
  });

  it.each([undefined, null, {}, [], 'position', { x: 0 }, { y: 0 }])(
    'rejects a malformed floating root position %j',
    (position) => {
      expectInvalidMap({ ...mapOf(), roots: [node('r'), { ...node('f'), position }] });
    },
  );

  it.each(['x', 'y'])('rejects non-finite or non-number floating %s coordinates', (coordinate) => {
    for (const value of [NaN, Infinity, -Infinity, '1', null, undefined, true]) {
      const position = { x: 1, y: 2, [coordinate]: value };
      expectInvalidMap({ ...mapOf(), roots: [node('r'), { ...node('f'), position }] });
    }
  });

  it.each([{ x: 0, y: 0 }, undefined])(
    'rejects position %j on descendants of primary and floating roots',
    (position) => {
      const child = { ...node('child'), position };
      expectInvalidMap({ ...mapOf(), roots: [{ ...node('r'), children: [child] }] });
      expectInvalidMap({
        ...mapOf(),
        roots: [node('r'), { ...node('f', [], { position: { x: 0, y: 0 } }), children: [child] }],
      });
    },
  );

  it.each(['id', 'title', 'createdAt', 'updatedAt'])(
    'rejects missing or non-string map %s',
    (field) => {
      const missing = Object.fromEntries(
        Object.entries(sampleMap()).filter(([key]) => key !== field),
      );
      expectInvalidMap(missing);
      for (const value of [undefined, null, 1, false, [], {}]) {
        expectInvalidMap({ ...sampleMap(), [field]: value });
      }
    },
  );

  it.each(['id', 'text', 'note'])('rejects non-string node %s at every depth', (field) => {
    for (const value of [undefined, null, 1, false, [], {}]) {
      const invalidNode = { ...node('invalid'), [field]: value };
      expectInvalidMap({ ...mapOf(), roots: [invalidNode] });
      expectInvalidMap({
        ...mapOf(),
        roots: [node('r'), { ...invalidNode, position: { x: 1, y: 2 } }],
      });
      expectInvalidMap({ ...mapOf(), roots: [{ ...node('r'), children: [invalidNode] }] });
    }
  });

  it.each(['id', 'text', 'children'])('rejects a missing node %s', (field) => {
    const invalidNode = Object.fromEntries(
      Object.entries(node('r')).filter(([key]) => key !== field),
    );
    expectInvalidMap({ ...mapOf(), roots: [invalidNode] });
  });

  it.each(['color', 'collapsed'])('rejects an invalid optional node %s', (field) => {
    const values = field === 'color' ? ['pink', '', 1, false] : ['true', 0, 1];
    for (const value of [...values, undefined, null, [], {}]) {
      expectInvalidMap({ ...mapOf(), roots: [{ ...node('r'), [field]: value }] });
    }
  });

  it.each([undefined, null, false, 0, 'map', [], {}])('rejects malformed maps %j', (input) => {
    expectInvalidMap(input);
  });

  it.each([undefined, null, {}, 'nodes', 0])('rejects malformed node arrays %j', (value) => {
    expectInvalidMap({ ...mapOf(), roots: value });
    expectInvalidMap({ ...mapOf(), roots: [{ ...node('r'), children: value }] });
  });

  it.each([undefined, null, [], 'node', 0, {}])('rejects malformed nodes %j', (value) => {
    expectInvalidMap({ ...mapOf(), roots: [value] });
    expectInvalidMap({ ...mapOf(), roots: [node('r'), value] });
    expectInvalidMap({ ...mapOf(), roots: [{ ...node('r'), children: [value] }] });
  });

  it.each([true, undefined])('rejects unknown keys even when their value is %j', (extra) => {
    expectInvalidMap({ ...sampleMap(), extra });
    expectInvalidMap({ ...mapOf(), roots: [{ ...node('r'), extra }] });
    expectInvalidMap({
      ...mapOf(),
      roots: [node('r'), { ...node('f', [], { position: { x: 1, y: 2 } }), extra }],
    });
    expectInvalidMap({
      ...mapOf(),
      roots: [{ ...node('r'), children: [{ ...node('c'), extra }] }],
    });
    expectInvalidMap({
      ...mapOf(),
      roots: [node('r'), { ...node('f'), position: { x: 1, y: 2, extra } }],
    });
  });
});
