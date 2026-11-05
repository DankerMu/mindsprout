import { afterEach, describe, expect, it, vi } from 'vitest';

const { pingMock } = vi.hoisted(() => ({ pingMock: vi.fn() }));
vi.mock('@/shared/db', () => ({ pingDatabase: pingMock }));

import { GET } from './route';

describe('GET /api/healthz', () => {
  afterEach(() => {
    pingMock.mockReset();
  });

  it('returns ok when the database is reachable', async () => {
    pingMock.mockResolvedValueOnce('ok');

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', checks: { db: 'ok' } });
  });

  it('returns 503 degraded when the database ping fails', async () => {
    pingMock.mockResolvedValueOnce('fail');

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: 'degraded' });
  });
});
