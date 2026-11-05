import { describe, expect, it } from 'vitest';
import { collapsedMap } from '../../../../../tests/support/editor-store';
import { sampleMap } from '../../../../../tests/support/map-domain';
import { findNode, prune, topmost, visibleIds, type SelectionSlice } from './selection';

// Design D5 "Selection normalisation" and "Fixture — issue #35": the pure selection helpers over a
// forest with a collapsed subtree and floating roots. Expected id lists are hand-written literals
// read off the map diagrams below.

// sampleMap():    r ─ p ─ (a, b)                    f1 @ (10, 20) ─ fc
// collapsedMap(): r ─ (p [collapsed] ─ (a, b), q)   f1 @ (10, 20) ─ fc ─ fcc   f2 @ (300, 200)

const SLICE: SelectionSlice = {
  selectedIds: ['q', 'fc'],
  primaryId: 'fc',
  editing: { id: 'q', created: false },
  menuTargetId: 'f2',
};

describe('visibleIds', () => {
  it('lists every node in tree pre-order across all roots when nothing is collapsed', () => {
    expect(visibleIds(sampleMap())).toStrictEqual(['r', 'p', 'a', 'b', 'f1', 'fc']);
  });

  it('keeps a collapsed node but none of its descendants, floating subtrees included', () => {
    expect(visibleIds(collapsedMap())).toStrictEqual(['r', 'p', 'q', 'f1', 'fc', 'fcc', 'f2']);
  });
});

describe('topmost', () => {
  it('returns exactly the roots in roots order when every node is selected', () => {
    const map = collapsedMap();
    expect(topmost(map, ['r', 'p', 'a', 'b', 'q', 'f1', 'fc', 'fcc', 'f2'])).toStrictEqual([
      'r',
      'f1',
      'f2',
    ]);
  });

  it('drops a node whose grandparent is selected', () => {
    expect(topmost(sampleMap(), ['a', 'r'])).toStrictEqual(['r']);
  });

  it('orders by tree pre-order, not by the order the ids were given', () => {
    expect(topmost(sampleMap(), ['fc', 'b', 'a'])).toStrictEqual(['a', 'b', 'fc']);
  });

  it('ignores ids that are not in the map and returns [] for an empty selection', () => {
    expect(topmost(sampleMap(), ['zz', 'b'])).toStrictEqual(['b']);
    expect(topmost(sampleMap(), [])).toStrictEqual([]);
  });
});

describe('findNode', () => {
  it('finds visible and hidden nodes and returns undefined for an unknown id', () => {
    const map = collapsedMap();
    expect(findNode(map, 'fcc')?.text).toBe('FCC');
    expect(findNode(map, 'a')?.text).toBe('A');
    expect(findNode(map, 'zz')).toBeUndefined();
  });
});

describe('prune', () => {
  it('keeps a slice whose ids all exist and are visible', () => {
    expect(prune(collapsedMap(), SLICE)).toStrictEqual(SLICE);
  });

  it('drops missing and hidden selected ids in order and keeps a surviving primary', () => {
    const slice = { ...SLICE, selectedIds: ['zz', 'q', 'a', 'f2', 'fc'] };
    expect(prune(collapsedMap(), slice)).toStrictEqual({
      ...SLICE,
      selectedIds: ['q', 'f2', 'fc'],
      primaryId: 'fc',
    });
  });

  it('falls back to the last remaining selected id when the primary is pruned', () => {
    const slice = { ...SLICE, selectedIds: ['q', 'f2', 'a'], primaryId: 'a' };
    expect(prune(collapsedMap(), slice)).toStrictEqual({
      ...SLICE,
      selectedIds: ['q', 'f2'],
      primaryId: 'f2',
    });
  });

  it('nulls the primary when no selected id survives', () => {
    const slice = { ...SLICE, selectedIds: ['a', 'zz'], primaryId: 'zz' };
    expect(prune(collapsedMap(), slice)).toStrictEqual({
      ...SLICE,
      selectedIds: [],
      primaryId: null,
    });
  });

  it('clears editing and menu target only when their node no longer exists', () => {
    const map = collapsedMap();
    const hidden = { ...SLICE, editing: { id: 'a', created: false }, menuTargetId: 'b' };
    expect(prune(map, hidden)).toStrictEqual(hidden);
    const missing = { ...SLICE, editing: { id: 'zz', created: true }, menuTargetId: 'yy' };
    expect(prune(map, missing)).toStrictEqual({ ...SLICE, editing: null, menuTargetId: null });
  });
});
