import { afterEach, expect, it, vi } from 'vitest';

const INSTANT = '2024-01-01T00:30:00.000Z';
const RealDateTimeFormat = Intl.DateTimeFormat;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it.each([
  ['UTC', '2024年1月1日 00:30'],
  ['America/Los_Angeles', '2023年12月31日 16:30'],
  ['Asia/Shanghai', '2024年1月1日 08:30'],
])('formats a fixed ISO instant as local Chinese time in %s', async (timeZone, expected) => {
  // Stand in for the browser's local zone without a runtime TZ write, which a
  // threads-pool worker ignores (#324). The case zone is only a default: a module that names
  // its own timeZone overrides it and fails every case. Vitest cannot `new` an arrow function.
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new RealDateTimeFormat(locales, { timeZone, ...options });
  });
  // The module must load after the spy because the formatter is built at import.
  vi.resetModules();
  const { formatTimestamp } = await import('./format-timestamp');
  expect(formatTimestamp(INSTANT)).toBe(expected);
});

it('returns an unparseable timestamp unchanged', async () => {
  // Load a fresh module rather than sharing the instance from the timezone cases.
  const { formatTimestamp } = await import('./format-timestamp');
  expect(formatTimestamp('  not-a-timestamp  ')).toBe('  not-a-timestamp  ');
});
