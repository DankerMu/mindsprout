import { describe, expect, it } from 'vitest';
import { byRecency } from './summary-order';

const summary = (id: string, updatedAt: string) => ({ id, title: id, updatedAt });

describe('byRecency', () => {
  it('orders by updatedAt descending', () => {
    const summaries = [
      summary('a', '2026-11-05T10:00:00.000Z'),
      summary('c', '2026-11-05T12:00:00.000Z'),
      summary('b', '2026-11-05T11:00:00.000Z'),
    ];

    expect(summaries.sort(byRecency).map(({ id }) => id)).toStrictEqual(['c', 'b', 'a']);
  });

  it('breaks updatedAt ties by plain code-unit id order', () => {
    const at = '2026-11-05T10:00:00.000Z';

    expect([summary('a', at), summary('B', at)].sort(byRecency).map(({ id }) => id)).toStrictEqual([
      'B',
      'a',
    ]);
    expect(byRecency(summary('a', at), summary('a', at))).toBe(0);
  });
});
