import { afterEach, expect, it, vi } from 'vitest';

const INSTANT = '2024-01-01T00:30:00.000Z';
const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
  vi.resetModules();
});

it.each([
  ['UTC', '2024年1月1日 00:30'],
  ['America/Los_Angeles', '2023年12月31日 16:30'],
  ['Asia/Shanghai', '2024年1月1日 08:30'],
])('formats a fixed ISO instant as local Chinese time in %s', async (timezone, expected) => {
  // The module must load after TZ is set because the formatter captures it at construction.
  process.env.TZ = timezone;
  const { formatTimestamp } = await import('./format-timestamp');
  expect(formatTimestamp(INSTANT)).toBe(expected);
});
