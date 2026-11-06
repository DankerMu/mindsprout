import { describe, expect, it } from 'vitest';
import type { NodeSize } from '../../contexts/map/application/layout/layout-forest';
import { mergeNodeSizes } from './node-sizes';

// Seam: mergeNodeSizes (design "Fixture — issue #15"). Identity is the contract: an unchanged
// batch must return the very same Map so the canvas does not re-run the layout.

function sizes(...entries: [string, number, number][]): Map<string, NodeSize> {
  return new Map(entries.map(([id, width, height]) => [id, { width, height }]));
}

describe('mergeNodeSizes', () => {
  it('returns the same Map when every measurement equals the stored entry', () => {
    const current = sizes(['r', 120, 32], ['a', 80, 32]);

    const merged = mergeNodeSizes(current, [
      { id: 'r', width: 120, height: 32 },
      { id: 'a', width: 80, height: 32 },
    ]);

    expect(merged).toBe(current);
  });

  it('returns the same Map for an empty batch', () => {
    const current = sizes(['r', 120, 32]);

    expect(mergeNodeSizes(current, [])).toBe(current);
  });

  it('returns a new Map with the old entries plus the changed one, leaving the input unchanged', () => {
    const current = sizes(['r', 120, 32], ['a', 80, 32]);

    const merged = mergeNodeSizes(current, [
      { id: 'r', width: 120, height: 32 },
      { id: 'a', width: 80, height: 40 },
    ]);

    expect(merged).not.toBe(current);
    expect([...merged]).toStrictEqual([...sizes(['r', 120, 32], ['a', 80, 40])]);
    expect([...current]).toStrictEqual([...sizes(['r', 120, 32], ['a', 80, 32])]);
  });

  it('treats a changed width alone as a change', () => {
    const current = sizes(['r', 120, 32]);

    expect([...mergeNodeSizes(current, [{ id: 'r', width: 121, height: 32 }])]).toStrictEqual([
      ...sizes(['r', 121, 32]),
    ]);
  });

  it('adds three new entries from one batch into one new Map', () => {
    const current = sizes();

    const merged = mergeNodeSizes(current, [
      { id: 'r', width: 100, height: 32 },
      { id: 'a', width: 60, height: 32 },
      { id: 'b', width: 70, height: 48 },
    ]);

    expect([...merged]).toStrictEqual([...sizes(['r', 100, 32], ['a', 60, 32], ['b', 70, 48])]);
    expect(current.size).toBe(0);
  });

  it('keeps the last value when one batch measures the same id twice', () => {
    const merged = mergeNodeSizes(sizes(), [
      { id: 'r', width: 100, height: 32 },
      { id: 'r', width: 140, height: 36 },
    ]);

    expect([...merged]).toStrictEqual([...sizes(['r', 140, 36])]);
  });

  it('does not filter values: an invalid measurement is stored as given', () => {
    const merged = mergeNodeSizes(sizes(), [{ id: 'r', width: 0, height: -1 }]);

    expect(merged.get('r')).toStrictEqual({ width: 0, height: -1 });
  });
});
