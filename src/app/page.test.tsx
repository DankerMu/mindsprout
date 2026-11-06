import { render, screen } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../tests/support/canvas';
import { InMemoryMapRepository } from '../contexts/map/infrastructure/persistence/in-memory-map-repository';
import HomePage from './page';
import { MapRepositoryProvider } from './providers/MapRepositoryProvider';

failOnConsoleNoise();

it('shows the true empty library with its create action and stable home marker', async () => {
  const repository = new InMemoryMapRepository();
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    bfcacheId: 'home',
  };
  render(
    <AppRouterContext value={router}>
      <MapRepositoryProvider open={() => Promise.resolve(repository)}>
        <HomePage />
      </MapRepositoryProvider>
    </AppRouterContext>,
  );

  expect(await screen.findByText('还没有导图')).toBeTruthy();
  expect(screen.getByRole('button', { name: '新建导图' })).toBeTruthy();
  expect(screen.getByTestId('app-ready')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'MindSprout' })).toBeTruthy();
});
