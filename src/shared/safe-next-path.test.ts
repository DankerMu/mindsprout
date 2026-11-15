import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next-path';

describe('account-auth: Foreign redirect target is ignored', () => {
  it.each([
    '//evil.example/x',
    'https://evil.example',
    '/\\evil',
    '/\n/evil.example/x',
    '/\r/evil.example/x',
    '/\t\\evil.example/x',
    '',
    null,
  ])('returns home for %s', (value) => {
    expect(safeNextPath(value)).toBe('/');
  });

  it.each(['/', '/maps/abc?x=1'])('preserves the same-site path %s', (value) => {
    expect(safeNextPath(value)).toBe(value);
  });
});
