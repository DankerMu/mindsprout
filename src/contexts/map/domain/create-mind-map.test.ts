import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMindMap } from './create-mind-map';
import type { MindMap } from './types';

describe('createMindMap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('New map has exactly one root', () => {
    const map: MindMap = createMindMap({
      id: 'm1',
      rootId: 'r1',
      title: '新导图',
      rootText: '新导图',
      now: () => new Date('2026-11-05T10:00:00.000Z'),
    });

    expect(map.roots).toHaveLength(1);
    const [primary] = map.roots;
    expect(primary).toBeDefined();
    expect(primary).not.toHaveProperty('position');
    expect(primary?.children).toEqual([]);
    expect(primary?.id).toBe('r1');
    expect(primary?.text).toBe('新导图');
    expect(map.id).toBe('m1');
    expect(map.title).toBe('新导图');
    expect(map.createdAt).toBe('2026-11-05T10:00:00.000Z');
    expect(map.updatedAt).toBe('2026-11-05T10:00:00.000Z');
  });

  it('produces exactly the documented shape with no extra keys', () => {
    const map = createMindMap({
      id: 'm2',
      rootId: 'r2',
      title: 'Title',
      rootText: 'Root',
      now: () => new Date('2026-01-02T03:04:05.006Z'),
    });

    expect(map).toStrictEqual({
      id: 'm2',
      title: 'Title',
      roots: [{ id: 'r2', text: 'Root', children: [] }],
      createdAt: '2026-01-02T03:04:05.006Z',
      updatedAt: '2026-01-02T03:04:05.006Z',
    });
  });

  it('reads the clock once so createdAt equals updatedAt', () => {
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-11-05T10:00:00.000Z'))
      .mockReturnValueOnce(new Date('2026-11-05T11:00:00.000Z'));

    const map = createMindMap({ id: 'm3', rootId: 'r3', title: 't', rootText: 'r', now });

    expect(now).toHaveBeenCalledTimes(1);
    expect(map.updatedAt).toBe(map.createdAt);
  });

  it('defaults the clock to the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-03-04T05:06:07.008Z'));

    const map = createMindMap({ id: 'm4', rootId: 'r4', title: 't', rootText: 'r' });

    expect(map.createdAt).toBe('2027-03-04T05:06:07.008Z');
    expect(map.updatedAt).toBe('2027-03-04T05:06:07.008Z');
  });
});
