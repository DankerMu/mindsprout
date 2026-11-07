import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../tests/support/canvas';
import { heldResult } from '../../tests/support/map-library';
import { StorageUnavailableError } from '../contexts/map/domain/errors';
import type { MapRepository, MapSummary } from '../contexts/map/domain/map-repository';
import { InMemoryMapRepository } from '../contexts/map/infrastructure/persistence/in-memory-map-repository';
import HomePage from './page';
import { MapRepositoryProvider } from './providers/MapRepositoryProvider';

failOnConsoleNoise();

function renderHome(open: () => Promise<MapRepository>) {
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
      <MapRepositoryProvider open={open}>
        <HomePage />
      </MapRepositoryProvider>
    </AppRouterContext>,
  );
  return router;
}

describe('MapLibraryClient composition', () => {
  it('preserves app-ready while opening and reports provider failure rather than empty', async () => {
    const opening = heldResult<MapRepository>();
    renderHome(() => opening.promise);
    expect(screen.getByTestId('app-ready')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('正在加载导图…');
    expect(screen.queryByText('还没有导图')).toBeNull();
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    await act(async () => {
      opening.reject(new Error('IndexedDB blocked'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('app-ready')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('无法读取导图列表');
    expect(screen.queryByText('还没有导图')).toBeNull();
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
  });

  it('preserves app-ready while list is pending and when list fails', async () => {
    const pending = heldResult<MapSummary[]>();
    class UnreadableRepository extends InMemoryMapRepository {
      override list() {
        return pending.promise;
      }
    }
    renderHome(() => Promise.resolve(new UnreadableRepository()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('app-ready')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('正在加载导图…');
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    await act(async () => {
      pending.reject(new Error('list failed'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('app-ready')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('无法读取导图列表');
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
  });

  it('opens the saved map through the app router without replacing the session repository', async () => {
    const repository = new InMemoryMapRepository();
    const router = renderHome(() => Promise.resolve(repository));
    await screen.findByText('还没有导图');
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '新建导图' }));
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    const [summary] = await repository.list();
    expect(router.push).toHaveBeenCalledWith(`/maps/${summary?.id ?? ''}`);
    expect((await repository.get(summary?.id ?? ''))?.title).toBe('新导图');
  });

  it('shows one persistent banner with the empty fallback and enabled creation when storage cannot open', async () => {
    const router = renderHome(() => Promise.reject(new StorageUnavailableError('blocked')));
    await screen.findByText('还没有导图');
    expect(screen.getByTestId('app-ready')).toBeTruthy();
    expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
    const create = screen.getByRole<HTMLButtonElement>('button', { name: '新建导图' });
    expect(create.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(create);
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/maps\/[^/]+$/));
    expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
  });
});
