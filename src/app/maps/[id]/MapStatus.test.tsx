import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { failOnConsoleNoise } from '../../../../tests/support/canvas';
import { MapStatus } from './MapStatus';

// Design "Fixture — issue #16": the one component for the route's non-editor states. Texts come
// from specs map-library "Stale link" / "Unreadable map" and map-persistence "Future version".

failOnConsoleNoise();

describe('MapStatus', () => {
  it.each([
    ['not-found', '找不到这张导图'],
    ['future-version', '此导图由更新版本创建'],
    ['error', '无法打开这张导图'],
  ] as const)('shows the %s message with a link back to the library', (kind, text) => {
    render(<MapStatus kind={kind} />);

    expect(screen.getByText(text)).toBeTruthy();
    const link = screen.getByRole('link', { name: '返回导图列表' });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('shows the loading message without a link', () => {
    render(<MapStatus kind="loading" />);

    expect(screen.getByText('正在打开…')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
