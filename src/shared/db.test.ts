import { describe, expect, it, vi } from 'vitest';

const { sqlMock, endMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  endMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('postgres', () => ({
  default: () => {
    const tagged = () => sqlMock() as Promise<unknown>;
    tagged.end = endMock;
    return tagged;
  },
}));

import { pingDatabase } from './db';

describe('pingDatabase', () => {
  it('reports not-configured when no url is given', async () => {
    await expect(pingDatabase(undefined)).resolves.toBe('not-configured');
  });

  it('reports ok when select 1 succeeds and closes the pool', async () => {
    sqlMock.mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(pingDatabase('postgres://x')).resolves.toBe('ok');
    expect(endMock).toHaveBeenCalled();
  });

  it('reports fail when the query throws', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(pingDatabase('postgres://x')).resolves.toBe('fail');
  });
});
