import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StorageUnavailableBanner } from './StorageUnavailableBanner';

it('renders only while unavailable and offers no dismissal', () => {
  const view = render(<StorageUnavailableBanner storageUnavailable={false} />);
  expect(screen.queryByText('未保存到浏览器')).toBeNull();
  view.rerender(<StorageUnavailableBanner storageUnavailable />);
  expect(screen.getByRole('status').textContent).toBe('未保存到浏览器');
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<StorageUnavailableBanner storageUnavailable />);
  expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
});
