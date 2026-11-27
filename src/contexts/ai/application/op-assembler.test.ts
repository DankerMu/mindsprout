import { describe, expect, it } from 'vitest';
import { parseTreeOp, type TreeOp } from '../acl/map';
import { ProviderOutputError } from '../domain/errors';
import { type GenerationCaps, PRODUCTION_CAPS } from '../domain/generate-tool';
import { createOpAssembler, type OpAssembler } from './op-assembler';

const ROOT_ID = 'primary-root';

// Deterministic server ids s1, s2, … and one helper for every call, so each emitted op is
// checked against map's TreeOp schema boundary.
function setup(caps: GenerationCaps = PRODUCTION_CAPS) {
  let issued = 0;
  const assembler: OpAssembler = createOpAssembler({
    rootId: ROOT_ID,
    idFactory: () => `s${String((issued += 1))}`,
    caps,
  });
  const offer = (parentId: string, ...ids: string[]): TreeOp | undefined => {
    const op = assembler.assemble({
      parentId,
      children: ids.map((id) => ({ id, text: `text ${id}` })),
    });
    if (op !== undefined) {
      expect(parseTreeOp(op)).toStrictEqual(op);
    }
    return op;
  };
  return { assembler, offer };
}

function addChildren(parentId: string, children: [id: string, text: string][]): TreeOp {
  return {
    op: 'add_children',
    parentId,
    children: children.map(([id, text]) => ({ id, text })),
  };
}

describe('op assembler: temporary ids', () => {
  it('Model temporary ids are replaced: root maps to the primary root, a to its server id', () => {
    const { offer } = setup();

    const first = offer('root', 'a', 'b');
    const second = offer('a', 'c');

    expect(first).toStrictEqual(
      addChildren(ROOT_ID, [
        ['s1', 'text a'],
        ['s2', 'text b'],
      ]),
    );
    expect(second).toStrictEqual(addChildren('s1', [['s3', 'text c']]));
    expect(first && 'index' in first).toBe(false);
    const ids = JSON.stringify([first, second]);
    expect(ids).not.toContain('"a"');
    expect(ids).not.toContain('"b"');
    expect(ids).not.toContain('"c"');
  });

  it('keeps text longer than 40 characters unchanged', () => {
    const { assembler } = setup();
    const text = '一'.repeat(41);

    expect(assembler.assemble({ parentId: 'root', children: [{ id: 'a', text }] })).toStrictEqual(
      addChildren(ROOT_ID, [['s1', text]]),
    );
  });

  it('Unknown parent is invalid output', () => {
    const { offer } = setup();
    offer('root', 'a');

    expect(() => offer('never-introduced', 'x')).toThrow(ProviderOutputError);
    expect(() => offer(ROOT_ID, 'x')).toThrow(ProviderOutputError);
  });

  it('Duplicate temporary id is invalid output when the id was emitted', () => {
    const { offer } = setup();
    offer('root', 'a');

    expect(() => offer('root', 'a')).toThrow(ProviderOutputError);
    expect(() => offer('a', 'a')).toThrow(ProviderOutputError);
  });

  it('Duplicate temporary id is invalid output when the id was dropped', () => {
    const { offer } = setup();
    offer('root', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');

    expect(() => offer('a', 'h')).toThrow(ProviderOutputError);
    expect(() => offer('h', 'h')).toThrow(ProviderOutputError);
  });

  it('rejects a temporary id repeated within one call, or one named root', () => {
    const { offer } = setup();

    expect(() => offer('root', 'a', 'a')).toThrow(ProviderOutputError);
    expect(() => offer('root', 'root')).toThrow(ProviderOutputError);
  });

  it('a rejected call changes no state', () => {
    const { offer } = setup();
    offer('root', 'a');

    expect(() => offer('root', 'b', 'a')).toThrow(ProviderOutputError);
    expect(offer('root', 'b')).toStrictEqual(addChildren(ROOT_ID, [['s2', 'text b']]));
  });
});

describe('op assembler: malformed tool input', () => {
  it.each([
    ['an unknown field', { parentId: 'root', children: [{ id: 'a', text: 'x' }], index: 0 }],
    ['an empty children list', { parentId: 'root', children: [] }],
    ['empty text', { parentId: 'root', children: [{ id: 'a', text: '' }] }],
    ['a non-object input', '{"parentId":"root","children":[{"id":"a","text":"x"}]}'],
  ])('Malformed tool input is invalid output: %s', (_label, input) => {
    const { assembler } = setup();

    expect(() => assembler.assemble(input)).toThrow(ProviderOutputError);
  });

  it('uses a fixed message per failure, never echoing model output', () => {
    const { assembler } = setup();
    const call = (parentId: string, id: string, extra = {}) =>
      assembler.assemble({ parentId, children: [{ id, text: 'secret text' }], ...extra });

    expect(() => call('root', 'secret-id', { secret: 1 })).toThrow(
      /^tool input does not match the add_children schema$/,
    );
    expect(() => call('secret-parent', 'a')).toThrow(
      /^tool call names a parent that was never introduced$/,
    );
    expect(() => call('root', 'root')).toThrow(/^tool call reuses a temporary id$/);
  });
});

describe('op assembler: truncation', () => {
  it('Third level dropped: children of a depth-2 parent emit no op and generation continues', () => {
    const { offer } = setup();
    offer('root', 'a');
    offer('a', 'b');

    expect(offer('b', 'c')).toBeUndefined();
    expect(offer('a', 'd')).toStrictEqual(addChildren('s1', [['s3', 'text d']]));
  });

  it('drops by the injected depth cap', () => {
    const { offer } = setup({ depth: 1, perParent: 7, total: 60 });
    offer('root', 'a');

    expect(offer('a', 'b')).toBeUndefined();
  });

  it('Per-parent overflow truncated: of 9 root children across calls only the first 7 emit', () => {
    const { offer } = setup();

    expect(offer('root', 'a', 'b', 'c', 'd', 'e')).toStrictEqual(
      addChildren(ROOT_ID, [
        ['s1', 'text a'],
        ['s2', 'text b'],
        ['s3', 'text c'],
        ['s4', 'text d'],
        ['s5', 'text e'],
      ]),
    );
    expect(offer('root', 'f', 'g', 'h', 'i')).toStrictEqual(
      addChildren(ROOT_ID, [
        ['s6', 'text f'],
        ['s7', 'text g'],
      ]),
    );
    expect(offer('root', 'j')).toBeUndefined();
  });

  it('Children of a truncated node dropped, transitively, and generation completes normally', () => {
    const { assembler, offer } = setup();
    offer('root', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');

    expect(offer('h', 'x')).toBeUndefined();
    expect(offer('x', 'y')).toBeUndefined();
    for (const parent of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(offer(parent, `${parent}1`)).toBeDefined();
    }
    expect(assembler.complete).toBe(true);
  });

  it('Total bound: with an injected total of 5, only the first 5 of 8 offered nodes emit', () => {
    const { offer } = setup({ depth: 2, perParent: 7, total: 5 });

    const ops = [offer('root', 'a', 'b', 'c'), offer('a', 'd', 'e', 'f'), offer('b', 'g', 'h')];

    expect(ops).toStrictEqual([
      addChildren(ROOT_ID, [
        ['s1', 'text a'],
        ['s2', 'text b'],
        ['s3', 'text c'],
      ]),
      addChildren('s1', [
        ['s4', 'text d'],
        ['s5', 'text e'],
      ]),
      undefined,
    ]);
    expect(offer('f', 'z')).toBeUndefined();
  });
});

describe('op assembler: complete', () => {
  it('is false until at least one first-level node exists', () => {
    const { assembler, offer } = setup();

    expect(assembler.complete).toBe(false);
    offer('root', 'a', 'b');
    expect(assembler.complete).toBe(false);
  });

  it('becomes true only once every first-level node has a child, and false on a new one', () => {
    const { assembler, offer } = setup();
    offer('root', 'a', 'b');

    offer('a', 'a1');
    expect(assembler.complete).toBe(false);
    offer('b', 'b1');
    expect(assembler.complete).toBe(true);
    offer('a1', 'a11');
    expect(assembler.complete).toBe(true);
    offer('root', 'c');
    expect(assembler.complete).toBe(false);
  });

  it('a first-level node whose children were all dropped stays incomplete', () => {
    const { assembler, offer } = setup({ depth: 2, perParent: 7, total: 2 });
    offer('root', 'a', 'b');

    expect(offer('a', 'a1')).toBeUndefined();
    expect(assembler.complete).toBe(false);
  });
});
